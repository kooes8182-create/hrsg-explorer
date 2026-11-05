"""모바일 현장 점검: 동시 수정 감지, 체크리스트 사진(형식·크기 검사, 삭제 시 파일 삭제), 알림 상세 수치."""

import tempfile
from pathlib import Path
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from accounts.testing import plant_client
from rest_framework.test import APIClient

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class MobileFieldTests(TestCase):
    def setUp(self):
        self.api = plant_client()
        self.cid = self.api.post("/api/cases/", {"name": "M"}, format="json").json()["id"]
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mock.patch("cases.photos.PHOTO_DIR", Path(self.tmp.name))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def item(self, iid="A-02"):
        return next(i for i in self.api.get(f"/api/cases/{self.cid}/checklist/").json()["items"] if i["id"] == iid)

    def test_conflict_detected_with_stale_timestamp(self):
        seen = self.item()["updated_at"]
        r = self.api.patch(f"/api/cases/{self.cid}/checklist/", {"updates": [{"id": "A-02", "value": "350", "expected_updated_at": seen}]}, format="json")
        self.assertEqual(r.status_code, 200)
        # 다른 기기가 먼저 저장한 뒤, 예전 시각으로 저장하면 거부
        r = self.api.patch(f"/api/cases/{self.cid}/checklist/", {"updates": [{"id": "A-02", "value": "360", "expected_updated_at": seen}]}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "CONFLICT")
        self.assertEqual(self.item()["state"]["value"], "350")
        # 시각 없이 보내면(기존 PC 화면) 그대로 저장
        self.assertEqual(self.api.patch(f"/api/cases/{self.cid}/checklist/", {"updates": [{"id": "A-02", "value": "370"}]}, format="json").status_code, 200)

    def upload(self, data, name="p.jpg", iid="A-02"):
        return self.api.post(f"/api/cases/{self.cid}/checklist/{iid}/attachments/", {"file": SimpleUploadedFile(name, data)}, format="multipart")

    def test_photo_upload_validation_and_delete(self):
        r = self.upload(JPEG)
        self.assertEqual(r.status_code, 201)
        att = r.json()
        self.assertEqual(att["content_type"], "image/jpeg")
        self.assertEqual(self.item()["photos"], 1)
        f = self.api.get(att["url"])
        self.assertEqual(f.status_code, 200)
        self.assertEqual(f["Content-Type"], "image/jpeg")
        self.assertEqual(f["X-Content-Type-Options"], "nosniff")
        # 확장자만 사진인 다른 파일, 너무 큰 파일, 없는 항목은 거부
        self.assertEqual(self.upload(b"<script>alert(1)</script>", name="x.jpg").status_code, 400)
        self.assertEqual(self.upload(b"\xff\xd8\xff" + b"0" * (10 * 1024 * 1024)).status_code, 400)
        self.assertEqual(self.upload(PNG, iid="Z-99").status_code, 404)
        stored = list(Path(self.tmp.name).iterdir())
        self.assertEqual(len(stored), 1)
        self.assertEqual(self.api.delete(f"/api/attachments/{att['id']}/").status_code, 204)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])  # 파일도 삭제

    def test_case_delete_removes_photo_files(self):
        self.api.post("/api/cases/", {"name": "keep"}, format="json")  # 마지막 케이스는 지울 수 없으므로
        self.upload(PNG)
        self.assertEqual(len(list(Path(self.tmp.name).iterdir())), 1)
        self.api.delete(f"/api/cases/{self.cid}/")
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_notification_detail_has_values_condition_and_checks(self):
        n = next(x for x in self.api.get(f"/api/notifications/?case={self.cid}").json()["items"] if x["eventKey"] == "data.missing_required")
        self.assertTrue(any(d["label"]["ko"] == "미수신 필수" for d in n["data"]))
        self.assertIn("수령 완료", n["condition"]["ko"])
        self.assertGreater(len(n["checks"]), 0)
