from unittest import mock

from django.db.utils import OperationalError
from django.test import TestCase
from rest_framework.test import APIClient


class HealthTests(TestCase):
    def test_health_ok(self):
        r = APIClient().get("/api/health/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["database"], "ok")
        self.assertEqual(body["search"]["status"], "ready")  # 공식 corpus·BM25
        # 외부 AI 전송은 설정에서 켜기 전까지 꺼져 있음 (명시적 활성화)
        self.assertEqual(body["ai"]["status"], "not_connected")
        self.assertFalse(body["ai"]["external_enabled"])

    def test_t03_health_reports_database_failure(self):
        with mock.patch("system.views.connection.cursor", side_effect=OperationalError("down")):
            r = APIClient().get("/api/health/")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["database"], "error")

    def test_unknown_url_returns_json(self):
        r = APIClient().get("/api/no-such-url/")
        self.assertEqual(r.status_code, 404)
