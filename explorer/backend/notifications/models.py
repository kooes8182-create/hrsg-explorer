from django.db import models
from django.utils import timezone

from cases.models import EvaluationCase


class Notification(models.Model):
    """알림 센터 기록. 상태형(STATE)은 같은 event_key 로 해결 전까지 1건만 두고, 조건이 풀리면 resolved_at 을 채웁니다.
    사건형(EVENT)은 한 번 일어난 일(계산 완료·저장·복구)이라 '해결' 개념이 없습니다. 읽음(read_at)과 해결(resolved_at)은 별개입니다."""

    CATEGORIES = ["OPERATION", "DATA", "CALC", "SYSTEM"]
    SEVERITIES = ["CRITICAL", "WARNING", "INFO", "SUCCESS"]

    case = models.ForeignKey(EvaluationCase, null=True, blank=True, on_delete=models.CASCADE, related_name="notifications")  # null = 시스템 전체
    kind = models.CharField(max_length=10, default="STATE")  # STATE | EVENT
    category = models.CharField(max_length=10)
    severity = models.CharField(max_length=10)
    title = models.JSONField()  # {ko, en}
    message = models.JSONField()  # {ko, en}
    source = models.CharField(max_length=120)
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    target_route = models.CharField(max_length=200, blank=True, default="")
    target_item_id = models.CharField(max_length=40, blank=True, default="")
    event_key = models.CharField(max_length=160, db_index=True)
    # 관련 수치·기준값 [{label:{ko,en}, value}] — 알림을 만들 때의 서버 값 (모바일 상세 화면)
    data = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
