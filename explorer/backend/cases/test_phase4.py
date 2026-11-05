"""Phase 4: 대시보드 집계 (overview) — T04 계산기 → 대시보드, 재평가 상태, 추천 작업, 체크리스트 이동 링크."""

from engine import demo_calc
from django.test import TestCase
from accounts.testing import plant_client
from rest_framework.test import APIClient


class OverviewTests(TestCase):
    def setUp(self):
        self.api = plant_client()
        self.cid = self.api.post("/api/cases/", {"name": "P4"}, format="json").json()["id"]

    def ov(self):
        r = self.api.get(f"/api/cases/{self.cid}/overview/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def kpi(self, body, key):
        return next(k for k in body["kpis"] if k["key"] == key)

    def test_before_any_calculation(self):
        o = self.ov()
        self.assertEqual(len(o["kpis"]), 7)
        self.assertIsNone(self.kpi(o, "lossMW")["value"])
        self.assertEqual(self.kpi(o, "lossMW")["rel"], "UNAVAILABLE")
        self.assertIsNone(o["calc_summary_kpi"])
        self.assertEqual(o["recommendations"][0]["key"], "run")
        self.assertEqual(o["workflow"][1]["state"], "todo")
        self.assertEqual(o["workflow"][3]["state"], "todo")  # AI 검토: 질문 전
        self.assertNotIn("Phase", o["workflow"][3]["detail"]["ko"])

    def test_t04_calculator_change_reaches_dashboard(self):
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        o = self.ov()
        self.assertEqual(self.kpi(o, "lossMW")["value"], 1.89)  # 키트 README 기대값
        self.assertEqual(o["calc_summary_kpi"]["lossMW"], 1.89)
        # 배압 수정 → 아직 재평가 전: 이전 결과를 현재 값으로 보여 주지 않음
        values = self.api.get(f"/api/cases/{self.cid}/inputs/").json()["values"]
        self.api.put(f"/api/cases/{self.cid}/inputs/", {"values": {**values, "currentBP": 450}}, format="json")
        o = self.ov()
        k = self.kpi(o, "lossMW")
        self.assertIsNone(k["value"])
        self.assertEqual(k["rel"], "REEVALUATION_REQUIRED")
        self.assertEqual(k["previous"], 1.89)
        self.assertEqual(self.kpi(o, "backPressure")["value"], 450)  # 입력값은 저장 즉시 반영
        self.assertEqual(o["recommendations"][0]["key"], "rerun")
        # 재평가 → 같은 엔진(키트) 결과가 대시보드에 반영
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        o = self.ov()
        expected = demo_calc.evaluate_performance("DEMO", None, {**values, "currentBP": 450})[0]["lossMW"]["value"]
        self.assertGreater(expected, 1.89)
        self.assertEqual(self.kpi(o, "lossMW")["value"], expected)
        res = self.api.get(f"/api/cases/{self.cid}/results/").json()["results"]
        self.assertEqual(res["performance"]["payload"]["lossMW"]["value"], self.kpi(o, "lossMW")["value"])

    def test_t05_missing_items_link_to_checklist(self):
        o = self.ov()
        rec = next(r for r in o["recommendations"] if r["key"] == "missing")
        first = o["checklist"]["missingRequired"][0]["id"]
        self.assertEqual(rec["link"], f"/checklist?item={first}")
        self.assertEqual(o["checklist_readiness"]["totalCount"], 49)

    def test_actual_gap_only_with_measurements(self):
        self.assertIsNone(self.ov()["actual_performance_gap"])
        for d, bp in ((-2, 350), (5, 270)):
            self.api.post(f"/api/cases/{self.cid}/measurements/", {"dayOffset": d, "backPressure": bp}, format="json")
        gap = self.ov()["actual_performance_gap"]
        self.assertEqual(gap["current_backPressure"], 270)
        self.assertEqual(gap["actualRecoveryMW"], 0.155)  # 세정 전후는 이전 DEMO 공식 (기준 배압 305.9)

    def test_status_and_recovery_with_scenario(self):
        self.api.post(f"/api/cases/{self.cid}/inputs/reset/", {"scenario": "ALARM"}, format="json")
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        o = self.ov()
        self.assertEqual(o["status"]["code"], "ALARM")
        self.assertEqual(self.kpi(o, "recoveryPct")["rel"], "PUBLIC_REF")
        self.assertEqual(len(self.kpi(o, "recoveryPct")["value"]), 2)
        self.assertEqual(self.kpi(o, "stackTemp")["delta"], 5)  # 키트 기본값 95 − 설계 90
