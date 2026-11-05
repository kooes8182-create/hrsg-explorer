from django.db import models

from .checklist_seed import CATEGORIES, SOURCE_PLAN_DRAFT


class EvaluationCase(models.Model):
    """평가 케이스: 체크리스트, 운전 입력값, (이후) 결과·질문 이력이 묶이는 단위."""

    name = models.CharField(max_length=100)
    memo = models.TextField(blank=True, default="")
    # 가상 초기 데이터 명령이 만든 케이스 표시 (반복 실행 시 중복 생성 방지용)
    seed_key = models.CharField(max_length=50, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return self.name


class ChecklistItem(models.Model):
    class Status(models.TextChoices):
        MISSING = "MISSING", "미수신"
        RECEIVED = "RECEIVED", "수신"
        VERIFIED = "VERIFIED", "검증 완료"

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="checklist_items")
    key = models.CharField(max_length=50)
    category = models.CharField(max_length=30, choices=[(c["code"], c["ko"]) for c in CATEGORIES])
    order = models.PositiveSmallIntegerField(default=0)
    name_ko = models.CharField(max_length=200)
    name_en = models.CharField(max_length=200)
    value = models.TextField(null=True, blank=True)  # 비어 있으면 null (0으로 바꾸지 않음)
    unit = models.CharField(max_length=30, blank=True, default="")
    condition = models.CharField(max_length=200, blank=True, default="")  # 측정 위치 또는 조건
    measured_at = models.DateTimeField(null=True, blank=True)
    memo = models.TextField(blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.MISSING)
    source = models.CharField(max_length=30, default=SOURCE_PLAN_DRAFT)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]
        constraints = [models.UniqueConstraint(fields=["case", "key"], name="uniq_checklist_case_key")]

    def __str__(self):
        return f"{self.case_id}:{self.key}"


class CalculationInput(models.Model):
    """케이스별 계산 입력 (케이스당 1개). 모드·시나리오 선택과 계산은 Phase 3에서 연결합니다."""

    class Mode(models.TextChoices):
        DEMO = "DEMO", "DEMO"
        REAL = "REAL", "실제 평가"

    case = models.OneToOneField(EvaluationCase, on_delete=models.CASCADE, related_name="calc_input")
    # DEMO 는 사용자가 시나리오를 명시적으로 고를 때만 사용 → 기본은 REAL(모델 미연동)
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.REAL)
    scenario_id = models.CharField(max_length=30, null=True, blank=True)
    operating_values = models.JSONField(default=dict)
    economics_assumptions = models.JSONField(default=dict)
    pinch_inputs = models.JSONField(default=dict)
    reference_inputs = models.JSONField(default=dict)  # 공개 문헌 기반 참고 추정 입력
    updated_at = models.DateTimeField(auto_now=True)

    def snapshot(self, kind):
        """결과가 오래됐는지 판단할 때 비교하는 입력 범위 (specs/03 CalculationResult)."""
        if kind == CalculationResult.Kind.PERFORMANCE:
            return {"mode": self.mode, "scenario_id": self.scenario_id, "operating_values": self.operating_values}
        if kind == CalculationResult.Kind.ECONOMICS:
            return {"economics_assumptions": self.economics_assumptions}
        if kind == CalculationResult.Kind.REFERENCE:
            return {"reference_inputs": self.reference_inputs}
        return {"pinch_inputs": self.pinch_inputs}


class CalculationResult(models.Model):
    """계산 결과 (케이스·종류별 최신 1건). 입력 스냅샷·계산 시점·모델/데모 버전을 함께 저장합니다."""

    class Kind(models.TextChoices):
        PERFORMANCE = "PERFORMANCE", "성능"
        ECONOMICS = "ECONOMICS", "경제성"
        PINCH_APPROACH = "PINCH_APPROACH", "핀치·어프로치"
        REFERENCE = "REFERENCE", "문헌 기반 참고 추정"

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="results")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    basis = models.CharField(max_length=30)  # DEMO_FIXED / USER_ASSUMPTION / UNAVAILABLE / REEVALUATION_REQUIRED / REFERENCE_ESTIMATE
    payload = models.JSONField()  # API 응답의 result
    inputs_snapshot = models.JSONField()
    model_version = models.CharField(max_length=50)
    data_source = models.JSONField()  # {"ko": ..., "en": ...}
    computed_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["case", "kind"], name="uniq_result_case_kind")]


class QuestionLog(models.Model):
    """AI 질문하기 이력 (케이스별). 현재 답변은 모두 템플릿 기반 데모 답변입니다."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="questions")
    lang = models.CharField(max_length=2)  # 질문 언어 'ko' | 'en'
    question = models.TextField()
    answer = models.TextField()
    answer_type = models.CharField(max_length=20, default="DEMO_TEMPLATE")  # 향후 'LLM'
    intent = models.CharField(max_length=30)
    referenced = models.JSONField(default=dict)  # {"citations": [...], "cards": [...]} (결과는 id 대신 kind·계산 시점)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
