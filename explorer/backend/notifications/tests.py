"""알림 센터: 실제 저장값·API 사건에서만 만들고, 같은 상태는 중복 생성하지 않으며, 읽음과 해결을 구분합니다."""

from datetime import timedelta

import threading

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from cases import checklist_registry as reg

from accounts.testing import client_for, make_user, plant_client
from .models import Notification


class NotificationTests(TestCase):
    def setUp(self):
        self.api = plant_client()
        self.cid = self.api.post("/api/cases/", {"name": "N1"}, format="json").json()["id"]

    def items(self, cid=None):
        return self.api.get(f"/api/notifications/?case={cid or self.cid}").json()

    def keys(self, open_only=True, cid=None):
        return [n["eventKey"] for n in self.items(cid)["items"] if not open_only or (n["kind"] == "STATE" and not n["resolvedAt"])]

    def put_values(self, **over):
        values = {**self.api.get(f"/api/cases/{self.cid}/inputs/").json()["values"], **over}
        return self.api.put(f"/api/cases/{self.cid}/inputs/", {"mode": "DEMO", "scenario": "CUSTOM", "values": values}, format="json")

    def test_input_change_raises_reevaluation_once_and_evaluate_resolves(self):
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        self.assertNotIn("calc.stale", self.keys())
        self.put_values(currentBP=380)
        self.put_values(currentBP=390)  # 같은 상태(재평가 필요)가 이어지면 새 알림 없음
        self.items()
        self.assertEqual(Notification.objects.filter(case_id=self.cid, event_key="calc.stale").count(), 1)
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        self.assertNotIn("calc.stale", self.keys())
        done = [n for n in self.items()["items"] if n["eventKey"].startswith("calc.done")]
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")  # 같은 입력으로 다시 계산 → 완료 알림 중복 없음
        self.assertEqual(len([n for n in self.items()["items"] if n["eventKey"].startswith("calc.done")]), len(done))

    def test_missing_required_and_recovery(self):
        n = next(n for n in self.items()["items"] if n["eventKey"] == "data.missing_required")
        self.assertEqual(n["severity"], "WARNING")
        self.assertTrue(n["targetRoute"].startswith("/checklist?item="))
        req = [i["id"] for i in reg.ITEMS if i["required"]]
        self.api.patch(f"/api/cases/{self.cid}/checklist/", {"updates": [{"id": i, "supply_status": "RECEIVED"} for i in req]}, format="json")
        items = self.items()["items"]
        self.assertNotIn("data.missing_required", self.keys())
        self.assertTrue(any(x["severity"] == "SUCCESS" and x["title"]["ko"] == "필수 데이터 충족" for x in items))
        self.assertTrue(any(x["eventKey"].startswith("data.supply_change") for x in items))  # 수급 상태 변경 사건

    def test_calc_failure_is_not_duplicated_and_clears_on_success(self):
        for _ in range(3):
            self.assertEqual(self.put_values(loadFactor=130).status_code, 400)
        self.api.post("/api/notifications/client-event/", {"kind": "calc_failed", "case": self.cid, "fields": ["loadFactor", "nope"]}, format="json")
        self.assertEqual(Notification.objects.filter(case_id=self.cid, event_key="calc.failed").count(), 1)
        self.assertIn("loadFactor", Notification.objects.get(event_key="calc.failed").message["en"])
        self.assertNotIn("nope", Notification.objects.get(event_key="calc.failed").message["en"])
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        self.assertNotIn("calc.failed", self.keys())

    def test_outage_recorded_after_recovery_once(self):
        since = timezone.now() - timedelta(minutes=3)
        body = {"kind": "server_down", "since": since.isoformat(), "until": timezone.now().isoformat()}
        self.assertEqual(self.api.post("/api/notifications/client-event/", body, format="json").status_code, 201)
        self.api.post("/api/notifications/client-event/", body, format="json")
        sys_ = [n for n in self.items()["items"] if n["caseId"] is None and n["eventKey"].startswith("sys.server_down")]
        self.assertEqual(sorted(n["severity"] for n in sys_), ["CRITICAL", "SUCCESS"])
        self.assertTrue(all(n["resolvedAt"] for n in sys_ if n["kind"] == "STATE"))
        bad = {"kind": "server_down", "since": timezone.now().isoformat(), "until": since.isoformat()}
        self.assertEqual(self.api.post("/api/notifications/client-event/", bad, format="json").status_code, 400)

    def test_cases_are_separated_and_system_is_shared(self):
        other = self.api.post("/api/cases/", {"name": "N2"}, format="json").json()["id"]
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        self.put_values(currentBP=400)
        self.assertIn("calc.stale", self.keys())
        self.assertNotIn("calc.stale", self.keys(cid=other))
        Notification.objects.create(case=None, category="SYSTEM", severity="WARNING", title={"ko": "s", "en": "s"}, message={"ko": "", "en": ""},
                                    source="t", event_key="sys.test")
        self.assertIn("sys.test", self.keys(cid=other))
        self.assertIn("sys.test", self.keys())

    def test_read_is_not_resolved(self):
        n = next(n for n in self.items()["items"] if n["eventKey"] == "data.missing_required")
        r = self.api.post(f"/api/notifications/{n['id']}/read/", {"read": True}, format="json").json()
        self.assertIsNotNone(r["readAt"])
        self.assertIsNone(r["resolvedAt"])
        self.api.post("/api/notifications/read-all/", {"case": self.cid}, format="json")
        body = self.items()
        self.assertEqual(body["unread"], 0)
        self.assertGreater(body["unresolved"], 0)
        self.assertFalse(body["live_plant_data"])

    def test_demo_trip_is_marked_demo_and_normal_records_change(self):
        self.api.post(f"/api/cases/{self.cid}/inputs/reset/", {"scenario": "TRIP"}, format="json")
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        n = next(n for n in self.items()["items"] if n["eventKey"] == "op.status.TRIP")
        self.assertEqual(n["severity"], "CRITICAL")
        self.assertTrue(n["isDemo"])
        self.assertIn("가상", n["title"]["ko"])
        self.api.post(f"/api/cases/{self.cid}/inputs/reset/", {"scenario": "ALARM"}, format="json")
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        keys = self.keys()
        self.assertIn("op.status.ALARM", keys)
        self.assertNotIn("op.status.TRIP", keys)
        self.api.post(f"/api/cases/{self.cid}/inputs/reset/", {"scenario": "NORMAL"}, format="json")
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        self.assertFalse(any(k.startswith("op.status.") for k in self.keys()))
        self.assertTrue(any(x["title"]["ko"].endswith("정상") for x in self.items()["items"]))

    def test_ai_context_only_accepts_own_notifications(self):
        n = next(n for n in self.items()["items"] if n["eventKey"] == "data.missing_required")
        c = self.api.get(f"/api/cases/{self.cid}/ai-context/?page=checklist&notification={n['id']}").json()
        self.assertTrue(c["lines"][0].startswith("notification [WARNING, DATA, open]"))
        other = self.api.post("/api/cases/", {"name": "N3"}, format="json").json()["id"]
        self.assertEqual(self.api.get(f"/api/cases/{other}/ai-context/?page=checklist&notification={n['id']}").status_code, 400)


class ConcurrencyTests(TransactionTestCase):
    """화면이 처음 열릴 때 여러 조회가 동시에 와도 같은 상태 알림은 1건만 (실제 발생했던 중복 회귀 방지)."""

    def test_parallel_syncs_do_not_duplicate(self):
        user = make_user("PLANT_ENGINEER")
        cid = client_for(user=user).post("/api/cases/", {"name": "C"}, format="json").json()["id"]

        def hit():
            client_for(user=user).get(f"/api/notifications/?case={cid}")
            connection.close()

        ts = [threading.Thread(target=hit) for _ in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(Notification.objects.filter(case_id=cid, event_key="data.missing_required").count(), 1)
