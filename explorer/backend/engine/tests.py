"""계산 엔진 단위 테스트 (DB 없음). 성능·경제성·핀치 기대값은 계산기 키트 README 「기대값」 표의 값입니다."""

from decimal import Decimal
from fractions import Fraction

from django.test import SimpleTestCase

from . import demo_calc, fields
from .comparison import evaluate_comparison
from .iapws import saturation_temperature_k
from .pinch import evaluate_pinch
from .reference_estimate import evaluate_reference
from .units import UnitError, convert


def inputs(**over):
    return {**fields.DEFAULTS, **over}


class UnitTests(SimpleTestCase):
    def test_t06_mmh2o_to_kpa(self):
        self.assertEqual(convert(1, "mmH2O", "kPa"), Decimal("0.00980665"))
        self.assertEqual(convert(Decimal("0.00980665"), "kPa", "mmH2O"), 1)

    def test_other_conversions(self):
        self.assertEqual(convert(100, "°C", "°F"), 212)
        self.assertEqual(convert(1, "bar", "kPa"), 100)
        self.assertEqual(convert(1, "mbar", "kPa"), Decimal("0.1"))
        self.assertAlmostEqual(float(convert(1, "inH2O", "mmH2O")), 25.4, places=6)  # 정의상 25.4 mm
        self.assertAlmostEqual(float(convert(1, "bar", "psia")), 14.503773773, places=6)
        self.assertAlmostEqual(float(convert(1, "kg/s", "lb/h")), 7936.641438, places=4)
        with self.assertRaises(UnitError):
            convert(1, "°C", "kPa")


class InputValidationTests(SimpleTestCase):
    def test_defaults_are_valid(self):
        v, errors, warnings = fields.clean_inputs(fields.DEFAULTS)
        self.assertEqual(errors, {})
        self.assertEqual(warnings, [])

    def test_blocks_empty_nan_range_unknown_and_unit_mismatch(self):
        _, errors, _ = fields.clean_inputs(inputs(capacityMW="", loadFactor=110, currentBP="NaN", nope=1,
                                                  baselineBP={"value": 2.4, "unit": "kPa"}))
        self.assertEqual(set(errors), {"capacityMW", "loadFactor", "currentBP", "nope", "baselineBP"})
        self.assertIn("단위 불일치", errors["baselineBP"]["ko"])

    def test_load_factor_range_is_30_to_105(self):
        for ok in (30, 105):
            self.assertNotIn("loadFactor", fields.clean_inputs(inputs(loadFactor=ok))[1])
        for bad in (29.9, 105.1, 110):
            self.assertIn("loadFactor", fields.clean_inputs(inputs(loadFactor=bad))[1])

    def test_bp_below_baseline_is_warning_not_error(self):
        _, errors, warnings = fields.clean_inputs(inputs(currentBP=200, baselineBP=250))
        self.assertEqual(errors, {})
        self.assertEqual(warnings[0]["key"], "currentBP")

    def test_hash_changes_with_any_input(self):
        a = fields.inputs_hash("DEMO", inputs())
        self.assertNotEqual(a, fields.inputs_hash("DEMO", inputs(stackTempC=116)))
        self.assertNotEqual(a, fields.inputs_hash("USER", inputs()))
        self.assertEqual(a, fields.inputs_hash("DEMO", inputs()))

    def test_scenario_becomes_custom_when_changed(self):
        v = fields.scenario_inputs("ALARM")
        self.assertEqual(fields.effective_scenario(v, "ALARM"), "ALARM")
        self.assertEqual(fields.effective_scenario({**v, "currentBP": 343}, "ALARM"), "CUSTOM")


class PerformanceTests(SimpleTestCase):
    """기대값 = 키트 README 「기대값」 표 (기본값 초기화 = defaultInputs(D))."""

    def test_kit_defaults_kpi(self):
        r, loss = demo_calc.evaluate_performance("DEMO", None, inputs())
        self.assertEqual(r["currentBP"]["value"], 305.9)
        self.assertEqual(r["excessBP"]["value"], 51.0)
        self.assertAlmostEqual(loss, 1.89, places=9)
        self.assertEqual(r["lossMW"]["value"], 1.89)
        self.assertEqual(r["lossWonMonth"]["text"], "2.04억 원")
        self.assertEqual(r["warnings"], [])

    def test_gauge_index_and_curve(self):
        r, _ = demo_calc.evaluate_performance("DEMO", None, inputs())
        self.assertEqual(r["gauge"], {"valueMM": 51.0, "maxMM": 203.9, "refMM": [76.2, 101.6]})
        self.assertEqual((r["cleaningScore"]["value"], r["cleaningScore"]["bpPart"], r["cleaningScore"]["tempPart"]), (41.1, 33.3, 7.8))
        self.assertEqual((r["lossCurve"][0]["x"], r["lossCurve"][0]["y"]), (0.0, 1.89))
        self.assertEqual((r["lossCurve"][-1]["x"], r["lossCurve"][-1]["y"]), (203.9, 5.13))

    def test_user_mode_does_not_produce_model_results(self):
        r, loss = demo_calc.evaluate_performance("USER", None, inputs())
        self.assertIsNone(r["lossMW"]["value"])
        self.assertEqual(r["lossMW"]["rel"], "MODEL_NOT_CONNECTED")
        self.assertIsNone(loss)

    def test_scenario_status_comes_from_kit_levels(self):
        for sid, code in (("NORMAL", "NORMAL"), ("ALARM", "ALARM"), ("TRIP", "TRIP")):
            r, _ = demo_calc.evaluate_performance("DEMO", sid, fields.scenario_inputs(sid))
            self.assertEqual((r["scenario"], r["status"]["code"]), (sid, code))
        r, _ = demo_calc.evaluate_performance("DEMO", "TRIP", {**fields.scenario_inputs("TRIP"), "stackTempC": 113})
        self.assertEqual((r["scenario"], r["status"]["code"]), ("CUSTOM", "TRIP"))  # 값을 바꿔도 상태는 키트 판정

    def test_reset_defaults_equal_alarm_scenario(self):
        self.assertEqual(fields.effective_scenario(fields.DEFAULTS, "ALARM"), "ALARM")

    def test_reference_band_is_3_to_4_inh2o(self):
        r, _ = demo_calc.evaluate_performance("DEMO", None, inputs())
        self.assertEqual(r["referenceBand"]["mmH2O"], [76.2, 101.6])  # 1 inH₂O = 25.4 mmH₂O
        self.assertEqual(r["referenceBand"]["position"], "BELOW")  # 초과 51 mmH₂O


class EconomicsTests(SimpleTestCase):
    def test_kit_defaults_best_method_and_order(self):
        r = demo_calc.evaluate_economics(inputs())
        self.assertEqual(r["shortestPayback"], "DryIce")
        b = next(x for x in r["methods"] if x["key"] == "DryIce")
        self.assertEqual(b["recoveryMW"]["value"], 1.323)
        self.assertEqual((b["initialCost"]["text"], b["monthlyBenefit"]["text"], b["firstMonthNet"]["text"]), ("4.46억 원", "1.43억 원", "-3.03억 원"))
        self.assertEqual((b["paybackMonths"]["value"], b["bepDays"]["value"]), (3.12, 93.6))
        self.assertEqual(r["order"]["paybackMonths"], ["DryIce", "HighPressureWater", "Mechanical", "Chemical"])
        self.assertEqual(r["order"]["initialCost"], ["Mechanical", "HighPressureWater", "DryIce", "Chemical"])
        pays = {m["key"]: m["paybackMonths"]["value"] for m in r["methods"]}
        self.assertEqual(pays, {"DryIce": 3.12, "HighPressureWater": 3.3, "Mechanical": 3.54, "Chemical": 4.27})
        self.assertEqual([m["initialCost"]["text"] for m in r["methods"]], ["3.25억 원", "4.04억 원", "4.46억 원", "7.42억 원"])
        self.assertEqual(r["warnings"], [])

    def test_missing_method_inputs_are_null_with_reason(self):
        r = demo_calc.evaluate_economics(inputs(costHighPressureWater=None))
        hp = next(x for x in r["methods"] if x["key"] == "HighPressureWater")
        self.assertIsNone(hp["initialCost"]["value"])
        self.assertEqual(hp["initialCost"]["reason"]["ko"], "산출 불가 — 입력 필요: 세정 비용")
        self.assertIsNone(hp["paybackMonths"]["value"])

    def test_method_fields_are_optional(self):
        _, errors, _ = fields.clean_inputs(inputs(costDryIce="", outageDaysDryIce=""))
        self.assertEqual(errors, {})

    def test_method_specific_recovery_overrides_ratio(self):
        r = demo_calc.evaluate_economics(inputs(recoveryMWDryIce=1))
        m = next(x for x in r["methods"] if x["key"] == "DryIce")
        self.assertEqual(m["monthlyBenefit"]["value"], 1 * 720 * 150 * 1000)
        self.assertEqual(m["recoveryMW"]["source"], "METHOD")

    def test_sensitivity_matches_direct_calculation(self):
        r = demo_calc.evaluate_economics(inputs())
        i = r["sensitivity"]["smp"]["x"].index(200)
        direct = demo_calc.evaluate_economics(inputs(smpWonPerKWh=200))
        dm = next(x for x in direct["methods"] if x["key"] == "DryIce")
        self.assertEqual(r["sensitivity"]["smp"]["series"]["DryIce"][i], dm["paybackMonths"]["value"])


class PinchTests(SimpleTestCase):
    def test_iapws_verification_values(self):
        for p, ts in ((0.1, 372.755919), (1, 453.035632), (10, 584.149488)):  # IAPWS R7-97 Table 36
            self.assertAlmostEqual(saturation_temperature_k(p), ts, delta=1e-6)

    def test_kit_defaults_within_design(self):
        r = evaluate_pinch(inputs())
        self.assertEqual((round(r["pinch"]["value"], 1), round(r["approach"]["value"], 1)), (8.0, 5.0))
        self.assertEqual(r["level"], "normal")
        self.assertEqual(r["message"]["ko"], "설계 범위 안입니다.")
        a = evaluate_pinch(inputs(drumPressureBasis="absolute"))  # 절대압으로 읽으면 포화온도가 낮아짐
        self.assertLess(a["saturationTempC"]["value"], r["saturationTempC"]["value"])

    def test_design_diff_and_ranges(self):
        r = evaluate_pinch(inputs(pinchDesignC=10))
        self.assertEqual(r["designDiff"]["pinch"]["value"], round(r["pinch"]["value"] - 10, 2))
        self.assertEqual(r["ranges"]["demo"], {"pinch": [8, 15], "approach": [5, 12]})


class ReferenceTests(SimpleTestCase):
    def test_power_2015_case(self):
        """POWER 2015: 19.5 → 13.2 inH₂O 에 GE 계수 적용 = 0.66% (기사 값)."""
        ink = Fraction("249.08891") / 1000
        _, r = evaluate_reference({"current_dp_kpa": float(Fraction("19.5") * ink), "clean_dp_kpa": float(Fraction("13.2") * ink),
                                   "post_cleaning_dp_kpa": None, "gt_output_mw": None})
        self.assertEqual(r["effects"]["output_loss_pct"]["low"]["value"], 0.66)


class ComparisonTests(SimpleTestCase):
    def ms(self, *rows):
        return [{"id": i, "dayOffset": d, "backPressure": bp, "loadFactor": lf, "ambientTempC": at, "stackTempC": st}
                for i, (d, bp, lf, at, st) in enumerate(rows)]

    def test_no_measurements_no_actual_result(self):
        r = evaluate_comparison(inputs(), [])
        self.assertIsNone(r["kpi"])
        self.assertIsNone(r["actualPerformanceGap"])
        self.assertEqual(len(r["virtual"]["backPressure"]), 91)  # D-30 ~ D+60

    def test_t12_deviation_warning(self):
        ok = evaluate_comparison(inputs(), self.ms((-5, 350, 100, 15, 115), (5, 260, 97, 18, 100)))
        self.assertFalse(ok["deviation"]["exceeded"])
        bad_load = evaluate_comparison(inputs(), self.ms((-5, 350, 100, 15, 115), (5, 260, 94, 15, 100)))
        self.assertTrue(bad_load["deviation"]["exceeded"])
        bad_amb = evaluate_comparison(inputs(), self.ms((-5, 350, 100, 15, 115), (5, 260, 100, 20.5, 100)))
        self.assertTrue(bad_amb["deviation"]["exceeded"])
        self.assertIn("단정할 수 없습니다", bad_amb["deviation"]["message"]["ko"])

    def test_recovery_from_measured_bp(self):
        r = evaluate_comparison(inputs(capacityMW=150, baselineBP=250), self.ms((-1, 350, 100, 15, 115), (10, 270, 100, 15, 100)))
        # 손실 전 0.195 − 손실 후 (20/100×150×0.0013=0.039) = 0.156 MW
        self.assertEqual(r["kpi"]["recoveryMW"]["value"], 0.156)
        self.assertEqual(r["actualPerformanceGap"]["current_backPressure"], 270)


class KitAdapterTests(SimpleTestCase):
    """어댑터(engine/kit.py to_kit_inputs) 결과가 키트 validate_inputs 에서 오류·경고 0개인지 (README 요구)."""

    def test_defaults_and_scenarios_validate_clean(self):
        from . import kit
        for name, v in [("defaults", fields.DEFAULTS)] + [(k, fields.scenario_inputs(k)) for k in fields.SCENARIOS]:
            check = kit.calc.validate_inputs(kit.to_kit_inputs(v), kit.D())
            self.assertEqual((check["errors"], check["warnings"]), ([], []), name)

    def test_pressure_keys_carry_units_and_methods_come_from_data(self):
        from . import kit
        inp = kit.to_kit_inputs(fields.DEFAULTS)
        self.assertIn("gt_bp_mmh2o", inp["equipment"])
        self.assertIn("hrsg_dp_kpa", inp["equipment"])
        self.assertEqual([m["id"] for m in inp["methods"]], [m["id"] for m in kit.D()["methods"]])

    def test_progress_adapter_validates_clean(self):
        from types import SimpleNamespace
        from . import kit
        rows = [SimpleNamespace(item_id="A-01", supply_status=s, verify_status="VERIFIED", reviewed=True, value="1", memo="")
                for s in kit.SUPPLY_TO_KIT]
        for r in rows:
            check = kit.checklist.validate_progress(kit.C(), kit.to_kit_progress([r]))
            self.assertEqual((check["errors"], check["warnings"]), ([], []))
