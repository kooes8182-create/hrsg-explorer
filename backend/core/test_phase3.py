"""Phase 3 검증: 데모 성능 평가, 실제 평가(모델 미연동), 가정 기반 경제성, 핀치·어프로치, 결과 무효화."""

from calculators import demo_scenarios as demo
from core.models import CalculationResult
from core.test_phase2 import ApiTestCase

J = "application/json"


class EvalTestCase(ApiTestCase):
    def setUp(self):
        self.cid = self.new_case("Phase3")

    def put(self, data, cid=None):
        return self.client.put(f"/api/cases/{cid or self.cid}/inputs/", data, content_type=J)

    def run_eval(self, kind, cid=None):
        res = self.client.post(f"/api/cases/{cid or self.cid}/evaluate/{kind}/")
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def results(self):
        return self.client.get(f"/api/cases/{self.cid}/results/").json()

    def choose(self, sid):
        res = self.put({"mode": "DEMO", "scenario_id": sid, "operating_values": demo.SCENARIOS[sid]["operating_values"]})
        self.assertEqual(res.status_code, 200, res.content)


class PerformanceDemoTests(EvalTestCase):
    def test_fixed_results_per_scenario(self):
        # Phase 6: 예시값을 문헌 참고 추정 범위 안의 값으로 조정 (specs/05 §2.2)
        expected = {"DEMO-NORMAL": ("NORMAL", 0.1, 0.1), "DEMO-ALARM": ("ALARM", 1.0, 0.8), "DEMO-TRIP": ("TRIP", None, None)}
        for sid, (status, loss, rec) in expected.items():
            self.choose(sid)
            out = self.run_eval("performance")
            r, m = out["result"], out["meta"]
            self.assertEqual((r["status"]["value"], r["performance_loss"]["value"], r["cleaning_recovery"]["value"]),
                             (status, loss, rec))
            self.assertEqual((m["basis"], m["model_version"], m["mode"], m["scenario_id"]),
                             ("DEMO_FIXED", "DEMO-SCENARIO-v1", "DEMO", sid))
            self.assertIn("시연용", m["notice"]["ko"])  # 입력·결과·상태 기준 모두 시연용 표시
            self.assertIn("실제 판정 기준이 적용되지 않았습니다", r["status_basis"]["ko"])
            self.assertEqual(r["performance_loss"]["unit"], "MW")
        trip = self.run_eval("performance")["result"]
        self.assertIn("예시값이 없습니다", trip["performance_loss"]["reason"]["ko"])  # null 에는 사유

    def test_same_input_same_result(self):
        for sid in demo.SCENARIOS:
            self.choose(sid)
            first = self.run_eval("performance")["result"]
            for _ in range(9):
                self.assertEqual(self.run_eval("performance")["result"], first)

    def test_modified_value_requires_reevaluation_and_revert_restores(self):
        self.choose("DEMO-ALARM")
        self.run_eval("performance")
        self.assertFalse(self.results()["PERFORMANCE"]["stale"])
        changed = {**demo.SCENARIOS["DEMO-ALARM"]["operating_values"], "hrsg_dp": 3.5}
        self.put({"operating_values": changed})
        self.assertTrue(self.results()["PERFORMANCE"]["stale"])  # 저장된 이전 결과는 무효
        out = self.run_eval("performance")
        self.assertEqual(out["meta"]["basis"], "REEVALUATION_REQUIRED")
        r = out["result"]
        self.assertIsNone(r["status"]["value"])
        self.assertIsNone(r["performance_loss"]["value"])  # 이전 2.4 를 그대로 보여주지 않음
        self.assertIn("재평가 필요", r["performance_loss"]["reason"]["ko"])
        self.assertIn("실제 모델 미연동", r["performance_loss"]["reason"]["ko"])
        self.choose("DEMO-ALARM")  # 시나리오 값으로 되돌리기
        self.assertEqual(self.run_eval("performance")["meta"]["basis"], "DEMO_FIXED")

    def test_string_equal_values_are_not_modifications(self):
        values = {k: (str(v) if not isinstance(v, str) else v) for k, v in demo.SCENARIOS["DEMO-NORMAL"]["operating_values"].items()}
        self.put({"mode": "DEMO", "scenario_id": "DEMO-NORMAL", "operating_values": values})
        self.assertEqual(self.run_eval("performance")["meta"]["basis"], "DEMO_FIXED")

    def test_demo_requires_scenario(self):
        res = self.put({"mode": "DEMO"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("scenario_id", res.json()["fields"])
        self.assertEqual(self.put({"mode": "DEMO", "scenario_id": "DEMO-X"}).status_code, 400)


class PerformanceRealTests(EvalTestCase):
    def test_real_mode_is_not_connected_and_never_demo(self):
        self.choose("DEMO-ALARM")  # 데모 값이 들어 있는 상태에서
        res = self.put({"mode": "REAL", "scenario_id": "DEMO-ALARM"})
        self.assertEqual(res.json()["scenario_id"], None)  # 실제 평가에는 시나리오를 연결하지 않음
        out = self.run_eval("performance")
        r, m = out["result"], out["meta"]
        self.assertEqual((m["basis"], m["model_version"], m["mode"]), ("UNAVAILABLE", "NOT-CONNECTED", "REAL"))
        for key in ("status", "performance_loss", "cleaning_recovery"):
            self.assertIsNone(r[key]["value"])
            self.assertTrue(r[key]["reason"]["ko"])
        self.assertIn("연동되지 않아", r["performance_loss"]["reason"]["ko"])
        self.assertNotIn("1.0", str(r["performance_loss"]))
        self.assertEqual(self.client.get(f"/api/cases/{self.cid}/").json()["mode"], "REAL")

    def test_new_case_defaults_to_real(self):
        out = self.run_eval("performance")
        self.assertEqual(out["meta"]["basis"], "UNAVAILABLE")
        self.assertEqual(len(out["meta"]["missing_inputs"]), 9)


EXAMPLE = {
    "smp": 120,
    "methods": {
        "A": {"recovered_mw": 1.5, "operating_hours": 4000, "cleaning_cost": 300000000, "extra_cost": 50000000},
        "B": {"recovered_mw": 1.0, "operating_hours": 4200, "cleaning_cost": 150000000, "extra_cost": 20000000},
    },
}


class EconomicsTests(EvalTestCase):
    def econ(self, assumptions):
        res = self.put({"economics_assumptions": assumptions})
        self.assertEqual(res.status_code, 200, res.content)
        return self.run_eval("economics")

    def method(self, out, key):
        return next(m for m in out["result"]["methods"] if m["key"] == key)

    def test_formula_example(self):
        out = self.econ(EXAMPLE)
        a, b = self.method(out, "A"), self.method(out, "B")
        # A: 1.5 MW × 1,000 × 4,000 h = 6,000,000 kWh × 120 = 720,000,000 − 300,000,000 − 50,000,000
        self.assertEqual((a["extra_kwh"]["value"], a["extra_kwh"]["unit"]), (6_000_000, "kWh"))
        self.assertEqual((a["revenue"]["value"], a["revenue"]["unit"]), (720_000_000, "원"))
        self.assertEqual(a["net_benefit"]["value"], 370_000_000)
        # B: 1.0 × 1,000 × 4,200 = 4,200,000 kWh × 120 = 504,000,000 − 150,000,000 − 20,000,000
        self.assertEqual((b["extra_kwh"]["value"], b["revenue"]["value"], b["net_benefit"]["value"]),
                         (4_200_000, 504_000_000, 334_000_000))
        self.assertEqual(out["result"]["max_net_benefit_method"], "A")
        self.assertEqual((out["meta"]["basis"], out["meta"]["model_version"]), ("USER_ASSUMPTION", "USER-ASSUMPTION-CALC-v1"))
        self.assertIn("단순 비교", out["result"]["notice"]["ko"])
        self.assertIn("실제 순이익", out["result"]["notice"]["ko"])

    def test_mw_to_kwh_conversion(self):
        out = self.econ({"smp": 100, "methods": {"A": {"recovered_mw": 1.5, "operating_hours": 1},
                                                  "B": {"recovered_mw": 0.001, "operating_hours": 1}}})
        self.assertEqual(self.method(out, "A")["extra_kwh"]["value"], 1500)  # 1.5 MW × 1 h = 1,500 kWh
        self.assertEqual(self.method(out, "B")["extra_kwh"]["value"], 1)  # 0.001 MW = 1 kW
        self.assertEqual(self.method(out, "A")["revenue"]["value"], 150_000)

    def test_negative_net_benefit(self):
        out = self.econ({"smp": 100, "methods": {"A": {"recovered_mw": 0.1, "operating_hours": 100,
                                                        "cleaning_cost": 5_000_000, "extra_cost": 0}}})
        a = self.method(out, "A")
        self.assertEqual(a["revenue"]["value"], 1_000_000)
        self.assertEqual(a["net_benefit"]["value"], -4_000_000)  # 음수 그대로 (0으로 자르지 않음)
        self.assertEqual(out["result"]["max_net_benefit_method"], "A")

    def test_missing_costs_not_treated_as_zero(self):
        out = self.econ({"smp": 120, "methods": {"A": {"recovered_mw": 1.5, "operating_hours": 4000,
                                                        "cleaning_cost": 300_000_000}}})
        a = self.method(out, "A")
        self.assertEqual(a["revenue"]["value"], 720_000_000)
        self.assertIsNone(a["net_benefit"]["value"])
        self.assertIn("정지 손실", a["net_benefit"]["reason"]["ko"])
        b = self.method(out, "B")
        self.assertIsNone(b["extra_kwh"]["value"])
        self.assertIn("회수 출력", b["extra_kwh"]["reason"]["ko"])
        self.assertIsNone(out["result"]["max_net_benefit_method"])
        self.assertFalse(out["result"]["complete"])
        self.assertIn("A.extra_cost", out["meta"]["missing_inputs"])

    def test_missing_smp(self):
        out = self.econ({"methods": EXAMPLE["methods"]})
        a = self.method(out, "A")
        self.assertEqual(a["extra_kwh"]["value"], 6_000_000)
        self.assertIsNone(a["revenue"]["value"])
        self.assertIn("SMP", a["revenue"]["reason"]["ko"])

    def test_no_double_subtraction(self):
        both = {"smp": 120, "methods": {"A": {"recovered_mw": 1.5, "operating_hours": 4000, "cleaning_cost": 300_000_000,
                                               "extra_cost": 50_000_000, "extra_cost_included": True}}}
        res = self.put({"economics_assumptions": both})
        self.assertEqual(res.status_code, 400)
        self.assertIn("economics.A.extra_cost", res.json()["fields"])
        both["methods"]["A"]["extra_cost"] = None
        a = self.method(self.econ(both), "A")
        self.assertEqual(a["net_benefit"]["value"], 420_000_000)  # 세정 비용만 1번 차감

    def test_validation(self):
        res = self.put({"economics_assumptions": {"smp": -1, "methods": {"A": {"cleaning_cost": "abc"}, "C": {}}}})
        self.assertEqual(res.status_code, 400)
        self.assertCountEqual(res.json()["fields"], ["economics.smp", "economics.A.cleaning_cost", "economics.methods"])
        ok = self.econ({"smp": "120", "methods": {"A": {"recovered_mw": "1.5", "operating_hours": "4,000",
                                                         "cleaning_cost": "300,000,000", "extra_cost": "0"}}})
        self.assertEqual(self.method(ok, "A")["net_benefit"]["value"], 420_000_000)

    def test_sources_demo_or_user(self):
        srcs = {"smp": "DEMO", "A.cleaning_cost": "DEMO", "A.extra_cost": "DEMO"}
        data = {**EXAMPLE, "methods": {**EXAMPLE["methods"], "A": {**EXAMPLE["methods"]["A"], "extra_cost": 1}}, "sources": srcs}
        out = self.econ(data)
        self.assertEqual(out["result"]["smp"]["source"], "DEMO")
        a = self.method(out, "A")["inputs"]
        self.assertEqual(a["cleaning_cost"]["source"], "DEMO")
        self.assertEqual(a["extra_cost"]["source"], "USER")  # 데모 값과 다르면 사용자 가정
        self.assertEqual(a["recovered_mw"]["source"], "USER")

    def test_same_input_same_result_and_snapshot_saved(self):
        first = self.econ(EXAMPLE)["result"]
        for _ in range(9):
            self.assertEqual(self.run_eval("economics")["result"], first)
        row = CalculationResult.objects.get(case_id=self.cid, kind="ECONOMICS")
        self.assertEqual(row.inputs_snapshot["economics_assumptions"]["smp"], 120)
        self.assertEqual(row.model_version, "USER-ASSUMPTION-CALC-v1")
        self.assertIsNotNone(row.computed_at)
        self.assertEqual(CalculationResult.objects.filter(case_id=self.cid).count(), 1)  # 덮어쓰기 (1건)


class StaleTests(EvalTestCase):
    def test_stale_is_per_kind(self):
        self.choose("DEMO-NORMAL")
        self.run_eval("performance")
        self.put({"economics_assumptions": EXAMPLE})
        self.run_eval("economics")
        self.put({"economics_assumptions": {**EXAMPLE, "smp": 130}})
        res = self.results()
        self.assertFalse(res["PERFORMANCE"]["stale"])  # SMP 변경은 성능 결과와 무관
        self.assertTrue(res["ECONOMICS"]["stale"])
        ov = self.client.get(f"/api/cases/{self.cid}/overview/").json()
        self.assertEqual(ov["next_actions"][0]["code"], "REEVALUATE")
        self.assertIn("경제성", ov["next_actions"][0]["text"])
        self.run_eval("economics")
        self.assertFalse(self.results()["ECONOMICS"]["stale"])

    def test_mode_change_makes_performance_stale(self):
        self.choose("DEMO-ALARM")
        self.run_eval("performance")
        self.put({"mode": "REAL"})
        self.assertTrue(self.results()["PERFORMANCE"]["stale"])

    def test_results_isolated_per_case(self):
        self.choose("DEMO-ALARM")
        self.run_eval("performance")
        other = self.new_case("other")
        res = self.client.get(f"/api/cases/{other}/results/").json()
        self.assertEqual(res, {"PERFORMANCE": None, "ECONOMICS": None, "PINCH_APPROACH": None, "REFERENCE": None})


class PinchTests(EvalTestCase):
    """Phase 6: IAPWS-IF97 포화온도로 참고 계산 (판정 없음). 상세 검증은 test_reference.py."""

    def test_reference_calculation_and_missing_inputs(self):
        self.put({"pinch_inputs": {"drum_pressure": 10, "drum_pressure_basis": "absolute",
                                   "eco_outlet_water_temp": 297, "evap_outlet_gas_temp": 320}})
        out = self.run_eval("pinch-approach")
        self.assertEqual(out["meta"]["basis"], "REFERENCE_ESTIMATE")
        r = out["result"]
        self.assertEqual((r["saturation_temp"]["value"], r["pinch"]["value"], r["approach"]["value"]), (311.0, 9.0, 14.0))
        self.put({"pinch_inputs": {"drum_pressure": 10}})
        r = self.run_eval("pinch-approach")["result"]
        self.assertIsNone(r["pinch"]["value"])
        self.assertIn("드럼 압력 기준", r["pinch"]["reason"]["ko"])
        self.assertIn("절탄기 출구 급수 온도", r["approach"]["reason"]["ko"])
        self.assertEqual(self.put({"pinch_inputs": {"drum_pressure": "x"}}).status_code, 400)


class ScenarioApiTests(ApiTestCase):
    def test_scenarios_have_inputs_but_no_results(self):
        data = self.client.get("/api/demo/scenarios/").json()
        self.assertEqual([s["id"] for s in data["scenarios"]], ["DEMO-NORMAL", "DEMO-ALARM", "DEMO-TRIP"])
        self.assertEqual(data["scenarios"][1]["label"]["ko"], "가상 경보")
        self.assertNotIn("result", data["scenarios"][0])
        self.assertEqual(data["economics_example"]["smp"], 120)
        self.assertEqual(self.client.post("/api/cases/1/evaluate/unknown/").status_code, 404)
