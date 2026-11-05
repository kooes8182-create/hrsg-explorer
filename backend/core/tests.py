from unittest import mock

from django.db.utils import OperationalError
from django.test import TestCase


class HealthApiTests(TestCase):
    def test_health_ok(self):
        res = self.client.get("/api/health/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "ok", "database": "ok"})

    def test_health_db_error_returns_503_without_details(self):
        with mock.patch("core.views.connection.cursor", side_effect=OperationalError("secret detail")):
            res = self.client.get("/api/health/")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json(), {"status": "error", "database": "error"})
        self.assertNotIn("secret", res.content.decode())

    def test_admin_and_static_reference_not_served(self):
        # 관리자 화면·원문 PDF 경로는 제공하지 않습니다.
        self.assertEqual(self.client.get("/admin/").status_code, 404)
        self.assertEqual(self.client.get("/reference/HRSG.pdf").status_code, 404)
        self.assertEqual(self.client.get("/static/reference/HRSG.pdf").status_code, 404)
