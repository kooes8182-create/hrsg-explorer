"""Phase 3 API 테스트: 입력값·계산·재평가(T08)·체크리스트 검증(T09)·요청 메일(T10)·실측값(T11)·스냅샷·복제."""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import plant_client
from engine import fields


class Base(TestCase):
    def setUp(self):
        self.api = plant_client()
        self.cid = self.api.post("/api/cases/", {"name": "P3"}, format="json").json()["id"]

    def url(self, path=""):
        return f"/api/cases/{self.cid}/{path}"

    def put_values(self, mode="DEMO", scenario="CUSTOM", **over):
        values = {**self.api.get(self.url("inputs/")).json()["values"], **over}
        return self.api.put(self.url("inputs/"), {"mode": mode, "scenario": scenario, "values": values}, format="json")


class InputsAndEvaluationTests(Base):
    def test_new_case_gets_prompt_defaults(self):
        body = self.api.get(self.url("inputs/")).json()
        self.assertEqual(body["values"], fields.DEFAULTS)
        self.assertEqual(body["sources"]["capacityMW"], "DEMO")
        self.assertEqual(body["sources"]["baselineStackTempC"], "DEMO")  # 키트 기본값 (설계 스택 온도)
        self.assertEqual(body["scenario"], "ALARM")  # 키트 기본값 = 「오염 진행」 시나리오

    def test_invalid_inputs_rejected_and_not_saved(self):
        r = self.put_values(loadFactor=110, capacityMW="")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.json()["error"]["fields"]), {"loadFactor", "capacityMW"})
        self.assertEqual(self.api.get(self.url("inputs/")).json()["values"]["loadFactor"], 100)

    def test_evaluate_all_and_t07_through_api(self):
        r = self.api.post(self.url("evaluate/all/")).json()["results"]
        self.assertEqual(r["performance"]["payload"]["lossMW"]["value"], 1.89)  # 키트 README 기대값
        self.assertEqual(set(r), {"performance", "economics", "pinch", "reference"})

    def test_t08_input_change_marks_results_stale(self):
        self.api.post(self.url("evaluate/all/"))
        self.assertFalse(any(x["stale"] for x in self.api.get(self.url("results/")).json()["results"].values()))
        self.put_values(currentBP=351)
        res = self.api.get(self.url("results/")).json()["results"]
        self.assertTrue(all(x["stale"] for x in res.values()))
        # 이전 결과는 지우지 않고 남아 있음
        self.assertEqual(res["performance"]["payload"]["lossMW"]["value"], 1.89)

    def test_scenario_reset_and_custom_switch(self):
        r = self.api.post(self.url("inputs/reset/"), {"scenario": "TRIP"}, format="json").json()
        self.assertEqual(r["scenario"], "TRIP")
        self.assertEqual(r["values"]["currentBP"], fields.SCENARIOS["TRIP"]["values"]["currentBP"])
        r = self.put_values(scenario="TRIP", currentBP=420).json()
        self.assertEqual(r["scenario"], "CUSTOM")

    def test_user_mode_performance_not_connected(self):
        self.put_values(mode="USER")
        p = self.api.post(self.url("evaluate/performance/")).json()["results"]["performance"]["payload"]
        self.assertEqual(p["status"]["rel"], "MODEL_NOT_CONNECTED")
        self.assertIsNone(p["lossMW"]["value"])

    def test_unknown_kind_404(self):
        self.assertEqual(self.api.post(self.url("evaluate/nope/")).status_code, 404)

    def test_schema_has_units_and_scenarios(self):
        s = self.api.get("/api/inputs/schema/").json()
        self.assertAlmostEqual(s["units"]["kPa"]["factor"] / s["units"]["mmH2O"]["factor"], 0.00980665, places=12)
        self.assertEqual([x["id"] for x in s["scenarios"]], ["NORMAL", "ALARM", "TRIP"])


class SnapshotTests(Base):
    def test_snapshot_requires_fresh_results_and_restore(self):
        self.assertEqual(self.api.post(self.url("snapshots/"), {"label": "x"}, format="json").status_code, 409)
        self.api.post(self.url("evaluate/all/"))
        snap = self.api.post(self.url("snapshots/"), {"label": "기준"}, format="json").json()
        self.assertEqual(snap["summary"]["lossMW"], 1.89)
        self.put_values(currentBP=500)
        self.assertEqual(self.api.post(self.url("snapshots/"), {}, format="json").status_code, 409)
        restored = self.api.post(self.url(f"snapshots/{snap['id']}/restore/")).json()
        self.assertEqual(restored["values"]["currentBP"], fields.DEFAULTS["currentBP"])
        self.assertEqual(len(self.api.get(self.url("snapshots/")).json()), 1)


class ChecklistTests(Base):
    def patch(self, *updates):
        return self.api.patch(self.url("checklist/"), {"updates": list(updates)}, format="json")

    def test_items_and_summary(self):
        body = self.api.get(self.url("checklist/")).json()
        # 키트 README 기대값 (체크리스트 처음)
        sm = body["summary"]
        self.assertEqual(len(body["items"]), 49)
        self.assertEqual((sm["readinessRate"], sm["receivedCount"], sm["totalCount"]), (0, 0, 49))
        self.assertEqual((sm["requiredMetCount"], sm["requiredCount"]), (0, 16))
        self.assertEqual({k: f"{c['received']}/{c['total']}" for k, c in sm["byCategory"].items()},
                         {"A": "0/6", "B": "0/13", "C": "0/9", "D": "0/3", "E": "0/18"})
        self.assertEqual(sm["bySupply"]["NOT_ENTERED"], 49)
        self.assertEqual(len(sm["missingRequired"]), 16)
        self.assertEqual(len(body["filtered"]), 49)
        self.assertEqual(sum(sum(v.values()) for v in sm["matrix"].values()), 49)
        self.assertEqual(next(i for i in body["items"] if i["id"] == "B-09")["measure_cell"], "문서")
        self.assertEqual(body["progress_check"], {"ok": True, "errors": [], "warnings": []})

    def test_kit_filter_search_and_required(self):
        self.assertEqual(len(self.api.get(self.url("checklist/?q=핀치")).json()["filtered"]), 5)
        self.assertEqual(len(self.api.get(self.url("checklist/?required=1")).json()["filtered"]), 16)
        r = self.api.get(self.url("checklist/?category=B&supply=NOT_ENTERED")).json()
        self.assertEqual(len(r["filtered"]), 13)

    def test_received_rate_and_na(self):
        r = self.patch({"id": "A-01", "supply_status": "RECEIVED"}).json()["summary"]
        self.assertEqual((r["readinessRate"], r["receivedCount"], r["totalCount"]), (2, 1, 49))
        r = self.patch({"id": "A-02", "supply_status": "NA"}).json()["summary"]
        self.assertEqual(r["totalCount"], 48)  # 해당 없음은 분모에서 제외

    def test_t09_cannot_verify_without_value(self):
        r = self.patch({"id": "A-02", "verify_status": "VERIFIED"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("A-02.verify_status", r.json()["error"]["fields"])
        r = self.patch({"id": "A-02", "value": "350", "supply_status": "RECEIVED", "verify_status": "VERIFIED"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["summary"]["verifiedCount"], 1)

    def test_document_item_needs_confirmation(self):
        self.assertEqual(self.patch({"id": "B-09", "verify_status": "VERIFIED"}).status_code, 400)
        self.assertEqual(self.patch({"id": "B-09", "document_confirmed": True, "verify_status": "VERIFIED"}).status_code, 200)

    def test_number_value_must_be_numeric_and_bulk_is_all_or_nothing(self):
        r = self.patch({"id": "A-01", "reviewed": True}, {"id": "A-02", "value": "abc"})
        self.assertEqual(r.status_code, 400)
        items = {i["id"]: i for i in self.api.get(self.url("checklist/")).json()["items"]}
        self.assertFalse(items["A-01"]["state"]["reviewed"])  # 같은 요청의 다른 수정도 저장 안 됨

    def test_t10_request_text_uses_checked_ids(self):
        r = self.api.post(self.url("checklist/request-text/"), {"lang": "ko", "ids": ["A-02"], "plant": "가상 발전소"}, format="json").json()
        self.assertEqual((r["items"], r["count"]), (["A-02"], 1))
        self.assertIn("- A-02 운전 배압 (mmH₂O 또는 mbar) — 초과 배압과 출력 손실 계산 [필수]", r["body"])
        self.assertNotIn("A-03", r["body"])
        self.assertIn("가상 발전소", r["body"])
        # 체크한 ID 가 없으면 아직 받지 않은 항목 전부 (수령·해당 없음 제외)
        self.patch({"id": "A-03", "supply_status": "RECEIVED"}, {"id": "A-04", "supply_status": "NA"})
        allr = self.api.post(self.url("checklist/request-text/"), {"format": "html"}, format="json").json()
        self.assertEqual(allr["count"], 47)
        self.assertIn("<p>", allr["body"])


class MeasurementTests(Base):
    def test_t11_crud_and_comparison(self):
        r = self.api.post(self.url("measurements/"), {"dayOffset": -3, "backPressure": 350, "loadFactor": 100, "ambientTempC": 15}, format="json")
        self.assertEqual(r.status_code, 201)
        self.api.post(self.url("measurements/"), {"dayOffset": 7, "backPressure": 270, "loadFactor": 100, "ambientTempC": 16}, format="json")
        comp = self.api.post(self.url("evaluate/comparison/")).json()["results"]["comparison"]["payload"]
        self.assertEqual([p["x"] for p in comp["measured"]["backPressure"]], [-3, 7])
        self.assertEqual(comp["kpi"]["recoveryMW"]["value"], 0.155)  # 세정 전후는 이전 DEMO 공식 (기준 배압 305.9)
        # 실측값을 바꾸면 세정 전후 결과는 재평가 필요
        mid = r.json()["id"]
        self.api.patch(self.url(f"measurements/{mid}/"), {"backPressure": 360}, format="json")
        self.assertTrue(self.api.get(self.url("results/")).json()["results"]["comparison"]["stale"])
        self.assertEqual(self.api.delete(self.url(f"measurements/{mid}/")).status_code, 204)

    def test_validation(self):
        r = self.api.post(self.url("measurements/"), {"dayOffset": 1.5, "backPressure": "", "loadFactor": 110}, format="json")
        self.assertEqual(set(r.json()["error"]["fields"]), {"dayOffset", "backPressure", "loadFactor"})


class CloneTests(Base):
    def test_clone_copies_inputs_checklist_measurements_not_results(self):
        self.put_values(currentBP=400)
        self.api.patch(self.url("checklist/"), {"updates": [{"id": "A-02", "value": "400"}]}, format="json")
        self.api.post(self.url("measurements/"), {"dayOffset": -1, "backPressure": 400}, format="json")
        self.api.post(self.url("evaluate/all/"))
        c = self.api.post(self.url("clone/"), {}, format="json").json()
        nid = c["case"]["id"]
        self.assertEqual(self.api.get(f"/api/cases/{nid}/inputs/").json()["values"]["currentBP"], 400)
        items = {i["id"]: i for i in self.api.get(f"/api/cases/{nid}/checklist/").json()["items"]}
        self.assertEqual(items["A-02"]["state"]["value"], "400")
        self.assertEqual(len(self.api.get(f"/api/cases/{nid}/measurements/").json()), 1)
        self.assertEqual(self.api.get(f"/api/cases/{nid}/results/").json()["results"], {})
        # 독립성: 복제본 수정이 원본에 영향 없음 (T01)
        self.api.put(f"/api/cases/{nid}/inputs/", {"values": {**fields.DEFAULTS, "currentBP": 300}}, format="json")
        self.assertEqual(self.api.get(self.url("inputs/")).json()["values"]["currentBP"], 400)


class PublicTests(TestCase):
    def test_glossary_and_sources(self):
        api = plant_client()
        g = api.get("/api/glossary/").json()
        self.assertEqual(len(g["glossary"]), 12)
        self.assertEqual(g["categories"][1]["items"], [])  # 내부 승인 문서 없음
        self.assertEqual(len(api.get("/api/public/sources/").json()["sources"]), 6)
        self.assertEqual(api.get("/api/public/smp/").json()["annual"][-1], {"year": "2025", "value": 112.73})
