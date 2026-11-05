"""가상 평가 케이스 초기 데이터 명령.

    python manage.py seed_demo_cases

- 가상 케이스 3개(A 일부 수신, B 신규, C 문헌 사례 수준 예시)를 만듭니다. 이미 있으면(seed_key 기준) 새로 만들지 않고 값도 바꾸지 않습니다.
- 모든 케이스에 체크리스트 목록의 빠진 항목만 '미수신'으로 추가합니다(기존 값 유지).
- 값은 화면 확인용 가상 값이며 실제 설비·운전 한계와 무관합니다. 가스터빈 모델명은 DEMO-GT(가상)입니다.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from calculators import demo_scenarios as demo
from calculators.economics import clean_assumptions
from calculators.pinch_approach import clean_pinch
from calculators.public_refs import SMP_ANNUAL
from core import evaluation
from core.models import ChecklistItem, EvaluationCase
from core.services import create_case, ensure_case_setup
from qa import service as qa_service

S = ChecklistItem.Status
VIRTUAL = "가상 값 (실제 설비 아님)"
VIRTUAL_REF = "가상 값 — 공개 사례 수준 참고 (POWER 2015 등), 실제 설비 아님"
ALARM = demo.SCENARIOS["DEMO-ALARM"]
EXAMPLE_QUESTIONS = [  # 케이스 C 의 AI 질문하기 예시 (서버 데모 답변으로 생성)
    "문헌 기반 참고 추정으로 출력 손실은 어느 정도인가요?",
    "최근 SMP 실적은 어떻게 되나요?",
    "이 경제성 결과는 어떤 입력값으로 계산됐나요?",
]

SEED_CASES = [
    {
        "seed_key": "demo-case-a",
        "name": "가상 케이스 A — 데이터 일부 수신",
        "memo": "가상 데이터로 만든 예시 케이스입니다. 실제 발전소·고객사와 무관합니다.",
        "checklist": {
            "gt_model": ("DEMO-GT", S.VERIFIED),
            "gt_load": ("100", S.VERIFIED),
            "ambient_temp": ("15", S.RECEIVED),
            "gt_exhaust_temp": ("600", S.RECEIVED),
            "gt_back_pressure": ("3.0", S.RECEIVED),
            "hrsg_dp": ("2.5", S.RECEIVED),
            "stack_temp": ("95", S.RECEIVED),
            "fuel_type": ("천연가스 (가상)", S.VERIFIED),
        },
        "operating_values": {
            "gt_model": "DEMO-GT", "gt_load": 100, "ambient_temp": 15, "gt_exhaust_temp": 600,
            "gt_exhaust_flow": None, "gt_back_pressure": 3.0, "hrsg_dp": 2.5, "stack_temp": 95,
            "steam_flow": None,
        },
    },
    {
        # 공개 문헌 사례 수준의 가상 값으로 모든 화면을 채운 예시 (Phase 6)
        "seed_key": "demo-case-c",
        "name": "가상 케이스 C — 문헌 사례 수준 예시",
        "memo": "공개 문헌·통계를 참고해 만든 가상 예시입니다. 차압 수준은 공개 세정 사례(POWER 2015), SMP는 KPX 2025년 연평균(공개 통계)입니다. 실제 발전소와 무관합니다.",
        "checklist_note": VIRTUAL_REF,
        "checklist": {
            "gt_model": ("DEMO-GT", S.VERIFIED), "gt_rated_output": ("160", S.VERIFIED), "gt_load": ("100", S.VERIFIED),
            "ambient_temp": ("15", S.VERIFIED), "fuel_type": ("천연가스 (가상)", S.VERIFIED),
            "gt_exhaust_temp": ("601", S.RECEIVED), "gt_exhaust_flow": ("650", S.RECEIVED),
            "gt_back_pressure": ("4.8", S.RECEIVED), "hrsg_dp": ("4.2", S.RECEIVED), "clean_hrsg_dp": ("3.3", S.VERIFIED),
            "stack_temp": ("104", S.RECEIVED), "steam_flow": ("292", S.RECEIVED),
            "drum_pressure": ("10.0 (게이지)", S.RECEIVED), "eco_outlet_water_temp": ("297", S.RECEIVED),
            "evap_outlet_gas_temp": ("320", S.RECEIVED), "last_cleaning": ("가상 — 기록 없음", S.RECEIVED),
        },
        "mode": "DEMO", "scenario_id": "DEMO-ALARM",
        "operating_values": ALARM["operating_values"],
        "reference_inputs": ALARM["reference_inputs"],
        "economics": {
            **demo.ECONOMICS_EXAMPLE, "smp": SMP_ANNUAL["2025"],
            "sources": {"smp": "PUBLIC", **{f"{k}.{f}": "DEMO" for k in ("A", "B")
                                            for f in ("recovered_mw", "operating_hours", "cleaning_cost", "extra_cost")}},
        },
        "pinch": {"drum_pressure": 10.0, "drum_pressure_basis": "gauge", "eco_outlet_water_temp": 297, "evap_outlet_gas_temp": 320},
        "questions": EXAMPLE_QUESTIONS,
    },
    {
        "seed_key": "demo-case-b",
        "name": "가상 케이스 B — 신규",
        "memo": "아직 받은 데이터가 없는 가상 케이스입니다.",
        "checklist": {},
        "operating_values": None,
    },
]


class Command(BaseCommand):
    help = "가상 평가 케이스를 만듭니다. 반복 실행해도 중복 생성·덮어쓰기를 하지 않습니다."

    @transaction.atomic
    def handle(self, *args, **options):
        for spec in SEED_CASES:
            case = EvaluationCase.objects.filter(seed_key=spec["seed_key"]).first()
            if case:
                self.stdout.write(f"이미 있음 (변경하지 않음): {case.name} [id={case.id}]")
                continue
            case = create_case(spec["name"], spec["memo"], seed_key=spec["seed_key"])
            for key, (value, status) in spec["checklist"].items():
                case.checklist_items.filter(key=key).update(value=value, status=status,
                                                            condition=spec.get("checklist_note", VIRTUAL))
            calc = case.calc_input
            if spec.get("operating_values"):
                calc.operating_values = spec["operating_values"]
            if spec.get("mode"):
                calc.mode, calc.scenario_id = spec["mode"], spec["scenario_id"]
            if spec.get("reference_inputs"):
                calc.reference_inputs = spec["reference_inputs"]
            if spec.get("economics"):
                calc.economics_assumptions, errors = clean_assumptions(spec["economics"])
                assert not errors, errors
            if spec.get("pinch"):
                calc.pinch_inputs, errors = clean_pinch(spec["pinch"])
                assert not errors, errors
            calc.save()
            if spec.get("mode"):  # 예시 결과까지 계산해 둠 (서버 계산 모듈 그대로 사용)
                case.refresh_from_db()
                for kind in ("PERFORMANCE", "REFERENCE", "ECONOMICS", "PINCH_APPROACH"):
                    evaluation.run(case, kind)
            for q in spec.get("questions", []):
                qa_service.ask(case, q)
            self.stdout.write(self.style.SUCCESS(f"생성: {case.name} [id={case.id}]"))

        added = sum(ensure_case_setup(c) for c in EvaluationCase.objects.all())
        self.stdout.write(f"체크리스트 동기화: 빠진 항목 {added}개 추가 (기존 값은 그대로)")
