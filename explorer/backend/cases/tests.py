"""Phase 2 서버 테스트: 케이스 CRUD·복제·독립성(T01)·마지막 케이스 삭제 차단(T02)·오류 형식."""

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import plant_client
from .models import EvaluationCase


class CaseApiTests(TestCase):
    def setUp(self):
        self.api = plant_client()

    def create(self, name="케이스", memo=""):
        r = self.api.post("/api/cases/", {"name": name, "memo": memo}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_create_and_list(self):
        self.create("A")
        self.create("B")
        names = [c["name"] for c in self.api.get("/api/cases/").json()]
        self.assertEqual(names, ["A", "B"])

    def test_create_requires_name(self):
        r = self.api.post("/api/cases/", {"name": "   "}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "VALIDATION_ERROR")
        self.assertIn("name", r.json()["error"]["fields"])

    def test_rename(self):
        c = self.create("A")
        r = self.api.patch(f"/api/cases/{c['id']}/", {"name": "A2"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "A2")

    def test_t01_cases_are_independent(self):
        a, b = self.create("A", "메모 A"), self.create("B", "메모 B")
        self.api.patch(f"/api/cases/{a['id']}/", {"memo": "A 수정"}, format="json")
        self.assertEqual(self.api.get(f"/api/cases/{b['id']}/").json()["memo"], "메모 B")
        self.assertEqual(self.api.get(f"/api/cases/{a['id']}/").json()["memo"], "A 수정")

    def test_clone_copies_info_and_reports_policy(self):
        a = self.create("A", "메모")
        r = self.api.post(f"/api/cases/{a['id']}/clone/", {}, format="json")
        self.assertEqual(r.status_code, 201)
        body = r.json()
        self.assertEqual(body["case"]["name"], "A (사본)")
        self.assertEqual(body["case"]["memo"], "메모")
        self.assertEqual(body["case"]["cloned_from"], a["id"])
        self.assertIn("conversations", body["policy"]["not_copied"])
        # 복제본을 바꿔도 원본은 그대로
        self.api.patch(f"/api/cases/{body['case']['id']}/", {"memo": "사본 수정"}, format="json")
        self.assertEqual(self.api.get(f"/api/cases/{a['id']}/").json()["memo"], "메모")

    def test_t02_last_case_cannot_be_deleted(self):
        a, b = self.create("A"), self.create("B")
        self.assertEqual(self.api.delete(f"/api/cases/{a['id']}/").status_code, 204)
        r = self.api.delete(f"/api/cases/{b['id']}/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "LAST_CASE")
        self.assertTrue(EvaluationCase.objects.filter(pk=b["id"]).exists())

    def test_not_found_uses_common_error_format(self):
        r = self.api.get("/api/cases/999999/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"]["code"], "NOT_FOUND")
        self.assertIn("ko", r.json()["error"]["message"])

    def test_seed_is_idempotent_and_keeps_user_edits(self):
        call_command("seed_demo_cases", stdout=open("/dev/null", "w"))
        case = EvaluationCase.objects.get(seed_key="DEMO-1")
        case.name = "사용자가 바꾼 이름"
        case.save()
        call_command("seed_demo_cases", stdout=open("/dev/null", "w"))
        self.assertEqual(EvaluationCase.objects.filter(seed_key="DEMO-1").count(), 1)
        self.assertEqual(EvaluationCase.objects.get(seed_key="DEMO-1").name, "사용자가 바꾼 이름")
        self.assertTrue(self.api.get(f"/api/cases/{case.id}/").json()["is_demo"])
