from rest_framework import serializers

from .models import EvaluationCase


class CaseSerializer(serializers.ModelSerializer):
    is_demo = serializers.SerializerMethodField()

    class Meta:
        model = EvaluationCase
        fields = ["id", "name", "memo", "is_demo", "cloned_from", "created_at", "updated_at"]
        read_only_fields = ["id", "is_demo", "cloned_from", "created_at", "updated_at"]

    def get_is_demo(self, obj):
        return obj.seed_key is not None

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("케이스 이름을 입력하세요.")
        return value
