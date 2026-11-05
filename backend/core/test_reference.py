"""Phase 6 검증: 공개 자료 기반 기능 (IAPWS-IF97, 문헌 참고 추정, 공개 SMP, 체크리스트 보강, 질문 답변).

기대값은 원문 값(IAPWS Table 36, POWER 2015 의 0.66%)과 분수 계산으로 따로 정합니다.
"""

import re
from fractions import Fraction

from calculators import demo_scenarios as demo
from calculators.iapws import saturation_temperature_k
from core.test_phase2 import ApiTestCase
from core.test_phase5 import round_half_up

J = "application/json"
IN_H2O_KPA = Fraction("249.08891") / 1000
NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def nums(text):
    return {float(n.replace(",", "")) for n in NUM.findall(text)}


class IapwsTests(ApiTestCase):
    def test_official_verification_values(self):
        # IAPWS R7-97(2012) Table 36
        for p, ts in ((0.1, 372.755919), (1, 453.035632), (10, 584.149488)):
            self.assertAlmostEqual(saturation_temperature_k(p), ts, delta=1e-6)

    def test_range_checked(self):
        with self.assertRaises(ValueError):
            saturation_temperature_k(23)
        with self.assertRaises(ValueError):
            saturation_temperature_k(0.0001)


class ReferenceEstimateTests(ApiTestCase):
    def setUp(self):
        self.cid = self.new_case("참고 추정")

    def ref(self, **inputs):
        res = self.client.put(f"/api/cases/{self.cid}/inputs/", {"reference_inputs": inputs}, content_type=J)
        self.assertEqual(res.status_code, 200, res.content)
        return self.client.post(f"/api/cases/{self.cid}/evaluate/reference/").json()

    def test_matches_published_case_power_2015(self):
        """POWER 2015: 19.5 → 13.2 in H2O (6.3 in) 에 GE 계수 적용 = 0.66% (기사에 적힌 값)."""
        cur, clean = float(Fraction("19.5") * IN_H2O_KPA), float(Fraction("13.2") * IN_H2O_KPA)
        out = self.ref(current_dp_kpa=cur, clean_dp_kpa=clean)
        e = out["result"]["effects"]
        self.assertEqual(out["result"]["dp_increase"]["in_h2o"]["value"], 6.3)
        self.assertEqual(e["output_loss_pct"]["low"]["value"], 0.66)
        self.assertEqual(e["heat_rate_increase_pct"]["value"], 0.66)
        self.assertEqual(out["result"]["trigger_position"], "ABOVE")  # 3~4 in 기준보다 높음
        self.assertEqual(out["meta"]["basis"], "REFERENCE_ESTIMATE")

    def test_against_fraction_reference(self):
        for cur, clean, mw in ((4.2, 3.3, 160), (5.0, 2.0, 250.5), (3.31, 3.3, 75)):
            out = self.ref(current_dp_kpa=cur, clean_dp_kpa=clean, gt_output_mw=mw)["result"]
            inc_in = (Fraction(str(cur)) - Fraction(str(clean))) / IN_H2O_KPA
            low, high = inc_in * Fraction("0.42") / 4, inc_in / 4
            e = out["effects"]
            self.assertEqual(e["output_loss_pct"]["low"]["value"], float(round_half_up(low, 2)))
            self.assertEqual(e["output_loss_pct"]["high"]["value"], float(round_half_up(high, 2)))
            self.assertEqual(e["output_loss_mw"]["low"]["value"], float(round_half_up(Fraction(str(mw)) * low / 100, 2)))
            self.assertEqual(e["output_loss_mw"]["high"]["value"], float(round_half_up(Fraction(str(mw)) * high / 100, 2)))
            self.assertEqual(e["exhaust_temp_increase_c"]["value"], float(round_half_up(inc_in * Fraction("1.1") / 4, 2)))

    def test_trigger_band_boundaries(self):
        clean = 3.0
        for inches, pos in ((2.99, "BELOW"), (3, "WITHIN"), (4, "WITHIN"), (4.01, "ABOVE")):
            cur = float(Fraction(str(clean)) + Fraction(str(inches)) * IN_H2O_KPA)
            self.assertEqual(self.ref(current_dp_kpa=cur, clean_dp_kpa=clean)["result"]["trigger_position"], pos, inches)

    def test_missing_negative_and_no_public_basis(self):
        r = self.ref(current_dp_kpa=4.2)["result"]
        self.assertIsNone(r["effects"])
        self.assertIn("신규·세정 직후 기준 차압", r["effects_reason"]["ko"])
        r = self.ref(current_dp_kpa=3.0, clean_dp_kpa=3.3)["result"]
        self.assertIsNone(r["effects"])
        self.assertIn("청정 기준보다 낮습니다", r["effects_reason"]["ko"])
        r = self.ref(current_dp_kpa=4.2, clean_dp_kpa=3.3)["result"]
        self.assertIsNone(r["effects"]["output_loss_mw"]["low"]["value"])  # 출력 MW 없으면 % 만
        self.assertIsNone(r["steam_turbine_loss"]["value"])
        self.assertIsNone(r["stack_temp_increase"]["value"])
        self.assertIn("공개 문헌", r["steam_turbine_loss"]["reason"]["ko"])
        res = self.client.put(f"/api/cases/{self.cid}/inputs/", {"reference_inputs": {
            "current_dp_kpa": 4, "clean_dp_kpa": 3, "post_cleaning_dp_kpa": 5}}, content_type=J)
        self.assertEqual(res.status_code, 400)
        self.assertIn("reference.post_cleaning_dp_kpa", res.json()["fields"])

    def test_demo_examples_inside_reference_range(self):
        """데모 예시 손실·회수값이 같은 입력의 문헌 참고 범위 안에 있는지 (예시 현실화 확인)."""
        for sid, s in demo.SCENARIOS.items():
            r = self.ref(**s["reference_inputs"])["result"]
            ex = s["result"]
            if ex["performance_loss"] is None:
                continue
            mw = r["effects"]["output_loss_mw"]
            rec = r["recovery"]["output_loss_mw"]
            # 범위가 아주 좁은 정상 시나리오는 반올림 고려 ±0.05
            self.assertLessEqual(mw["low"]["value"] - 0.05, ex["performance_loss"], sid)
            self.assertLessEqual(ex["performance_loss"], mw["high"]["value"] + 0.05, sid)
            self.assertLessEqual(rec["low"]["value"] - 0.05, ex["cleaning_recovery"], sid)
            self.assertLessEqual(ex["cleaning_recovery"], rec["high"]["value"] + 0.05, sid)

    def test_repeatable_and_stale(self):
        first = self.ref(current_dp_kpa=4.2, clean_dp_kpa=3.3, gt_output_mw=160)["result"]
        for _ in range(10):
            self.assertEqual(self.client.post(f"/api/cases/{self.cid}/evaluate/reference/").json()["result"], first)
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"reference_inputs": {"current_dp_kpa": 4.5, "clean_dp_kpa": 3.3}},
                        content_type=J)
        self.assertTrue(self.client.get(f"/api/cases/{self.cid}/results/").json()["REFERENCE"]["stale"])


class PinchReferenceTests(ApiTestCase):
    def test_gauge_vs_absolute_and_ranges(self):
        cid = self.new_case("핀치")
        put = lambda d: self.client.put(f"/api/cases/{cid}/inputs/", {"pinch_inputs": d}, content_type=J)  # noqa: E731
        put({"drum_pressure": 10, "drum_pressure_basis": "gauge", "eco_outlet_water_temp": 297, "evap_outlet_gas_temp": 320})
        r = self.client.post(f"/api/cases/{cid}/evaluate/pinch-approach/").json()["result"]
        expected = round(saturation_temperature_k(10.101325) - 273.15, 2)
        self.assertEqual(r["saturation_temp"]["value"], expected)
        self.assertEqual(r["drum_pressure_abs_mpa"], 10.101325)
        self.assertEqual(r["reference_ranges"], {"pinch_c": [5.56, 16.67], "approach_typical_c": 13.89})  # 10~30°F, 25°F
        put({"drum_pressure": 30, "drum_pressure_basis": "absolute", "eco_outlet_water_temp": 297, "evap_outlet_gas_temp": 320})
        r = self.client.post(f"/api/cases/{cid}/evaluate/pinch-approach/").json()["result"]
        self.assertIsNone(r["pinch"]["value"])
        self.assertIn("22.064 MPa", r["pinch"]["reason"]["ko"])
        put({"drum_pressure": 10, "drum_pressure_basis": "absolute", "eco_outlet_water_temp": 315, "evap_outlet_gas_temp": 320})
        r = self.client.post(f"/api/cases/{cid}/evaluate/pinch-approach/").json()["result"]
        self.assertIsNotNone(r["approach_steaming_note"])  # 어프로치 ≤ 0
        self.assertEqual(put({"drum_pressure_basis": "bar"}).status_code, 400)


class PublicSmpTests(ApiTestCase):
    def test_values_match_verified_kpx(self):
        data = self.client.get("/api/public/smp/").json()
        annual = {a["year"]: a["value"] for a in data["annual"]}
        self.assertEqual((annual["2023"], annual["2024"], annual["2025"]), (167.00, 128.33, 112.73))
        monthly = {m["month"]: m["value"] for m in data["monthly"]}
        self.assertEqual((monthly["2025-12"], monthly["2026-08"], monthly["2026-09"]), (90.43, 148.39, 119.02))
        self.assertEqual(len(monthly), 21)
        self.assertEqual(data["unit"], "원/kWh")

    def test_source_labels_verified_against_values(self):
        cid = self.new_case("출처")
        put = lambda a: self.client.put(f"/api/cases/{cid}/inputs/", {"economics_assumptions": a}, content_type=J).json()  # noqa: E731
        a = put({"smp": 112.73, "sources": {"smp": "PUBLIC"}})["economics_assumptions"]
        self.assertEqual(a["sources"]["smp"], "PUBLIC")
        a = put({"smp": 113, "sources": {"smp": "PUBLIC"}})["economics_assumptions"]
        self.assertEqual(a["sources"]["smp"], "USER")  # 공개값이 아니면 인정 안 함
        # 문헌 참고 추정 회수 출력: 저장된 결과 값일 때만 REFERENCE
        self.client.put(f"/api/cases/{cid}/inputs/", {"reference_inputs": {"current_dp_kpa": 4.2, "clean_dp_kpa": 3.3,
                        "post_cleaning_dp_kpa": 3.3, "gt_output_mw": 160}}, content_type=J)
        rec = self.client.post(f"/api/cases/{cid}/evaluate/reference/").json()["result"]["recovery"]["output_loss_mw"]
        a = put({"methods": {"A": {"recovered_mw": rec["low"]["value"]}, "B": {"recovered_mw": 0.7}},
                 "sources": {"A.recovered_mw": "REFERENCE", "B.recovered_mw": "REFERENCE"}})["economics_assumptions"]
        self.assertEqual((a["sources"]["A.recovered_mw"], a["sources"]["B.recovered_mw"]), ("REFERENCE", "USER"))

    def test_sources_endpoint_has_no_files(self):
        data = self.client.get("/api/public/sources/").json()
        keys = [s["key"] for s in data["sources"]]
        self.assertEqual(set(keys), {"GE_GER3567H", "IST_2000", "POWER_2015", "ASME_PTC44", "IAPWS_IF97", "KPX_SMP"})
        self.assertNotIn(".pdf", str(data).lower())


class ChecklistPublicRefTests(ApiTestCase):
    def test_new_items_have_reference(self):
        cid = self.new_case("체크리스트")
        items = {i["key"]: i for i in self.checklist(cid)["items"]}
        for key, ref in (("clean_hrsg_dp", "POWER_2015"), ("duct_burner_fuel_flow", "ASME_PTC44"),
                         ("gt_exhaust_flow_method", "ASME_PTC44")):
            self.assertEqual(items[key]["source"], "PUBLIC_REF")
            self.assertEqual(items[key]["reference"]["key"], ref)
        self.assertIsNone(items["gt_model"]["reference"])
        self.assertTrue(items["clean_hrsg_dp"]["required_for"]["PERFORMANCE"])


class QaPublicDataTests(ApiTestCase):
    def setUp(self):
        self.cid = self.new_case("질문")

    def ask(self, q):
        return self.client.post(f"/api/cases/{self.cid}/questions/", {"question": q}, content_type=J).json()

    def public_numbers(self):
        allowed = set()
        smp = self.client.get("/api/public/smp/").json()
        for m in smp["monthly"]:
            allowed |= {m["value"], *nums(m["month"])}
        for a in smp["annual"]:
            allowed |= {a["value"], float(a["year"])}
        allowed |= nums(str(self.client.get("/api/public/sources/").json()))
        allowed |= nums(smp["source"]["checked_on"])
        return allowed

    def test_smp_answer_uses_only_verified_values(self):
        a = self.ask("최근 SMP 실적은?")
        self.assertEqual(a["intent"], "SMP_DATA")
        self.assertIn("2025: 112.73", a["answer"])
        self.assertIn("2026-09: 119.02", a["answer"])
        self.assertIn("최저 90.43(2025-12)", a["answer"])
        self.assertEqual(nums(a["answer"]) - self.public_numbers(), set())
        self.assertEqual(a["citations"][0]["key"], "KPX_SMP")
        self.assertEqual(self.ask("내년 SMP는 얼마일까?")["intent"], "OUT_OF_SCOPE")

    def test_reference_answer_matches_saved_result(self):
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"reference_inputs": demo.SCENARIOS["DEMO-ALARM"]["reference_inputs"]},
                        content_type=J)
        res = self.client.post(f"/api/cases/{self.cid}/evaluate/reference/").json()["result"]
        a = self.ask("문헌 기반 참고 추정으로 출력 손실은 어느 정도인가요?")
        self.assertEqual(a["intent"], "REFERENCE_RESULT")
        e = res["effects"]
        self.assertIn(f"{e['output_loss_pct']['low']['value']}~{e['output_loss_pct']['high']['value']}%", a["answer"])
        self.assertIn(f"{e['output_loss_mw']['low']['value']}~{e['output_loss_mw']['high']['value']} MW", a["answer"])
        self.assertIn("승인 모델 아님", a["answer"])
        allowed = self.public_numbers()
        stack = [res]
        while stack:  # 저장된 결과의 모든 숫자
            x = stack.pop()
            if isinstance(x, bool):
                continue
            if isinstance(x, (int, float)):
                allowed.add(float(x))
            elif isinstance(x, dict):
                stack.extend(x.values())
            elif isinstance(x, list):
                stack.extend(x)
        allowed |= {3.0, 4.0}  # 세정 참고 기준 3~4 in H2O (POWER 2015)
        self.assertEqual(nums(a["answer"]) - allowed, set())
        keys = [c.get("key") for c in a["citations"]]
        self.assertTrue({"GE_GER3567H", "IST_2000", "POWER_2015"} <= set(keys))
