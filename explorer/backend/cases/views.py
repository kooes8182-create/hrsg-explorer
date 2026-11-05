from django.db import transaction
from django.http import HttpResponse
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from engine import demo_calc, fields, glossary, kit, public_refs, units
from accounts.policy import guard_plain_view
from notifications import engine as notify
from system.errors import api_error

from . import checklist_registry as reg
from . import excel, services
from .overview import overview
from django.http import FileResponse

from . import photos
from .models import CalculationInput, CalculationSnapshot, ChecklistAttachment, ChecklistItem, EvaluationCase, OperationalMeasurement
from .serializers import CaseSerializer

# 복제 정책: 입력값·체크리스트·세정 전후 실측값은 복제하고, 계산 결과·스냅샷·대화 이력은 복제하지 않습니다.
# (이전 계산 결과가 새 케이스의 결과처럼 보이지 않도록 — 복제한 케이스는 다시 평가해야 함)
CLONE_POLICY = {
    "copied": ["case_info", "inputs", "checklist", "measurements"],
    "not_copied": ["calculation_results", "calculation_snapshots", "conversations"],
}


def get_case(case_id):
    try:
        return EvaluationCase.objects.get(pk=case_id)
    except EvaluationCase.DoesNotExist:
        raise NotFound()


def touch(case):
    case.save(update_fields=["updated_at"])


# ---------------------------------------------------------------- 케이스
@api_view(["GET", "POST"])
def case_list(request):
    if request.method == "GET":
        return Response(CaseSerializer(EvaluationCase.objects.all(), many=True).data)
    ser = CaseSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    case = ser.save()
    services.ensure_case_data(case)
    return Response(CaseSerializer(case).data, status=201)


@api_view(["GET", "PATCH", "DELETE"])
def case_detail(request, case_id):
    case = get_case(case_id)
    if request.method == "GET":
        return Response(CaseSerializer(case).data)
    if request.method == "PATCH":
        ser = CaseSerializer(case, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        return Response(CaseSerializer(ser.save()).data)
    with transaction.atomic():
        # 동시에 두 개를 지워 0개가 되는 일을 막기 위해 잠근 뒤 셉니다.
        count = EvaluationCase.objects.select_for_update().count()
        if count <= 1:
            return api_error("LAST_CASE", 409, "마지막 남은 케이스는 삭제할 수 없습니다.",
                             "The last remaining case cannot be deleted.")
        case.delete()
    return Response(status=204)


@api_view(["POST"])
@transaction.atomic
def case_clone(request, case_id):
    source = get_case(case_id)
    services.ensure_case_data(source)
    name = (request.data.get("name") if isinstance(request.data, dict) else None) or f"{source.name} (사본)"
    ser = CaseSerializer(data={"name": name[:100], "memo": source.memo})
    ser.is_valid(raise_exception=True)
    clone = ser.save(cloned_from=source)
    ci = source.calc_input
    CalculationInput.objects.create(case=clone, mode=ci.mode, scenario=ci.scenario, values=ci.values)
    ChecklistItem.objects.bulk_create([
        ChecklistItem(case=clone, **{f: getattr(r, f) for f in ["item_id", *services.CHECKLIST_FIELDS]})
        for r in source.checklist.all()])
    OperationalMeasurement.objects.bulk_create([
        OperationalMeasurement(case=clone, day_offset=m.day_offset, back_pressure=m.back_pressure, stack_temp_c=m.stack_temp_c,
                               load_factor=m.load_factor, ambient_temp_c=m.ambient_temp_c, measured_on=m.measured_on, memo=m.memo)
        for m in source.measurements.all()])
    return Response({"case": CaseSerializer(clone).data, "policy": CLONE_POLICY}, status=201)


@api_view(["GET"])
def case_overview(request, case_id):
    return Response(overview(get_case(case_id)))


# ---------------------------------------------------------------- 입력값·계산
@api_view(["GET"])
def input_schema(request):
    return Response({**fields.schema(), "units": units.display_table(), "coefficients": demo_calc.DEMO_COEFFICIENTS,
                     "engine_version": demo_calc.VERSION})


@api_view(["GET", "PUT"])
def case_inputs(request, case_id):
    case = get_case(case_id)
    if request.method == "GET":
        return Response(services.input_payload(services.get_input(case)))
    if not isinstance(request.data, dict):
        return api_error("VALIDATION_ERROR", 400)
    payload, errors = services.save_inputs(case, request.data)
    if errors:
        notify.safe(notify.on_calc_failed, case, list(errors), "입력값 저장 (서버 검사)")
        return api_error("VALIDATION_ERROR", 400, fields=errors)
    touch(case)
    notify.safe(notify.sync_case, case)
    return Response(payload)


@api_view(["POST"])
def inputs_reset(request, case_id):
    """DEMO 기본값(프롬프트 11-1) 또는 시나리오 값으로 되돌립니다."""
    case = get_case(case_id)
    sid = request.data.get("scenario") if isinstance(request.data, dict) else None
    if sid is not None and sid not in fields.SCENARIOS:
        return api_error("VALIDATION_ERROR", 400, fields={"scenario": {"ko": "알 수 없는 시나리오입니다.", "en": "Unknown scenario."}})
    values = fields.scenario_inputs(sid) if sid else dict(fields.DEFAULTS)
    ci = services.get_input(case)
    payload, errors = services.save_inputs(case, {"mode": ci.mode, "scenario": sid or fields.match_scenario(values), "values": values})
    touch(case)
    notify.safe(notify.sync_case, case)
    return Response(payload)


@api_view(["POST"])
def evaluate(request, case_id, kind):
    case = get_case(case_id)
    kinds = [k for k in services.KINDS if k != "comparison"] if kind == "all" else [kind]
    if any(k not in services.KINDS for k in kinds):
        raise NotFound()
    prev = case.results.filter(kind="performance").first()
    prev_score = (prev.payload.get("cleaningScore") or {}).get("value") if prev else None
    try:
        out = services.evaluate(case, kinds)
    except Exception:  # 계산 엔진 내부 오류: 알림을 남기고 짧은 오류만 돌려줌
        notify.safe(notify.on_calc_failed, case, [], "계산 엔진 (서버 오류)")
        return api_error("CALCULATION_FAILED", 500, "계산 중 오류가 발생했습니다.", "The calculation failed.")
    touch(case)
    notify.safe(notify.on_evaluated, case, kinds, prev_score)
    return Response({"results": out, "current_hash": services.current_hash(case.calc_input)})


@api_view(["GET"])
def case_results(request, case_id):
    return Response(services.results(get_case(case_id)))


@api_view(["GET", "POST"])
def snapshots(request, case_id):
    case = get_case(case_id)
    if request.method == "GET":
        return Response([services.snapshot_payload(s) for s in case.snapshots.all()])
    label = (request.data.get("label") if isinstance(request.data, dict) else "") or ""
    snap = services.create_snapshot(case, str(label))
    if snap is None:
        return api_error("REEVALUATION_REQUIRED", 409, "현재 입력으로 계산한 결과가 없습니다. 평가를 실행한 뒤 저장하세요.",
                         "No results for the current inputs. Run the evaluation, then save.")
    notify.safe(notify.on_snapshot, case, snap)
    return Response(services.snapshot_payload(snap, full=True), status=201)


def get_snapshot(case, sid):
    try:
        return case.snapshots.get(pk=sid)
    except CalculationSnapshot.DoesNotExist:
        raise NotFound()


@api_view(["GET"])
def snapshot_detail(request, case_id, sid):
    return Response(services.snapshot_payload(get_snapshot(get_case(case_id), sid), full=True))


@api_view(["POST"])
def snapshot_restore(request, case_id, sid):
    """스냅샷의 입력값을 현재 입력으로 불러옵니다. 결과는 다시 평가해야 합니다 (스냅샷은 그대로 보존)."""
    case = get_case(case_id)
    s = get_snapshot(case, sid)
    payload, errors = services.save_inputs(case, {"mode": s.mode, "scenario": s.scenario, "values": s.values})
    if errors:
        return api_error("VALIDATION_ERROR", 400, fields=errors)
    touch(case)
    notify.safe(notify.sync_case, case)
    return Response(payload)


# ---------------------------------------------------------------- 체크리스트
@api_view(["GET", "PATCH"])
def checklist(request, case_id):
    case = get_case(case_id)
    services.ensure_case_data(case)
    if request.method == "PATCH":
        updates = request.data.get("updates") if isinstance(request.data, dict) else None
        before = dict(case.checklist.values_list("item_id", "supply_status"))
        _, errors = services.update_checklist(case, updates)
        if errors and any(k.endswith(".conflict") for k in errors):
            return api_error("CONFLICT", 409, "다른 화면·기기에서 먼저 수정했습니다.", "Changed elsewhere first.", fields=errors)
        if errors:
            return api_error("VALIDATION_ERROR", 400, fields=errors)
        touch(case)
        notify.safe(notify.on_checklist_changed, case, before, dict(case.checklist.values_list("item_id", "supply_status")))
    order = {i["id"]: n for n, i in enumerate(reg.ITEMS)}
    rows = sorted((r for r in case.checklist.all() if r.item_id in order), key=lambda r: order[r.item_id])  # 키트 항목 순서
    prog = kit.to_kit_progress(rows)
    check = kit.checklist.validate_progress(kit.C(), prog)
    bad = {r.item_id for r in rows for e in check["errors"] if e.startswith(f"{r.item_id}.")}
    if bad:  # 키트 상태 검사 오류가 있는 항목만 처음 상태로 (README 작업 7)
        for r in rows:
            if r.item_id in bad:
                r.supply_status, r.verify_status = "NOT_ENTERED", "UNVERIFIED"
                r.save(update_fields=["supply_status", "verify_status", "updated_at"])
        prog = kit.to_kit_progress(rows)
    photo_count = {}
    for iid in case.attachments.values_list("item_id", flat=True):
        photo_count[iid] = photo_count.get(iid, 0) + 1
    params = request.query_params if request.method == "GET" else {}
    return Response({
        "items": [{**services.checklist_row(r, prog), "photos": photo_count.get(r.item_id, 0)} for r in rows],
        "summary": services.checklist_summary(rows),
        "filtered": services.checklist_filter(rows, params),  # 키트 filter_items (검색·카테고리·상태·필수만)
        "categories": reg.CATEGORIES,
        "labels": {"supply": reg.SUPPLY_LABELS, "verify": reg.VERIFY_LABELS},
        "progress_check": kit.checklist.validate_progress(kit.C(), prog),
        "progress_reset": sorted(bad),
    })


@api_view(["POST"])
def checklist_request_text(request, case_id):
    case = get_case(case_id)
    services.ensure_case_data(case)
    return Response(services.request_text(case, request.data if isinstance(request.data, dict) else {}))


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(data, name):
    r = HttpResponse(data, content_type=XLSX)
    r["Content-Disposition"] = f'attachment; filename="{name}"'
    return r


@api_view(["GET"])
def checklist_export(request, case_id):
    case = get_case(case_id)
    return _xlsx(excel.export(case), f"hrsg-checklist-case{case.id}.xlsx")


@api_view(["GET"])
def checklist_template(request):
    return _xlsx(excel.template(), "hrsg-checklist-template.xlsx")


@api_view(["POST"])
@parser_classes([MultiPartParser])
def checklist_import(request, case_id):
    """Excel 회신 가져오기. apply=1 이 아니면 미리보기만 (저장 안 함)."""
    case = get_case(case_id)
    f = request.FILES.get("file")
    if not f or not f.name.lower().endswith(".xlsx") or f.size > 5 * 1024 * 1024:
        return api_error("VALIDATION_ERROR", 400, "5 MB 이하 .xlsx 파일을 고르세요.", "Choose an .xlsx file up to 5 MB.")
    try:
        data = f.read()
        if request.query_params.get("apply") == "1":
            before = dict(case.checklist.values_list("item_id", "supply_status"))
            out, ok, errors = excel.apply(case, data)
            if not ok:
                return api_error("VALIDATION_ERROR", 400, "오류가 있어 반영하지 않았습니다.", "Not applied due to errors.",
                                 fields=errors or {"rows": {"ko": f"오류 {out['counts']['error']}건", "en": f"{out['counts']['error']} errors"}})
            touch(case)
            notify.safe(notify.on_checklist_changed, case, before, dict(case.checklist.values_list("item_id", "supply_status")))
            return Response({**{k: out[k] for k in ("rows", "counts")}, "applied": True})
        out = excel.parse(case, data)
        return Response({**{k: out[k] for k in ("rows", "counts")}, "applied": False})
    except ValueError as e:
        return api_error("VALIDATION_ERROR", 400, str(e), "Not a valid checklist workbook.")
    except Exception:
        return api_error("VALIDATION_ERROR", 400, "Excel 파일을 읽지 못했습니다.", "Could not read the workbook.")


# ---------------------------------------------------------------- 세정 전후 실측값
@api_view(["GET", "POST"])
def measurements(request, case_id):
    case = get_case(case_id)
    if request.method == "GET":
        return Response([services.measurement_payload(m) for m in case.measurements.all()])
    data, errors = services.clean_measurement(request.data if isinstance(request.data, dict) else {})
    if errors:
        return api_error("VALIDATION_ERROR", 400, fields=errors)
    m = OperationalMeasurement.objects.create(case=case, **data)
    touch(case)
    notify.safe(notify.sync_case, case)
    return Response(services.measurement_payload(m), status=201)


@api_view(["PATCH", "DELETE"])
def measurement_detail(request, case_id, mid):
    case = get_case(case_id)
    try:
        m = case.measurements.get(pk=mid)
    except OperationalMeasurement.DoesNotExist:
        raise NotFound()
    if request.method == "DELETE":
        m.delete()
        touch(case)
        notify.safe(notify.sync_case, case)
        return Response(status=204)
    data, errors = services.clean_measurement(request.data if isinstance(request.data, dict) else {}, partial=True)
    if errors:
        return api_error("VALIDATION_ERROR", 400, fields=errors)
    for k, v in data.items():
        setattr(m, k, v)
    m.save()
    touch(case)
    notify.safe(notify.sync_case, case)
    return Response(services.measurement_payload(m))


# ---------------------------------------------------------------- 공개 자료·용어집
@api_view(["GET"])
def public_smp(request):
    return Response(public_refs.smp_payload())


@api_view(["GET"])
def public_sources(request):
    return Response({"sources": [public_refs.cite(k) | {"quote": s["quote"]} for k, s in public_refs.SOURCES.items()],
                     "checked_on": public_refs.CHECKED_ON})


@api_view(["GET"])
def glossary_view(request):
    return Response(glossary.payload())


# ---------------------------------------------------------------- 체크리스트 사진 (모바일 현장 점검)
def _att_payload(a):
    return {"id": a.id, "item_id": a.item_id, "original_name": a.original_name, "content_type": a.content_type,
            "size": a.size, "created_at": a.created_at, "url": f"/api/attachments/{a.id}/file/"}


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser])
def checklist_attachments(request, case_id, item_id):
    case = get_case(case_id)
    if item_id not in reg.BY_ID:
        raise NotFound()
    if request.method == "GET":
        return Response([_att_payload(a) for a in case.attachments.filter(item_id=item_id)])
    f = request.FILES.get("file")
    if not f:
        return api_error("VALIDATION_ERROR", 400, "사진 파일을 고르세요.", "Choose a photo.")
    att, err = photos.save(case, item_id, f)
    if err:
        return api_error("VALIDATION_ERROR", 400, err[0], err[1])
    touch(case)
    return Response(_att_payload(att), status=201)


def _attachment(aid):
    try:
        return ChecklistAttachment.objects.get(pk=aid)
    except ChecklistAttachment.DoesNotExist:
        raise NotFound()


@api_view(["DELETE"])
def attachment_detail(request, aid):
    a = _attachment(aid)
    a.delete()  # 파일은 post_delete 신호에서 함께 삭제
    return Response(status=204)


@guard_plain_view
def attachment_file(request, aid):
    """사진 보기 (이 앱 화면에서만 사용). 형식은 저장할 때 확인한 값으로 보내고, 브라우저가 다른 형식으로 해석하지 않게 합니다."""
    a = _attachment(aid)
    p = photos.path(a)
    if not p.exists():
        raise NotFound()
    resp = FileResponse(open(p, "rb"), content_type=a.content_type)
    resp["X-Content-Type-Options"] = "nosniff"
    resp["Cache-Control"] = "private, max-age=3600"
    resp["Content-Security-Policy"] = "default-src 'none'; img-src 'self'"
    return resp
