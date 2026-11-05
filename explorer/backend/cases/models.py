from django.db import models


class EvaluationCase(models.Model):
    """평가 케이스. 체크리스트·입력값·결과·스냅샷·실측값은 모두 이 케이스에 연결됩니다."""

    name = models.CharField(max_length=100)
    memo = models.TextField(blank=True, default="")
    # 시드 명령으로 만든 가상 케이스 표시 (다시 실행해도 중복 생성하지 않기 위함)
    seed_key = models.CharField(max_length=50, null=True, blank=True, unique=True)
    cloned_from = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="clones")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.name


class ChecklistItem(models.Model):
    """케이스별 체크리스트 상태. 항목 정의(이름·단위·필요 이유)는 checklist_registry 에 있고 여기에는 상태만 저장합니다."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="checklist")
    item_id = models.CharField(max_length=10)
    reviewed = models.BooleanField(default=False)
    value = models.TextField(null=True, blank=True)  # 비어 있으면 null (0으로 바꾸지 않음)
    unit = models.CharField(max_length=20, blank=True, default="")
    location = models.CharField(max_length=200, blank=True, default="")
    condition = models.CharField(max_length=200, blank=True, default="")
    measured_at = models.DateTimeField(null=True, blank=True)
    data_source = models.CharField(max_length=200, blank=True, default="")
    supply_status = models.CharField(max_length=20, default="NOT_ENTERED")
    verify_status = models.CharField(max_length=20, default="UNVERIFIED")
    document_confirmed = models.BooleanField(default=False)  # 문서형 항목: 첨부·확인 여부
    memo = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("case", "item_id")]
        ordering = ["id"]


class CalculationInput(models.Model):
    """시뮬레이션·계산기·세정 전후가 공유하는 입력값 (케이스당 1개)."""

    case = models.OneToOneField(EvaluationCase, on_delete=models.CASCADE, related_name="calc_input")
    mode = models.CharField(max_length=10, default="DEMO")  # DEMO | USER
    scenario = models.CharField(max_length=10, default="CUSTOM")  # NORMAL | ALARM | TRIP | CUSTOM
    values = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


class CalculationResult(models.Model):
    """종류별 최신 계산 결과. inputs_hash 가 현재 입력과 다르면 '재평가 필요'."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="results")
    kind = models.CharField(max_length=20)  # performance | economics | pinch | reference | comparison
    inputs_hash = models.CharField(max_length=32)
    payload = models.JSONField()
    engine_version = models.CharField(max_length=40)
    computed_at = models.DateTimeField()

    class Meta:
        unique_together = [("case", "kind")]


class CalculationSnapshot(models.Model):
    """사용자가 저장한 계산 스냅샷 (입력 + 결과). 삭제 기능은 두지 않습니다."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="snapshots")
    label = models.CharField(max_length=100, blank=True, default="")
    mode = models.CharField(max_length=10)
    scenario = models.CharField(max_length=10)
    values = models.JSONField()
    results = models.JSONField()
    inputs_hash = models.CharField(max_length=32)
    engine_version = models.CharField(max_length=40)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class OperationalMeasurement(models.Model):
    """세정 전후 실측값. day_offset 은 세정일(D0) 기준 경과일 (세정 전은 음수)."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="measurements")
    day_offset = models.IntegerField()
    back_pressure = models.FloatField()
    stack_temp_c = models.FloatField(null=True, blank=True)
    load_factor = models.FloatField(null=True, blank=True)
    ambient_temp_c = models.FloatField(null=True, blank=True)
    measured_on = models.DateField(null=True, blank=True)
    memo = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["day_offset", "id"]


class ChecklistAttachment(models.Model):
    """체크리스트 항목의 현장 사진 (모바일 카메라·사진 업로드). 파일은 서버 폴더(data/checklist_photos, Git 제외)에만 두고,
    AI·외부 API 로 보내지 않습니다. 파일 이름은 임의 값(uuid)으로 저장해 원래 이름이 경로에 쓰이지 않게 합니다."""

    case = models.ForeignKey(EvaluationCase, on_delete=models.CASCADE, related_name="attachments")
    item_id = models.CharField(max_length=10)
    stored_name = models.CharField(max_length=64, unique=True)
    original_name = models.CharField(max_length=200)
    content_type = models.CharField(max_length=40)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
