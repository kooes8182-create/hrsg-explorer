from django.core.management.base import BaseCommand

from cases.models import EvaluationCase
from cases.services import ensure_case_data

# 모두 가상 케이스입니다. 실제 발전소·고객사 이름을 쓰지 않습니다.
# 실측값(세정 전후)과 체크리스트 수령 상태는 만들지 않습니다 — 가상 값이 실측처럼 보이지 않도록.
DEMO_CASES = [
    {"seed_key": "DEMO-1", "name": "가상 케이스 — DEMO 기본", "scenario": "ALARM",
     "memo": "가상 데이터로 만든 시연용 케이스입니다. 실제 설비 데이터가 아닙니다. (입력값: DEMO '오염 진행(주의)' 시나리오)"},
]


class Command(BaseCommand):
    help = "가상 DEMO 케이스를 만듭니다. 여러 번 실행해도 중복되지 않고, 사용자가 바꾼 값을 덮어쓰지 않습니다."

    def handle(self, *args, **options):
        for spec in DEMO_CASES:
            case, created = EvaluationCase.objects.get_or_create(
                seed_key=spec["seed_key"], defaults={"name": spec["name"], "memo": spec["memo"]})
            # 입력값이 없을 때만 시나리오 값으로 채움 (이미 있으면 그대로), 새 체크리스트 항목은 추가
            ensure_case_data(case, scenario=spec["scenario"])
            self.stdout.write(f"{'생성' if created else '이미 있음'}: {spec['name']}")
