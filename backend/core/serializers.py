from rest_framework import serializers

from calculators.public_refs import cite

from . import checklist_seed as seed
from .models import ChecklistItem, EvaluationCase


class CaseSerializer(serializers.ModelSerializer):
    mode = serializers.SerializerMethodField()

    class Meta:
        model = EvaluationCase
        fields = ["id", "name", "memo", "mode", "is_seed", "created_at", "updated_at"]
        read_only_fields = ["id", "mode", "is_seed", "created_at", "updated_at"]
        # 빈 이름·공백 이름 모두 같은 한국어 안내 (프레임워크 기본 문구 대신)
        extra_kwargs = {"name": {"error_messages": {"blank": "케이스 이름을 입력하세요.",
                                                    "required": "케이스 이름을 입력하세요.",
                                                    "max_length": "케이스 이름은 100자 이하로 입력하세요."}}}

    is_seed = serializers.SerializerMethodField()

    def get_mode(self, obj):
        calc = getattr(obj, "calc_input", None)
        return calc.mode if calc else "REAL"

    def get_is_seed(self, obj):
        return obj.seed_key is not None

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("케이스 이름을 입력하세요.")
        return value


class ChecklistItemSerializer(serializers.ModelSerializer):
    required_for = serializers.SerializerMethodField()
    requirement_provisional = serializers.SerializerMethodField()
    reference = serializers.SerializerMethodField()

    class Meta:
        model = ChecklistItem
        fields = [
            "key", "category", "order", "name_ko", "name_en", "value", "unit", "condition",
            "measured_at", "memo", "status", "source", "required_for", "requirement_provisional",
            "reference", "updated_at",
        ]

    def get_required_for(self, obj):
        return seed.required_for(obj.key)

    def get_requirement_provisional(self, obj):
        return seed.REQUIREMENT_IS_PROVISIONAL

    def get_reference(self, obj):
        """공개 자료 참고 항목이면 근거 자료 (제목·쪽·확인일)."""
        ref = seed.CATALOG_BY_KEY.get(obj.key, {}).get("ref")
        return cite(ref) if ref else None


class ChecklistItemUpdateSerializer(serializers.ModelSerializer):
    """한 항목 수정. 상태는 값 입력과 무관하게 사용자가 직접 바꿉니다."""

    value = serializers.CharField(allow_null=True, allow_blank=True, required=False, trim_whitespace=True)

    class Meta:
        model = ChecklistItem
        fields = ["value", "unit", "condition", "measured_at", "memo", "status"]
        extra_kwargs = {f: {"required": False} for f in fields}

    def validate_value(self, value):
        return value if value not in (None, "") else None  # 빈 칸은 null (0 아님)

    def validate(self, attrs):
        status = attrs.get("status", self.instance.status)
        value = attrs["value"] if "value" in attrs else self.instance.value
        if status == ChecklistItem.Status.VERIFIED and value in (None, ""):
            raise serializers.ValidationError({"status": ["값이 비어 있는 항목은 '검증 완료'로 바꿀 수 없습니다."]})
        return attrs
