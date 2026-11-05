from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from cases.models import EvaluationCase
from engine import fields as F
from system.errors import api_error

from . import engine as E
from .models import Notification

LIMIT = 200


def _m(ko, en):
    return {"ko": ko, "en": en}


# 알림 종류(eventKey 앞부분)별 발생 조건과 추가로 확인할 사항 — 상세 화면(모바일 Bottom Sheet)에 표시
GUIDE = {
    "op.status": (_m("DEMO 시나리오 상태가 주의·위험으로 평가됨 (시나리오에 지정된 상태, 임계값 판정 아님)", "DEMO scenario evaluated as caution/danger (assigned state, not a threshold)"),
                  [_m("시뮬레이션에서 선택한 시나리오와 입력값", "Scenario and inputs chosen in Simulation"), _m("실제 설비 경보가 아님 — 실측 데이터로 다시 평가", "Not a real alarm — re-evaluate with measured data")]),
    "op.bp_ref": (_m("배압 증가분(현재 − 기준)이 공개 사례의 세정 참고 범위(+3~4 inH₂O)보다 큼", "Excess back pressure above the public cleaning reference (+3–4 inH₂O)"),
                  [_m("기준 배압이 청정 상태 값인지", "Whether the baseline is a clean-condition value"), _m("부하율·외기 온도 등 측정 조건", "Load and ambient conditions"), _m("HRSG 차압(ΔP) 추세", "HRSG ΔP trend")]),
    "op.deviation": (_m("세정 전후 실측의 부하율 차이 > 5%p 또는 외기 온도 차이 > 5 °C (DEMO 가드레일)", "Load difference > 5 pp or ambient > 5 °C between measurements (DEMO guardrail)"),
                     [_m("같은 부하·외기 조건에서 다시 측정", "Re-measure at similar load and ambient")]),
    "data.missing_required": (_m("필수 체크리스트 항목의 수급 상태가 '수령 완료'가 아님", "Required checklist items not 'Received'"),
                              [_m("요청 메일 초안으로 자료 요청", "Request data with the e-mail draft"), _m("받기 전까지는 DEMO 값으로 계산됨", "DEMO values are used until received")]),
    "data.needs_check": (_m("수급 상태가 '검증 필요'이거나 검증 상태가 '실패'인 항목이 있음", "Items marked 'needs check' or verification failed"),
                         [_m("값·단위·측정 위치·측정 시각", "Value, unit, location and time"), _m("측정 조건 메모", "Measurement-condition notes")]),
    "calc.stale": (_m("저장된 계산 결과의 입력 지문(hash)이 현재 입력과 다름", "Saved results were computed from different inputs (hash mismatch)"),
                   [_m("계산기·시뮬레이션에서 다시 계산", "Run the calculation again")]),
    "calc.failed": (_m("입력값 검사 실패 또는 계산 엔진 오류로 계산하지 못함", "Input validation failed or the engine raised an error"),
                    [_m("표시된 입력 항목의 범위·단위", "Range and unit of the listed inputs")]),
    "sys.embedding": (_m("BGE-M3 의미 검색을 불러오지 못함", "BGE-M3 dense search could not be loaded"), [_m("RAG 검색 성능 평가 화면의 모델 상태", "Model status on the RAG evaluation page")]),
    "sys.bm25_fallback": (_m("질문 처리 중 의미 검색을 쓸 수 없어 BM25 로 대체", "Dense search unavailable during a question; BM25 used"), [_m("서버 로그·메모리 사용량", "Server log and memory use")]),
    "sys.llm": (_m("Claude API 호출이 오류로 끝남 (근거 문단은 제공)", "The Claude API call failed (evidence still shown)"), [_m("API 키·사용량 한도·네트워크", "API key, quota and network")]),
    "sys.gemini": (_m("(예전) Gemini API 호출이 오류로 끝남", "(Former) Gemini API call failed"), [_m("현재는 Claude API 를 사용", "Claude API is used now")]),
    "sys.server_down": (_m("30초 간격 연결 점검(/api/health/)이 서버에 닿지 못함", "The 30-second health check could not reach the server"), [_m("백엔드 실행 여부(127.0.0.1:8002)", "Whether the backend is running (127.0.0.1:8002)")]),
    "sys.db_error": (_m("연결 점검에서 데이터베이스 응답 실패", "The health check reported a database failure"), [_m("PostgreSQL 실행 여부", "Whether PostgreSQL is running")]),
    "sys.autosave": (_m("변경 내용을 서버에 저장하는 요청이 실패", "A save request to the server failed"), [_m("입력값 형식과 서버 연결", "Input format and server connection")]),
}


def _guide(key):
    fam = next((f for f in GUIDE if key == f or key.startswith(f + ".") or key.startswith(f + ":")), None)
    return GUIDE.get(fam, (None, []))


def payload(n):
    return {"id": n.id, "caseId": n.case_id, "kind": n.kind, "category": n.category, "severity": n.severity,
            "title": n.title, "message": n.message, "source": n.source, "isDemo": n.is_demo,
            "createdAt": n.created_at, "readAt": n.read_at, "resolvedAt": n.resolved_at,
            "targetRoute": n.target_route, "targetItemId": n.target_item_id, "eventKey": n.event_key,
            "data": n.data, "condition": _guide(n.event_key)[0], "checks": _guide(n.event_key)[1]}


def _case_or_none(cid):
    if cid in (None, ""):
        return None
    try:
        return EvaluationCase.objects.get(pk=int(cid))
    except (EvaluationCase.DoesNotExist, ValueError, TypeError):
        raise NotFound()


def scoped(case):
    """케이스 알림 + 시스템 알림(case 없음). 케이스마다 분리되고, 시스템 알림은 모든 케이스에서 보입니다."""
    qs = Notification.objects.filter(case__isnull=True)
    return (qs | Notification.objects.filter(case=case)) if case else qs


@api_view(["GET"])
def notification_list(request):
    """조회할 때 현재 상태로 맞춘 뒤(sync) 돌려줍니다. 같은 상태가 이어지는 동안 새 알림은 생기지 않습니다."""
    case = _case_or_none(request.query_params.get("case"))
    if case:
        E.sync_case(case)
    E.sync_system()
    qs = scoped(case)
    # 같은 미해결 상태 알림이 (예전 동시 조회 오류로) 여러 건 남아 있으면 가장 먼저 생긴 1건만 보여 줍니다 (DB 는 그대로).
    items, seen, hidden = [], set(), []
    for n in reversed(list(qs[:LIMIT])):
        k = (n.case_id, n.event_key) if n.kind == "STATE" and n.resolved_at is None else None
        if k and k in seen:
            hidden.append(n.id)
            continue
        if k:
            seen.add(k)
        items.append(n)
    items.reverse()
    return Response({
        "items": [payload(n) for n in items],
        "unread": qs.filter(read_at__isnull=True).exclude(id__in=hidden).count(),
        "unresolved": qs.filter(kind="STATE", resolved_at__isnull=True).exclude(id__in=hidden).count(),
        "live_plant_data": False,  # 실시간 설비 데이터 미연동 — 화면에 '실시간 설비 모니터링'으로 표시하지 않음
    })


@api_view(["POST"])
def notification_read(request, nid):
    try:
        n = Notification.objects.get(pk=nid)
    except Notification.DoesNotExist:
        raise NotFound()
    read = request.data.get("read", True) if isinstance(request.data, dict) else True
    n.read_at = timezone.now() if read else None  # 읽음만 바뀌고 해결 여부(resolved_at)는 그대로
    n.save(update_fields=["read_at"])
    return Response(payload(n))


@api_view(["POST"])
def notification_read_all(request):
    case = _case_or_none((request.data or {}).get("case") if isinstance(request.data, dict) else None)
    n = scoped(case).filter(read_at__isnull=True).update(read_at=timezone.now())
    return Response({"updated": n})


CLIENT_KINDS = {"server_down", "db_error", "calc_failed", "autosave_failed", "autosave_ok"}


@api_view(["POST"])
def client_event(request):
    """브라우저가 감지한 사건. 문구는 서버가 만들고, 브라우저가 보낸 문장은 쓰지 않습니다."""
    d = request.data if isinstance(request.data, dict) else {}
    kind = d.get("kind")
    if kind not in CLIENT_KINDS:
        return api_error("VALIDATION_ERROR", 400, "알 수 없는 사건입니다.", "Unknown event kind.")
    if kind in ("server_down", "db_error"):
        since, until = parse_datetime(str(d.get("since") or "")), parse_datetime(str(d.get("until") or ""))
        now = timezone.now()
        if not since or not until or since.tzinfo is None or until.tzinfo is None or not (now - timedelta(days=7) < since < until <= now + timedelta(minutes=1)):
            return api_error("VALIDATION_ERROR", 400, "시간 범위가 올바르지 않습니다.", "Invalid time range.")
        key = f"sys.{kind}:{since.timestamp():.0f}"
        if Notification.objects.filter(event_key=key).exists():  # 같은 끊김을 두 번 보내도 1건
            return Response({"created": False})
        E.on_outage(kind, since, until)
        return Response({"created": True}, status=201)
    case = _case_or_none(d.get("case"))
    if case is None:
        return api_error("VALIDATION_ERROR", 400, "케이스가 필요합니다.", "A case is required.")
    if kind == "calc_failed":
        known = {f["key"] for f in F.FIELDS}
        bad = [x for x in (d.get("fields") or []) if isinstance(x, str) and x in known][:20]
        E.on_calc_failed(case, bad, "계산 실행 (입력값 검사)")
    else:
        where = str(d.get("where") or "")
        E.on_autosave(case, kind == "autosave_ok", where if where.startswith("/") and len(where) < 100 else "")
    return Response({"ok": True}, status=201)
