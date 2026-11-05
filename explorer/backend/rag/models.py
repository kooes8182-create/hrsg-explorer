from django.db import models

from cases.models import EvaluationCase


class Conversation(models.Model):
    """AI 도우미 대화. 케이스별로 나뉩니다."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="conversations")
    title = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class ConversationMessage(models.Model):
    """질문(user)·답변(assistant). 질문은 민감정보를 가린 뒤의 문장만 저장합니다 (원문 미보관)."""

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10)  # user | assistant
    text = models.TextField(blank=True, default="")
    payload = models.JSONField(default=dict)  # 근거 문단·검색 방식·검증 결과·스냅샷·마스킹 정보
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class AnswerFeedback(models.Model):
    """사람 검토 피드백 (평가셋 v2 후보로 내보낼 수 있음)."""

    message = models.ForeignKey(ConversationMessage, on_delete=models.CASCADE, related_name="feedback")
    rating = models.CharField(max_length=10)  # up | down
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)


class EvidenceLabel(models.Model):
    """정답 라벨 (평가셋 v2 준비용). 공식 평가셋 파일은 수정하지 않고 여기에만 기록합니다."""

    question = models.TextField()
    lang = models.CharField(max_length=2, default="ko")
    expected_refs = models.JSONField(default=list)  # 정답 문헌 ref 목록
    evidence = models.JSONField(default=list)  # [{ref, page, passage_i}]
    reviewer = models.CharField(max_length=60, blank=True, default="")
    status = models.CharField(max_length=12, default="DRAFT")  # DRAFT | REVIEWED | APPROVED
    memo = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-id"]


class SystemConfiguration(models.Model):
    """앱 설정 (키-값). 예: 외부 AI 전송 허용, 민감 식별정보 목록."""

    key = models.CharField(max_length=60, unique=True)
    value = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    DEFAULTS = {"ai_external_enabled": False, "sensitive_terms": []}

    @classmethod
    def read(cls, key):
        row = cls.objects.filter(key=key).first()
        return row.value if row else cls.DEFAULTS.get(key)

    @classmethod
    def write(cls, key, value):
        cls.objects.update_or_create(key=key, defaults={"value": value})
