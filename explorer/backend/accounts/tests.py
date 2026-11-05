"""로그인·역할별 접근 제어 검사 — 실제 세션 로그인과 서버 권한표(accounts.policy)를 그대로 거칩니다."""

import io
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.urls import get_resolver
from rest_framework.test import APIClient

from rag import official as O

from . import policy
from .models import UserProfile
from .testing import admin_client, client_for, make_user, plant_client

PW = "Right-Pass-2026!"


def login(client, emp, pw):
    client.get("/api/auth/me/")  # CSRF 쿠키 받기
    token = client.cookies["csrftoken"].value
    return client.post("/api/auth/login/", {"employee_id": emp, "password": pw}, format="json", HTTP_X_CSRFTOKEN=token)


class LoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.pe = make_user("PLANT_ENGINEER", "70001234", PW)
        self.aa = make_user("AI_ADMIN", "70005678", PW)

    def test_both_roles_login_with_server_role_and_home(self):
        for emp, role, home in [("70001234", "PLANT_ENGINEER", "/dashboard"), ("70005678", "AI_ADMIN", "/rag-evaluation")]:
            c = APIClient(enforce_csrf_checks=True)
            r = login(c, emp, PW)
            self.assertEqual(r.status_code, 200, r.content)
            self.assertEqual((r.json()["user"]["role"], r.json()["user"]["home"]), (role, home))
            self.assertTrue(c.get("/api/auth/me/").json()["authenticated"])

    def test_wrong_password_and_unknown_id_look_the_same(self):
        a = login(APIClient(enforce_csrf_checks=True), "70001234", "nope")
        b = login(APIClient(enforce_csrf_checks=True), "99999999", "nope")
        self.assertEqual((a.status_code, b.status_code), (401, 401))
        self.assertEqual(a.json()["error"]["message"], b.json()["error"]["message"])
        self.assertEqual(a.json()["error"]["message"]["ko"], "사번 또는 비밀번호를 확인해 주세요.")

    def test_login_through_dev_proxy_origin(self):
        """PC 개발 서버(5174)를 거친 요청: Origin=localhost:5174, Host=127.0.0.1:8002 — 실제 화면에서 생긴 CSRF 실패 회귀 방지"""
        c = APIClient(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8002")
        c.get("/api/auth/me/")
        ok = c.post("/api/auth/login/", {"employee_id": "70001234", "password": PW}, format="json",
                    HTTP_X_CSRFTOKEN=c.cookies["csrftoken"].value, HTTP_ORIGIN="http://localhost:5174")
        self.assertEqual(ok.status_code, 200, ok.content)
        c2 = APIClient(enforce_csrf_checks=True, HTTP_HOST="127.0.0.1:8002")
        c2.get("/api/auth/me/")
        bad = c2.post("/api/auth/login/", {"employee_id": "70001234", "password": PW}, format="json",
                      HTTP_X_CSRFTOKEN=c2.cookies["csrftoken"].value, HTTP_ORIGIN="http://evil.example")
        self.assertEqual(bad.status_code, 403)  # 다른 출처는 거부

    def test_login_requires_csrf_token(self):
        c = APIClient(enforce_csrf_checks=True)
        r = c.post("/api/auth/login/", {"employee_id": "70001234", "password": PW}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_rate_limit_after_five_failures(self):
        c = APIClient(enforce_csrf_checks=True)
        for _ in range(5):
            self.assertEqual(login(c, "70001234", "bad").status_code, 401)
        self.assertEqual(login(c, "70001234", PW).status_code, 429)  # 맞는 비밀번호도 잠시 막음

    def test_role_comes_from_server_not_request(self):
        c = APIClient(enforce_csrf_checks=True)
        c.get("/api/auth/me/")
        r = c.post("/api/auth/login/", {"employee_id": "70001234", "password": PW, "role": "AI_ADMIN"}, format="json",
                   HTTP_X_CSRFTOKEN=c.cookies["csrftoken"].value)
        self.assertEqual(r.json()["user"]["role"], "PLANT_ENGINEER")
        self.assertEqual(c.get("/api/rag/experiments/?role=AI_ADMIN", HTTP_X_ROLE="AI_ADMIN").status_code, 403)

    def test_account_without_role_or_superuser_gets_nothing(self):
        get_user_model().objects.create_superuser("root01", password=PW)
        self.assertEqual(login(APIClient(enforce_csrf_checks=True), "root01", PW).status_code, 401)
        su = client_for(user=get_user_model().objects.get(username="root01"))
        self.assertEqual(su.get("/api/cases/").status_code, 403)
        self.assertEqual(su.get("/api/rag/experiments/").status_code, 403)

    def test_logout_ends_server_session(self):
        c = APIClient(enforce_csrf_checks=True)
        login(c, "70001234", PW)
        self.assertEqual(c.get("/api/cases/").status_code, 200)
        r = c.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=c.cookies["csrftoken"].value)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(c.get("/api/cases/").status_code, 401)
        self.assertFalse(c.get("/api/auth/me/").json()["authenticated"])

    def test_expired_session_is_401(self):
        c = APIClient(enforce_csrf_checks=True)
        login(c, "70001234", PW)
        Session.objects.all().delete()  # 서버 세션 만료와 같은 상태
        self.assertEqual(c.get("/api/cases/").status_code, 401)

    def test_inactive_account_cannot_login(self):
        self.pe.is_active = False
        self.pe.save()
        self.assertEqual(login(APIClient(enforce_csrf_checks=True), "70001234", PW).status_code, 401)


class AccessTests(TestCase):
    """역할별 API 권한 (읽기·쓰기)"""

    @classmethod
    def setUpTestData(cls):
        cls.pe_user = make_user("PLANT_ENGINEER")

    def setUp(self):
        self.pe = client_for(user=self.pe_user)
        self.aa = admin_client()
        self.cid = self.pe.post("/api/cases/", {"name": "A"}, format="json").json()["id"]

    def plant_urls(self):
        c = self.cid
        return [("get", "/api/cases/"), ("get", f"/api/cases/{c}/overview/"), ("get", f"/api/cases/{c}/inputs/"), ("get", f"/api/cases/{c}/checklist/"),
                ("get", f"/api/cases/{c}/measurements/"), ("get", f"/api/cases/{c}/snapshots/"), ("get", "/api/glossary/"), ("get", "/api/notifications/"),
                ("get", f"/api/cases/{c}/conversations/"), ("post", f"/api/cases/{c}/evaluate/all/"), ("get", "/api/public/smp/")]

    def admin_urls(self):
        return [("get", "/api/rag/experiments/"), ("get", "/api/knowledge/papers/"), ("get", "/api/knowledge/uploads/"), ("get", "/api/rag/labels/"),
                ("get", "/api/rag/feedback/export/"), ("get", "/api/knowledge/jobs/")]

    def test_anonymous_gets_401_everywhere_but_health(self):
        anon = APIClient()
        for m, u in self.plant_urls() + self.admin_urls() + [("get", "/api/rag/info/")]:
            self.assertEqual(getattr(anon, m)(u).status_code, 401, u)
        self.assertEqual(anon.get("/api/health/").status_code, 200)

    def test_plant_engineer_uses_plant_apis_but_not_rag_admin(self):
        for m, u in self.plant_urls():
            self.assertLess(getattr(self.pe, m)(u).status_code, 400, u)
        for m, u in self.admin_urls() + [("post", "/api/rag/compare/"), ("post", "/api/rag/search/"), ("post", "/api/knowledge/upload-search/")]:
            self.assertEqual(getattr(self.pe, m)(u, {}, format="json").status_code if m == "post" else self.pe.get(u).status_code, 403, u)

    def test_ai_admin_reads_rag_but_not_plant(self):
        for m, u in self.admin_urls():
            self.assertEqual(getattr(self.aa, m)(u).status_code, 200, u)
        for m, u in self.plant_urls():
            self.assertEqual(getattr(self.aa, m)(u).status_code, 403, u)
        self.assertEqual(self.aa.post(f"/api/cases/{self.cid}/conversations/", {}, format="json").status_code, 403)  # 챗봇도 플랜트 전용

    def test_admin_write_actions_are_blocked(self):
        for m, u in [("post", "/api/rag/experiments/run-dev/"), ("post", "/api/knowledge/uploads/"), ("post", "/api/knowledge/reindex/"),
                     ("post", "/api/knowledge/uploads/1/reembed/"), ("post", "/api/knowledge/uploads/1/reprocess/"), ("delete", "/api/knowledge/uploads/1/"),
                     ("post", "/api/rag/labels/"), ("delete", "/api/rag/labels/1/"), ("get", "/api/settings/"), ("patch", "/api/settings/")]:
            for c in (self.aa, self.pe):
                self.assertEqual(getattr(c, m)(u, {}, format="json").status_code, 403, (m, u))

    def test_attachment_file_view_is_protected(self):
        import tempfile
        from pathlib import Path

        from django.core.files.uploadedfile import SimpleUploadedFile
        with tempfile.TemporaryDirectory() as d, mock.patch("cases.photos.PHOTO_DIR", Path(d)):
            att = self.pe.post(f"/api/cases/{self.cid}/checklist/A-02/attachments/", {"file": SimpleUploadedFile("p.jpg", b"\xff\xd8\xff\xe0" + b"0" * 40)}, format="multipart").json()
            self.assertEqual(self.pe.get(att["url"]).status_code, 200)
            self.assertEqual(self.aa.get(att["url"]).status_code, 403)
            self.assertEqual(APIClient().get(att["url"]).status_code, 401)

    def test_every_route_is_classified_and_unclassified_is_denied(self):
        names = set()

        def walk(ps):
            for p in ps:
                if hasattr(p, "url_patterns"):
                    walk(p.url_patterns)
                elif p.name:
                    names.add(p.name)
        walk(get_resolver().url_patterns)
        self.assertEqual(sorted(names - set(policy.POLICY)), [])  # 모든 API 가 권한표에 있음
        table = {k: v for k, v in policy.POLICY.items() if k != "case-list"}
        with mock.patch.object(policy, "POLICY", table):
            self.assertEqual(self.pe.get("/api/cases/").status_code, 403)  # 표에 없으면 기본 거부

    def test_chat_answer_and_info_hide_admin_debug_data(self):
        with mock.patch.dict(O.get(load_model=False), {"vector": "unavailable", "vector_reason": "테스트"}):
            conv = self.pe.post(f"/api/cases/{self.cid}/conversations/", {}, format="json").json()["id"]
            out = self.pe.post(f"/api/conversations/{conv}/messages/", {"question": "pinch point definition"}, format="json").json()
        p = out["assistant"]["payload"]
        self.assertTrue(p["evidence"])
        for e in p["evidence"]:
            self.assertFalse({"bm25_score", "cosine", "rrf", "bm25_rank", "dense_rank"} & set(e))
        self.assertFalse({"timing", "config", "include_uploads"} & set(p))
        self.assertFalse(self.pe.get(f"/api/conversations/{conv}/").json()["messages"][-1]["payload"].get("timing"))
        info = self.pe.get("/api/rag/info/").json()
        self.assertFalse({"configs", "locked"} & set(info))
        self.assertNotIn("sha256", info["corpus"])
        self.assertIn("configs", self.aa.get("/api/rag/info/").json())


class DemoAccountCommandTests(TestCase):
    def run_cmd(self, *args):
        out = io.StringIO()
        call_command("create_demo_accounts", *args, stdout=out)
        return out.getvalue()

    def test_idempotent_and_reset_only_named_account(self):
        self.run_cmd()
        User = get_user_model()
        self.assertEqual(User.objects.filter(username__in=["90010417", "90020833"]).count(), 2)
        roles = dict(UserProfile.objects.values_list("user__username", "role"))
        self.assertEqual(roles, {"90010417": "PLANT_ENGINEER", "90020833": "AI_ADMIN"})
        self.assertFalse(User.objects.filter(is_superuser=True).exists())
        h1 = dict(User.objects.values_list("username", "password"))
        out = self.run_cmd()  # 다시 실행: 중복·비밀번호 초기화 없음
        self.assertIn("이미 있음", out)
        self.assertEqual(h1, dict(User.objects.values_list("username", "password")))
        self.run_cmd("--reset", "90020833")
        h2 = dict(User.objects.values_list("username", "password"))
        self.assertEqual(h1["90010417"], h2["90010417"])
        self.assertNotEqual(h1["90020833"], h2["90020833"])
        self.assertTrue(h2["90020833"].startswith("pbkdf2_"))  # 해시로만 저장
