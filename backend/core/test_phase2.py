"""Phase 2 검증: 케이스, 체크리스트, 요청문, 운전 입력값, 평가 개요, 초기 데이터 명령."""

from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from core import checklist_seed as seed
from core.models import ChecklistItem, EvaluationCase

N_ITEMS = len(seed.CHECKLIST_CATALOG)


class ApiTestCase(TestCase):
    def new_case(self, name="케이스"):
        res = self.client.post("/api/cases/", {"name": name}, content_type="application/json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()["id"]

    def patch_items(self, case_id, items):
        return self.client.patch(f"/api/cases/{case_id}/checklist/", {"items": items},
                                 content_type="application/json")

    def checklist(self, case_id, query=""):
        res = self.client.get(f"/api/cases/{case_id}/checklist/{query}")
        self.assertEqual(res.status_code, 200)
        return res.json()

    def item(self, case_id, key):
        return next(i for i in self.checklist(case_id)["items"] if i["key"] == key)


class CaseTests(ApiTestCase):
    def test_create_case_copies_draft_checklist_empty(self):
        cid = self.new_case("가상 1")
        data = self.checklist(cid)
        self.assertEqual(N_ITEMS, 33)  # 계획서 기반 초안 30 + 공개 자료 참고 3 (Phase 6)
        self.assertEqual(len(data["items"]), N_ITEMS)
        self.assertTrue(all(i["value"] is None and i["status"] == "MISSING" for i in data["items"]))
        sources = [i["source"] for i in data["items"]]
        self.assertEqual((sources.count("PLAN_DRAFT"), sources.count("PUBLIC_REF")), (30, 3))
        self.assertEqual(data["source_label"]["ko"], "계획서 기반 초안")
        self.assertTrue(data["requirement_provisional"])
        self.assertEqual(self.client.get(f"/api/cases/{cid}/").json()["mode"], "REAL")

    def test_list_and_update(self):
        a, b = self.new_case("A"), self.new_case("B")
        ids = [c["id"] for c in self.client.get("/api/cases/").json()]
        self.assertCountEqual(ids, [a, b])
        res = self.client.patch(f"/api/cases/{a}/", {"name": " 새 이름 ", "memo": "메모"},
                                content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["name"], "새 이름")
        self.assertEqual(self.client.get(f"/api/cases/{a}/").json()["memo"], "메모")

    def test_name_required_and_404(self):
        res = self.client.post("/api/cases/", {"name": "  "}, content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("name", res.json()["fields"])
        res = self.client.get("/api/cases/9999/checklist/")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json(), {"error": "평가 케이스를 찾을 수 없습니다."})


class ChecklistTests(ApiTestCase):
    def setUp(self):
        self.cid = self.new_case()

    def test_value_entry_does_not_change_status(self):
        self.assertEqual(self.patch_items(self.cid, [{"key": "hrsg_dp", "value": "3.1"}]).status_code, 200)
        item = self.item(self.cid, "hrsg_dp")
        self.assertEqual((item["value"], item["status"]), ("3.1", "MISSING"))

    def test_all_fields_saved_and_restored(self):
        res = self.patch_items(self.cid, [{
            "key": "stack_temp", "value": "98", "unit": "degC", "condition": "부하 100%, 굴뚝 입구",
            "measured_at": "2026-10-01T09:30", "memo": "가상", "status": "RECEIVED"}])
        self.assertEqual(res.status_code, 200, res.content)
        item = self.item(self.cid, "stack_temp")  # 새 요청으로 다시 읽음 (= 새로고침)
        self.assertEqual(item["value"], "98")
        self.assertEqual(item["unit"], "degC")
        self.assertEqual(item["condition"], "부하 100%, 굴뚝 입구")
        self.assertTrue(item["measured_at"].startswith("2026-10-01T09:30:00+09:00"))
        self.assertEqual((item["memo"], item["status"]), ("가상", "RECEIVED"))

    def test_blank_value_is_null_not_zero(self):
        self.patch_items(self.cid, [{"key": "gt_load", "value": "100"}])
        self.patch_items(self.cid, [{"key": "gt_load", "value": "  "}])
        self.assertIsNone(self.item(self.cid, "gt_load")["value"])

    def test_verified_requires_value_and_batch_is_atomic(self):
        res = self.patch_items(self.cid, [
            {"key": "gt_load", "value": "100", "status": "RECEIVED"},
            {"key": "hrsg_dp", "status": "VERIFIED"},
        ])
        self.assertEqual(res.status_code, 400)
        self.assertIn("hrsg_dp", res.json()["items"])
        self.assertIsNone(self.item(self.cid, "gt_load")["value"])  # 같은 요청의 다른 항목도 저장 안 됨
        ok = self.patch_items(self.cid, [{"key": "hrsg_dp", "value": "2.5", "status": "VERIFIED"}])
        self.assertEqual(ok.status_code, 200)

    def test_unknown_key_and_bad_status(self):
        self.assertEqual(self.patch_items(self.cid, [{"key": "nope", "value": "1"}]).status_code, 400)
        self.assertEqual(self.patch_items(self.cid, [{"key": "gt_load", "status": "DONE"}]).status_code, 400)

    def test_filter_and_progress(self):
        self.patch_items(self.cid, [
            {"key": "gt_model", "value": "DEMO-GT", "status": "VERIFIED"},
            {"key": "gt_load", "value": "100", "status": "RECEIVED"},
            {"key": "stack_temp", "value": "95", "status": "RECEIVED"},
        ])
        data = self.checklist(self.cid)
        p = data["progress"]
        self.assertEqual((p["total"], p["missing"], p["received"], p["verified"]), (33, 30, 2, 1))
        self.assertEqual((p["received_pct"], p["verified_pct"]), (9, 3))  # 3/33, 1/33
        self.assertEqual(p["by_category"]["GT_INFO"]["received_or_verified"], 2)
        missing = self.checklist(self.cid, "?status=MISSING")["items"]
        self.assertEqual(len(missing), p["missing"])
        self.assertTrue(all(i["status"] == "MISSING" for i in missing))
        gt = self.checklist(self.cid, "?status=MISSING&category=GT_INFO")["items"]
        self.assertEqual([i["key"] for i in gt], ["gt_rated_output", "ambient_temp"])

    def test_required_flags_follow_draft(self):
        self.assertEqual(self.item(self.cid, "drum_pressure")["required_for"],
                         {"PERFORMANCE": False, "PINCH_APPROACH": True})
        self.assertEqual(self.item(self.cid, "hrsg_dp")["required_for"],
                         {"PERFORMANCE": True, "PINCH_APPROACH": False})


class RequestTextTests(ApiTestCase):
    def setUp(self):
        self.cid = self.new_case("가상 요청 케이스")

    def text(self, lang="ko"):
        return self.client.get(f"/api/cases/{self.cid}/checklist/request-text/?lang={lang}").json()

    def test_request_text_matches_missing_filter(self):
        self.patch_items(self.cid, [
            {"key": "gt_model", "value": "DEMO-GT", "status": "RECEIVED"},
            {"key": "drum_pressure", "value": "10", "status": "VERIFIED"},
        ])
        missing = self.checklist(self.cid, "?status=MISSING")["items"]
        t = self.text()
        self.assertEqual(t["keys"], [i["key"] for i in missing])
        self.assertEqual(t["count"], len(missing))
        for i in missing:
            self.assertIn(i["name_ko"], t["body"])
        self.assertNotIn("가스터빈 모델명", t["body"])
        self.assertNotIn("드럼 압력", t["body"])
        self.assertIn("계획서 기반 초안", t["body"])
        self.assertIn("가상 요청 케이스", t["subject"])
        self.assertTrue(t["text"].startswith("제목: "))

    def test_english_and_empty(self):
        en = self.text("en")
        self.assertIn("plan-based draft", en["body"])
        self.assertIn("Drum pressure (MPa)", en["body"])
        self.patch_items(self.cid, [{"key": i["key"], "status": "RECEIVED"} for i in seed.CHECKLIST_CATALOG])
        t = self.text()
        self.assertEqual((t["count"], t["keys"]), (0, []))
        self.assertEqual(t["body"], "미수신 항목이 없습니다.")


class InputsTests(ApiTestCase):
    def put(self, cid, values):
        return self.client.put(f"/api/cases/{cid}/inputs/", {"operating_values": values},
                               content_type="application/json")

    def test_save_and_reload(self):
        cid = self.new_case()
        empty = self.client.get(f"/api/cases/{cid}/inputs/").json()
        self.assertTrue(all(v is None for v in empty["operating_values"].values()))
        self.assertEqual(len(empty["fields"]), 9)
        res = self.put(cid, {"gt_model": "DEMO-GT", "hrsg_dp": 3.3, "stack_temp": "108", "gt_load": ""})
        self.assertEqual(res.status_code, 200, res.content)
        ov = self.client.get(f"/api/cases/{cid}/inputs/").json()["operating_values"]
        self.assertEqual((ov["gt_model"], ov["hrsg_dp"], ov["stack_temp"]), ("DEMO-GT", 3.3, 108))
        self.assertIsNone(ov["gt_load"])  # 빈 칸은 0이 아니라 null
        self.assertIsNone(ov["steam_flow"])

    def test_validation(self):
        cid = self.new_case()
        res = self.put(cid, {"hrsg_dp": "abc", "unknown": 1})
        self.assertEqual(res.status_code, 400)
        self.assertCountEqual(res.json()["fields"].keys(), ["hrsg_dp", "unknown"])
        self.assertEqual(self.put(cid, {"hrsg_dp": True}).status_code, 400)
        self.assertEqual(self.client.put(f"/api/cases/{cid}/inputs/", {}, content_type="application/json").status_code, 400)


class IsolationTests(ApiTestCase):
    def test_cases_do_not_mix(self):
        a, b = self.new_case("A"), self.new_case("B")
        self.patch_items(a, [{"key": "hrsg_dp", "value": "3.3", "status": "RECEIVED", "memo": "A 메모"}])
        self.client.put(f"/api/cases/{a}/inputs/", {"operating_values": {"hrsg_dp": 3.3}},
                        content_type="application/json")
        b_item = self.item(b, "hrsg_dp")
        self.assertEqual((b_item["value"], b_item["status"], b_item["memo"]), (None, "MISSING", ""))
        self.assertIsNone(self.client.get(f"/api/cases/{b}/inputs/").json()["operating_values"]["hrsg_dp"])
        self.assertEqual(self.checklist(b)["progress"]["missing"], N_ITEMS)
        self.assertIn("HRSG 가스측 차압", self.client.get(f"/api/cases/{b}/checklist/request-text/").json()["body"])
        self.assertNotIn("HRSG 가스측 차압", self.client.get(f"/api/cases/{a}/checklist/request-text/").json()["body"])


class OverviewTests(ApiTestCase):
    def overview(self, cid, lang="ko"):
        return self.client.get(f"/api/cases/{cid}/overview/?lang={lang}").json()

    def test_new_case_overview(self):
        cid = self.new_case()
        ov = self.overview(cid)
        self.assertEqual(ov["readiness"]["missing"], N_ITEMS)
        codes = [a["code"] for a in ov["next_actions"]]
        self.assertEqual(codes, ["REQUEST_MISSING", "ENTER_OPERATING", "ENTER_ECONOMICS"])  # Phase 3: 경제성 안내 추가
        self.assertIn("필수 21개", ov["next_actions"][0]["text"])  # 성능 18(청정 기준 차압 추가) + 핀치 3 (임시 기준)
        real = ov["evaluations"][0]
        self.assertEqual((real["kind"], real["mode"], real["available"]), ("PERFORMANCE", "REAL", False))
        self.assertIn("모델", real["reason"])
        self.assertEqual(real["required"], {"received": 0, "total": 18, "provisional": True})
        self.assertEqual(ov["evaluations"][4]["kind"], "PINCH_APPROACH")
        self.assertEqual(ov["evaluations"][4]["required"]["total"], 3)
        # 실제 평가 불가, DEMO 가능, 경제성·문헌 참고 추정·핀치 참고 계산은 입력 전이라 불가
        self.assertEqual([e["kind"] for e in ov["evaluations"]],
                         ["PERFORMANCE", "PERFORMANCE", "ECONOMICS", "REFERENCE", "PINCH_APPROACH"])
        self.assertEqual([e["available"] for e in ov["evaluations"]], [False, True, False, False, False])
        self.assertIn("items not received", self.overview(cid, "en")["next_actions"][0]["text"])

    def test_actions_follow_progress(self):
        cid = self.new_case()
        self.patch_items(cid, [{"key": i["key"], "value": "1", "status": "RECEIVED"} for i in seed.CHECKLIST_CATALOG])
        codes = [a["code"] for a in self.overview(cid)["next_actions"]]
        self.assertEqual(codes, ["VERIFY_RECEIVED", "ENTER_OPERATING", "ENTER_ECONOMICS"])
        self.patch_items(cid, [{"key": i["key"], "status": "VERIFIED"} for i in seed.CHECKLIST_CATALOG])
        self.client.put(f"/api/cases/{cid}/inputs/", {"operating_values": {
            "gt_model": "DEMO-GT", "gt_load": 1, "ambient_temp": 1, "gt_exhaust_temp": 1, "gt_exhaust_flow": 1,
            "gt_back_pressure": 1, "hrsg_dp": 1, "stack_temp": 1, "steam_flow": 1}}, content_type="application/json")
        self.assertEqual([a["code"] for a in self.overview(cid)["next_actions"]], ["ENTER_ECONOMICS"])
        self.client.put(f"/api/cases/{cid}/inputs/", {"economics_assumptions": {"smp": 100, "methods": {"A": {
            "recovered_mw": 1, "operating_hours": 1, "cleaning_cost": 0, "extra_cost": 0}}}},
            content_type="application/json")
        self.assertEqual([a["code"] for a in self.overview(cid)["next_actions"]], ["ALL_DONE"])


class SeedCommandTests(ApiTestCase):
    def run_seed(self):
        out = StringIO()
        call_command("seed_demo_cases", stdout=out)
        return out.getvalue()

    def test_idempotent_and_keeps_user_edits(self):
        self.run_seed()
        self.assertEqual(EvaluationCase.objects.filter(seed_key__isnull=False).count(), 3)  # A, B, C
        a = EvaluationCase.objects.get(seed_key="demo-case-a")
        self.assertEqual(self.item(a.id, "gt_model")["status"], "VERIFIED")
        # 사용자가 시드 케이스를 수정
        self.client.patch(f"/api/cases/{a.id}/", {"name": "내가 바꾼 이름"}, content_type="application/json")
        self.patch_items(a.id, [{"key": "gt_model", "value": "DEMO-GT-2", "status": "RECEIVED"}])
        out = self.run_seed()
        self.assertIn("이미 있음", out)
        self.assertEqual(EvaluationCase.objects.count(), 3)
        self.assertEqual(ChecklistItem.objects.count(), 3 * N_ITEMS)
        a.refresh_from_db()
        self.assertEqual(a.name, "내가 바꾼 이름")
        item = self.item(a.id, "gt_model")
        self.assertEqual((item["value"], item["status"]), ("DEMO-GT-2", "RECEIVED"))

    def test_new_catalog_item_is_added_without_touching_values(self):
        self.run_seed()
        a = EvaluationCase.objects.get(seed_key="demo-case-a")
        extra = seed._item("GT_INFO", "form_extra", "양식 추가 항목", "Form extra", "—",
                           source=seed.SOURCE_COMPANY_FORM)
        with mock.patch.object(seed, "CHECKLIST_CATALOG", seed.CHECKLIST_CATALOG + [extra]):
            out = self.run_seed()
        self.assertIn("빠진 항목 3개 추가", out)
        new = self.item(a.id, "form_extra")
        self.assertEqual((new["value"], new["status"], new["source"]), (None, "MISSING", "COMPANY_FORM"))
        self.assertEqual(self.item(a.id, "gt_model")["value"], "DEMO-GT")

    def test_case_c_has_all_results_from_server_calculators(self):
        self.run_seed()
        c = EvaluationCase.objects.get(seed_key="demo-case-c")
        res = self.client.get(f"/api/cases/{c.id}/results/").json()
        self.assertEqual({k: v["meta"]["basis"] for k, v in res.items()}, {
            "PERFORMANCE": "DEMO_FIXED", "REFERENCE": "REFERENCE_ESTIMATE", "ECONOMICS": "USER_ASSUMPTION",
            "PINCH_APPROACH": "REFERENCE_ESTIMATE"})
        self.assertFalse(any(v["stale"] for v in res.values()))
        self.assertEqual(res["ECONOMICS"]["result"]["smp"], {"value": 112.73, "unit": "원/kWh", "reason": None, "source": "PUBLIC"})


class CaseDeleteTests(ApiTestCase):
    def test_delete_requires_exact_name_and_removes_everything(self):
        from core.models import CalculationInput, CalculationResult, QuestionLog
        keep, cid = self.new_case("남길 케이스"), self.new_case("지울 케이스")
        self.patch_items(cid, [{"key": "hrsg_dp", "value": "4.2", "status": "RECEIVED"}])
        self.client.post(f"/api/cases/{cid}/evaluate/performance/")
        self.client.post(f"/api/cases/{cid}/questions/", {"question": "부족한 데이터는?"}, content_type="application/json")
        url = f"/api/cases/{cid}/"
        for wrong in ({}, {"confirm_name": "지울"}, {"confirm_name": "남길 케이스"}):
            res = self.client.delete(url, wrong, content_type="application/json")
            self.assertEqual(res.status_code, 400, wrong)
            self.assertIn("confirm_name", res.json()["fields"])
        self.assertEqual(self.client.get(url).status_code, 200)  # 아직 남아 있음
        res = self.client.delete(url, {"confirm_name": " 지울 케이스 "}, content_type="application/json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(self.client.get(url).status_code, 404)
        for model in (ChecklistItem, CalculationInput, CalculationResult, QuestionLog):
            self.assertFalse(model.objects.filter(case_id=cid).exists(), model.__name__)
        self.assertEqual(self.checklist(keep)["progress"]["total"], N_ITEMS)  # 다른 케이스는 그대로
        self.assertEqual(self.client.delete("/api/cases/9999/", {"confirm_name": "x"}, content_type="application/json").status_code, 404)
