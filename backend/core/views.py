from django.db import connection, transaction
from django.db.utils import OperationalError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from calculators.demo_scenarios import SCENARIOS
from calculators.economics import clean_assumptions
from calculators import public_refs
from calculators.pinch_approach import FIELDS as PINCH_FIELDS, clean_pinch
from calculators.reference_estimate import FIELDS as REF_FIELDS, clean_reference
from qa import service as qa_service

from . import checklist_seed as seed
from . import evaluation, services
from .models import CalculationInput, ChecklistItem, EvaluationCase
from .operating_fields import OPERATING_FIELDS, clean_operating_values
from .serializers import CaseSerializer, ChecklistItemSerializer, ChecklistItemUpdateSerializer

INPUT_ERROR = "입력값을 확인하세요."


@api_view(["GET"])
def health(request):
    """서버와 데이터베이스 연결 상태를 확인합니다."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return Response({"status": "ok", "database": "ok"})
    except OperationalError:
        # 내부 오류 상세는 응답에 넣지 않습니다.
        return Response({"status": "error", "database": "error"}, status=503)


def not_found(request, exception=None):
    """없는 주소: Django 기본 오류 화면 대신 짧은 JSON (내부 URL 목록 노출 방지)."""
    return JsonResponse({"error": "요청한 주소를 찾을 수 없습니다."}, status=404, json_dumps_params={"ensure_ascii": False})


def server_error(request):
    """처리하지 못한 서버 오류: 내부 상세(코드·변수·설정) 없이 안내만."""
    return JsonResponse({"error": "서버 오류가 발생했습니다."}, status=500, json_dumps_params={"ensure_ascii": False})


def get_case(case_id):
    try:
        return EvaluationCase.objects.select_related("calc_input").get(pk=case_id)
    except EvaluationCase.DoesNotExist:
        raise NotFound("평가 케이스를 찾을 수 없습니다.")


def touch(case):
    case.save(update_fields=["updated_at"])


# ---------------------------------------------------------------- 케이스

@api_view(["GET", "POST"])
def case_list(request):
    if request.method == "GET":
        cases = EvaluationCase.objects.select_related("calc_input").all()
        return Response(CaseSerializer(cases, many=True).data)

    ser = CaseSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": INPUT_ERROR, "fields": ser.errors}, status=400)
    case = services.create_case(ser.validated_data["name"], ser.validated_data.get("memo", ""))
    return Response(CaseSerializer(get_case(case.id)).data, status=201)


@api_view(["GET", "PATCH", "DELETE"])
def case_detail(request, case_id):
    case = get_case(case_id)
    if request.method == "GET":
        return Response(CaseSerializer(case).data)

    if request.method == "DELETE":
        # 실수 방지: 케이스 이름을 그대로 다시 보내야 삭제 (체크리스트·입력·결과·질문 이력도 함께 삭제)
        confirm = request.data.get("confirm_name") if isinstance(request.data, dict) else None
        if not isinstance(confirm, str) or confirm.strip() != case.name:
            return Response({"error": INPUT_ERROR,
                             "fields": {"confirm_name": ["케이스 이름이 일치하지 않습니다. 삭제하려면 이름을 그대로 입력하세요."]}},
                            status=400)
        case.delete()
        return Response(status=204)

    ser = CaseSerializer(case, data=request.data, partial=True)
    if not ser.is_valid():
        return Response({"error": INPUT_ERROR, "fields": ser.errors}, status=400)
    ser.save()
    return Response(CaseSerializer(case).data)


@api_view(["GET"])
def case_overview(request, case_id):
    case = get_case(case_id)
    services.ensure_case_setup(case)
    return Response(services.overview(case, services.lang_of(request)))


# ---------------------------------------------------------------- 체크리스트

def checklist_payload(case, request):
    items = case.checklist_items.all()
    status = request.query_params.get("status")
    category = request.query_params.get("category")
    shown = items
    if status in ChecklistItem.Status.values:
        shown = shown.filter(status=status)
    if category in seed.CATEGORY_CODES:
        shown = shown.filter(category=category)
    sources = set(items.values_list("source", flat=True))
    return {
        "source_label": seed.SOURCE_LABELS[seed.SOURCE_PLAN_DRAFT] if seed.SOURCE_PLAN_DRAFT in sources else None,
        "requirement_provisional": seed.REQUIREMENT_IS_PROVISIONAL,
        "categories": seed.CATEGORIES,
        "progress": services.progress(items),  # 진행률은 필터와 무관하게 전체 기준
        "items": ChecklistItemSerializer(shown, many=True).data,
    }


@api_view(["GET", "PATCH"])
def checklist(request, case_id):
    case = get_case(case_id)
    services.ensure_case_setup(case)
    if request.method == "GET":
        return Response(checklist_payload(case, request))

    rows = request.data.get("items") if isinstance(request.data, dict) else None
    if not isinstance(rows, list) or not rows:
        return Response({"error": INPUT_ERROR, "fields": {"items": ["수정할 항목 목록이 필요합니다."]}}, status=400)

    by_key = {i.key: i for i in case.checklist_items.all()}
    errors, valid = {}, []
    for row in rows:
        key = row.get("key") if isinstance(row, dict) else None
        if key not in by_key:
            errors[str(key)] = {"key": ["알 수 없는 항목입니다."]}
            continue
        data = {k: v for k, v in row.items() if k != "key"}
        ser = ChecklistItemUpdateSerializer(by_key[key], data=data, partial=True)
        if ser.is_valid():
            valid.append(ser)
        else:
            errors[key] = ser.errors
    if errors:
        # 하나라도 오류가 있으면 아무것도 저장하지 않습니다.
        return Response({"error": INPUT_ERROR, "items": errors}, status=400)

    with transaction.atomic():
        for ser in valid:
            ser.save()
        touch(case)
    return Response(checklist_payload(case, request))


@api_view(["GET"])
def checklist_request_text(request, case_id):
    case = get_case(case_id)
    services.ensure_case_setup(case)
    return Response(services.request_text(case, services.lang_of(request)))


# ---------------------------------------------------------------- 계산 입력 (모드·시나리오·운전값·경제성·핀치)

INPUT_SECTIONS = ["mode", "scenario_id", "operating_values", "economics_assumptions", "pinch_inputs", "reference_inputs"]


def inputs_payload(calc):
    return {
        "mode": calc.mode,
        "scenario_id": calc.scenario_id,
        "operating_values": {**{f["key"]: None for f in OPERATING_FIELDS}, **(calc.operating_values or {})},
        "economics_assumptions": evaluation.economics_values(calc),
        "pinch_inputs": {**{f["key"]: None for f in PINCH_FIELDS}, "drum_pressure_basis": None, **(calc.pinch_inputs or {})},
        "reference_inputs": {**{f["key"]: None for f in REF_FIELDS}, **(calc.reference_inputs or {})},
        "fields": OPERATING_FIELDS,
        "pinch_fields": PINCH_FIELDS,
        "reference_fields": REF_FIELDS,
        "updated_at": calc.updated_at,
    }


@api_view(["GET", "PUT"])
def case_inputs(request, case_id):
    """계산 입력 저장·조회. PUT 은 보낸 부분만 바꿉니다 (예: {"economics_assumptions": {...}})."""
    case = get_case(case_id)
    services.ensure_case_setup(case)
    calc = get_object_or_404(CalculationInput, case=case)
    if request.method == "GET":
        return Response(inputs_payload(calc))

    data = request.data if isinstance(request.data, dict) else {}
    given = [s for s in INPUT_SECTIONS if s in data]
    if not given:
        return Response({"error": INPUT_ERROR, "fields": {"operating_values": ["저장할 입력이 없습니다."]}}, status=400)

    errors, changes = {}, {}
    if "operating_values" in data:
        changes["operating_values"], e = clean_operating_values(data["operating_values"])
        errors.update(e)
    if "economics_assumptions" in data:
        changes["economics_assumptions"], e = clean_assumptions(data["economics_assumptions"],
                                                                evaluation.reference_mw_values(case))
        errors.update({f"economics.{k}": v for k, v in e.items()})
    if "pinch_inputs" in data:
        changes["pinch_inputs"], e = clean_pinch(data["pinch_inputs"])
        errors.update({f"pinch.{k}": v for k, v in e.items()})
    if "reference_inputs" in data:
        changes["reference_inputs"], e = clean_reference(data["reference_inputs"])
        errors.update({f"reference.{k}": v for k, v in e.items()})

    mode = data.get("mode", calc.mode)
    scenario_id = data.get("scenario_id", calc.scenario_id)
    if mode not in CalculationInput.Mode.values:
        errors["mode"] = ["DEMO 또는 REAL 이어야 합니다."]
    elif mode == "DEMO" and scenario_id not in SCENARIOS:
        errors["scenario_id"] = ["데모 시나리오를 선택하세요."]
    if mode == "REAL":
        scenario_id = None  # 실제 평가에는 데모 시나리오를 연결하지 않습니다.
    changes["mode"], changes["scenario_id"] = mode, scenario_id

    if errors:
        return Response({"error": INPUT_ERROR, "fields": errors}, status=400)
    with transaction.atomic():
        for field, value in changes.items():
            setattr(calc, field, value)
        calc.save()
        touch(case)
    return Response(inputs_payload(calc))


# ---------------------------------------------------------------- 평가 실행·결과

@api_view(["GET"])
def demo_scenarios(request):
    return Response(evaluation.scenarios_payload())


@api_view(["GET"])
def public_smp(request):
    """공개 SMP 실적 (KPX/EPSIS 에서 확인한 값, 기준일 표시). 실시간 조회가 아닙니다."""
    return Response(public_refs.smp_payload())


@api_view(["GET"])
def public_sources(request):
    """앱이 참고한 공개 자료 목록 (제목·쪽·인용·적용 한계·확인일). 원문 파일은 제공하지 않습니다."""
    return Response({"checked_on": public_refs.CHECKED_ON,
                     "sources": [{"key": k, **public_refs.cite(k), "quote": s["quote"]} for k, s in public_refs.SOURCES.items()]})


@api_view(["POST"])
def evaluate(request, case_id, kind):
    case = get_case(case_id)
    services.ensure_case_setup(case)
    kind = {"performance": "PERFORMANCE", "economics": "ECONOMICS", "pinch-approach": "PINCH_APPROACH",
            "reference": "REFERENCE"}.get(kind)
    if not kind:
        raise NotFound("알 수 없는 평가 종류입니다.")
    calc = case.calc_input
    if kind == "PERFORMANCE" and calc.mode == "DEMO" and calc.scenario_id not in SCENARIOS:
        return Response({"error": INPUT_ERROR, "fields": {"scenario_id": ["데모 시나리오를 선택하세요."]}}, status=400)
    return Response(evaluation.run(case, kind))


# ---------------------------------------------------------------- AI 질문하기 (데모 답변)

def question_payload(log):
    return {
        "id": log.id, "question": log.question, "answer": log.answer, "lang": log.lang,
        "intent": log.intent, "answer_type": log.answer_type,
        "citations": log.referenced.get("citations", []), "cards": log.referenced.get("cards", []),
        "created_at": log.created_at,
    }


@api_view(["GET"])
def qa_info(request):
    """추천 질문과 답변 방식 (llm_connected 는 현재 항상 false)."""
    return Response({**qa_service.provider_status(), "suggestions": qa_service.SUGGESTIONS,
                     "about_result": qa_service.ABOUT_RESULT})


@api_view(["GET", "POST"])
def case_questions(request, case_id):
    case = get_case(case_id)
    services.ensure_case_setup(case)
    if request.method == "GET":
        return Response([question_payload(q) for q in case.questions.all()])

    question = request.data.get("question") if isinstance(request.data, dict) else None
    question = question.strip() if isinstance(question, str) else ""
    if not question:
        return Response({"error": INPUT_ERROR, "fields": {"question": ["질문을 입력하세요."]}}, status=400)
    if len(question) > qa_service.MAX_QUESTION:
        return Response({"error": INPUT_ERROR,
                         "fields": {"question": [f"질문은 {qa_service.MAX_QUESTION}자 이하로 입력하세요."]}}, status=400)
    log = qa_service.ask(case, question)
    return Response(question_payload(log), status=201)


@api_view(["GET"])
def case_results(request, case_id):
    case = get_case(case_id)
    services.ensure_case_setup(case)
    return Response(evaluation.results(case))
