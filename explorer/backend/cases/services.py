"""케이스 데이터 처리: 입력값·계산·결과 유효성·체크리스트·실측값.

모든 계산은 저장된 입력값(서버 DB)으로만 합니다. 화면이 보낸 결과 값은 믿지 않습니다.
"""

import hashlib
import math
from datetime import date, datetime

from django.db import transaction
from django.utils import timezone

from engine import demo_calc, fields, kit
from engine.base import msg
from engine.comparison import MEASUREMENT_FIELDS, evaluate_comparison
from engine.pinch import VERSION as PINCH_VERSION
from engine.pinch import evaluate_pinch
from engine.reference_estimate import VERSION as REF_VERSION
from engine.reference_estimate import evaluate_reference

from . import checklist_registry as reg
from .models import CalculationInput, CalculationResult, CalculationSnapshot, ChecklistItem

KINDS = ["performance", "economics", "pinch", "reference", "comparison"]


# ---------------------------------------------------------------- 케이스 기본 데이터
def ensure_case_data(case, scenario=None):
    """입력값·체크리스트 행이 없으면 만듭니다 (새 케이스는 프롬프트 DEMO 기본값)."""
    if not hasattr(case, "calc_input"):
        values = fields.scenario_inputs(scenario) if scenario else dict(fields.DEFAULTS)
        CalculationInput.objects.get_or_create(case=case, defaults={"values": values, "scenario": scenario or fields.match_scenario(values)})
    have = set(case.checklist.values_list("item_id", flat=True))
    ChecklistItem.objects.bulk_create([ChecklistItem(case=case, item_id=i["id"], unit=i["unit"] or "")
                                       for i in reg.ITEMS if i["id"] not in have])


def get_input(case):
    ensure_case_data(case)
    return CalculationInput.objects.get(case=case)


def current_hash(ci):
    return fields.inputs_hash(ci.mode, ci.values)


def input_payload(ci):
    return {"mode": ci.mode, "scenario": fields.effective_scenario(ci.values, ci.scenario) if ci.mode == "DEMO" else "CUSTOM",
            "values": ci.values, "sources": fields.value_sources(ci.mode, ci.scenario, ci.values),
            "hash": current_hash(ci), "warnings": fields.clean_inputs(ci.values)[2], "updated_at": ci.updated_at}


def save_inputs(case, data):
    """→ (payload, errors). 오류가 하나라도 있으면 저장하지 않습니다."""
    ci = get_input(case)
    mode = data.get("mode", ci.mode)
    errors = {}
    if mode not in ("DEMO", "USER"):
        errors["mode"] = msg("DEMO 또는 USER 여야 합니다.", "Must be DEMO or USER.")
    scenario = data.get("scenario", ci.scenario)
    if scenario not in (*fields.SCENARIOS, "CUSTOM"):
        errors["scenario"] = msg("알 수 없는 시나리오입니다.", "Unknown scenario.")
    values, value_errors, _ = fields.clean_inputs(data.get("values", ci.values))
    errors.update(value_errors)
    if errors:
        return None, errors
    ci.mode, ci.values = mode, values
    ci.scenario = fields.effective_scenario(values, scenario) if mode == "DEMO" else "CUSTOM"
    ci.save()
    return input_payload(ci), None


# ---------------------------------------------------------------- 계산
def _compute(kind, case, ci):
    v = ci.values
    if kind == "performance":
        return demo_calc.evaluate_performance(ci.mode, ci.scenario, v)[0], demo_calc.VERSION
    if kind == "economics":
        loss = demo_calc.evaluate_performance("DEMO", None, v)[1] if ci.mode == "DEMO" else None
        return demo_calc.evaluate_economics(v, loss), demo_calc.VERSION
    if kind == "pinch":
        return evaluate_pinch(v), PINCH_VERSION
    if kind == "reference":
        gt_mw = v["capacityMW"] * v["loadFactor"] / 100
        _, r = evaluate_reference({"current_dp_kpa": v.get("hrsgDpKpa"), "clean_dp_kpa": v.get("hrsgDpCleanKpa"),
                                   "post_cleaning_dp_kpa": v.get("hrsgDpPostKpa"), "gt_output_mw": gt_mw})
        r["gtOutputMW"] = {"value": round(gt_mw, 3), "unit": "MW",
                           "note": msg("정격 용량 × 부하율 (현재 출력으로 사용)", "Capacity × load factor (used as current output)")}
        return r, REF_VERSION
    if kind == "comparison":
        ms = [measurement_payload(m) for m in case.measurements.all()]
        return evaluate_comparison(v, ms), demo_calc.VERSION
    raise ValueError(kind)


def comparison_hash(case, ci):
    """세정 전후 결과는 입력값과 실측값 모두에 따라 달라집니다."""
    rows = list(case.measurements.values_list("id", "day_offset", "back_pressure", "stack_temp_c", "load_factor", "ambient_temp_c"))
    return hashlib.sha256(f"{current_hash(ci)}|{rows}".encode()).hexdigest()[:16]


def result_hash(kind, case, ci):
    return comparison_hash(case, ci) if kind == "comparison" else current_hash(ci)


@transaction.atomic
def evaluate(case, kinds):
    ci = get_input(case)
    now = timezone.now()
    out = {}
    for kind in kinds:
        payload, version = _compute(kind, case, ci)
        h = result_hash(kind, case, ci)
        CalculationResult.objects.update_or_create(case=case, kind=kind, defaults={
            "inputs_hash": h, "payload": payload, "engine_version": version, "computed_at": now})
        out[kind] = {"payload": payload, "computed_at": now, "inputs_hash": h, "stale": False, "engine_version": version}
    return out


def results(case):
    ci = get_input(case)
    out = {}
    for r in case.results.all():
        out[r.kind] = {"payload": r.payload, "computed_at": r.computed_at, "inputs_hash": r.inputs_hash,
                       "engine_version": r.engine_version, "stale": r.inputs_hash != result_hash(r.kind, case, ci)}
    last = max((r["computed_at"] for r in out.values()), default=None)
    return {"results": out, "current_hash": current_hash(ci), "last_calculated_at": last}


def create_snapshot(case, label):
    """현재 입력과 '유효한' 결과만 저장합니다. 재평가가 필요한 결과가 있으면 None."""
    ci = get_input(case)
    res = results(case)["results"]
    valid = {k: r["payload"] for k, r in res.items() if not r["stale"] and k != "comparison"}
    if not valid or any(r["stale"] for k, r in res.items() if k != "comparison"):
        return None
    return CalculationSnapshot.objects.create(case=case, label=label[:100], mode=ci.mode, scenario=ci.scenario,
                                              values=ci.values, results=valid, inputs_hash=current_hash(ci),
                                              engine_version=demo_calc.VERSION)


def snapshot_payload(s, full=False):
    out = {"id": s.id, "label": s.label, "mode": s.mode, "scenario": s.scenario, "inputs_hash": s.inputs_hash,
           "engine_version": s.engine_version, "created_at": s.created_at}
    perf, econ = s.results.get("performance"), s.results.get("economics")
    out["summary"] = {
        "lossMW": perf and perf["lossMW"]["value"], "excessBP": perf and perf["excessBP"]["value"],
        "cleaningScore": perf and perf["cleaningScore"]["value"], "shortestPayback": econ and econ["shortestPayback"],
    }
    if full:
        out.update(values=s.values, results=s.results)
    return out


# ---------------------------------------------------------------- 체크리스트
CHECKLIST_FIELDS = ["reviewed", "value", "unit", "location", "condition", "measured_at", "data_source",
                    "supply_status", "verify_status", "document_confirmed", "memo"]


def _has_value(item, row):
    """검증 완료 조건: 문서형은 확인 표시, 그 밖에는 값 (숫자형은 숫자여야 함)."""
    if item["data_type"] == "document":
        return row["document_confirmed"]
    v = (row["value"] or "").strip()
    if not v:
        return False
    if item["data_type"] == "number":
        try:
            return math.isfinite(float(v.replace(",", "")))
        except ValueError:
            return False
    return True


def checklist_row(row, prog=None):
    item = reg.BY_ID[row.item_id]
    kit_item = next(i for i in kit.C()["items"] if i["id"] == row.item_id)
    prog = prog if prog is not None else kit.to_kit_progress([row])
    return {**item, "state": {f: getattr(row, f) for f in CHECKLIST_FIELDS}, "updated_at": row.updated_at,
            "measure_cell": kit.checklist.measure_cell(kit_item, prog), "detail_line": kit.checklist.detail_line(kit_item)}


def checklist_summary(rows):
    """키트 kpis · by_category · distribution · matrix 로 계산 (해당 없음은 비율 분모에서 제외, 수령 = 수령 완료 + 검증 필요).
    키 이름은 대시보드·알림·AI 문맥이 쓰는 기존 이름을 유지합니다."""
    C, prog = kit.C(), kit.to_kit_progress(rows)
    k = kit.checklist.kpis(C, prog)
    dist = kit.checklist.distribution(C, prog)
    cats = kit.checklist.by_category(C, prog)
    mat = kit.checklist.matrix(C, prog)
    up = kit.SUPPLY_FROM_KIT
    return {
        "totalCount": k["received"]["total"], "receivedCount": k["received"]["done"],
        "verifiedCount": k["verified"]["done"], "reviewedCount": k["reviewed"]["done"],
        "requiredCount": k["required"]["total"], "requiredMetCount": k["required"]["done"],
        "missingRequiredCount": len(dist["missing_required"]),
        "readinessRate": k["received"]["percent"], "reviewRate": k["reviewed"]["percent"], "verifiedRate": k["verified"]["percent"],
        "requiredMetRate": k["required"]["percent"],
        "byCategory": {c["id"]: {"total": c["total"], "received": c["done"], "rate": c["percent"]} for c in cats},
        "bySupply": {up[s]: n for s, n in dist["supply"].items()},
        "matrix": {m["id"]: {up[s]: n for s, n in m["counts"].items()} for m in mat},
        "byVerify": {kit.VERIFY_FROM_KIT[s]: n for s, n in dist["verify"].items()},
        "missingRequired": dist["missing_required"],
        "itemCount": dist["total"],
        "provisional": reg.PROVISIONAL,
    }


def checklist_filter(rows, params):
    """목록 필터 = 키트 filter_items (검색: ID·항목명·이유, 카테고리, 수급 상태, 필수만) → 항목 ID 목록"""
    supply = params.get("supply") or "all"
    out = kit.checklist.filter_items(kit.C(), kit.to_kit_progress(rows), query=params.get("q") or "",
                                     category=params.get("category") or "all",
                                     supply=kit.SUPPLY_TO_KIT.get(supply, supply) if supply != "all" else "all",
                                     required_only=params.get("required") in ("1", "true"))
    return [i["id"] for i in out]


def _parse_dt(v):
    if v in (None, ""):
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError
    return d if d.tzinfo else timezone.make_aware(d)


@transaction.atomic
def update_checklist(case, updates):
    """→ (rows, errors). 오류가 있으면 아무것도 저장하지 않습니다 (일괄 처리도 전부 또는 전무)."""
    ensure_case_data(case)
    rows = {r.item_id: r for r in case.checklist.select_for_update()}
    errors = {}
    if not isinstance(updates, list):
        return None, {"updates": msg("목록 형식이어야 합니다.", "Must be a list.")}
    changed = []
    for u in updates:
        iid = u.get("id") if isinstance(u, dict) else None
        if iid not in rows:
            errors[str(iid)] = msg("알 수 없는 항목입니다.", "Unknown item.")
            continue
        row, item = rows[iid], reg.BY_ID[iid]
        # 동시 수정 감지 (선택): 화면이 불러온 시각과 서버의 마지막 수정 시각이 다르면 저장하지 않음 (다른 기기에서 먼저 수정)
        exp = u.get("expected_updated_at")
        if exp is not None:
            try:
                seen = _parse_dt(exp)
            except ValueError:
                seen = None
            if seen is None or abs((row.updated_at - seen).total_seconds()) > 0.001:
                errors[f"{iid}.conflict"] = msg("다른 화면·기기에서 먼저 수정했습니다. 최신 값을 다시 불러온 뒤 저장하세요.",
                                                 "Changed elsewhere first. Reload the latest values, then save.")
                continue
        state = {f: getattr(row, f) for f in CHECKLIST_FIELDS}
        for f, v in u.items():
            if f in ("id", "expected_updated_at"):
                continue
            if f not in CHECKLIST_FIELDS:
                errors[f"{iid}.{f}"] = msg("수정할 수 없는 항목입니다.", "Field cannot be changed.")
            elif f == "supply_status" and v not in reg.SUPPLY:
                errors[f"{iid}.{f}"] = msg("알 수 없는 수급 상태입니다.", "Unknown supply status.")
            elif f == "verify_status" and v not in reg.VERIFY:
                errors[f"{iid}.{f}"] = msg("알 수 없는 검증 상태입니다.", "Unknown verification status.")
            elif f in ("reviewed", "document_confirmed") and not isinstance(v, bool):
                errors[f"{iid}.{f}"] = msg("참/거짓 값이어야 합니다.", "Must be true/false.")
            elif f == "measured_at":
                try:
                    state[f] = _parse_dt(v)
                except ValueError:
                    errors[f"{iid}.{f}"] = msg("날짜·시간 형식이 아닙니다.", "Not a date/time.")
            else:
                state[f] = (v.strip() or None) if f == "value" and isinstance(v, str) else ("" if v is None and f != "value" else v)
        if state["value"] is not None and item["data_type"] == "number":
            try:
                if not math.isfinite(float(str(state["value"]).replace(",", ""))):
                    raise ValueError
            except ValueError:
                errors[f"{iid}.value"] = msg("숫자를 입력하세요.", "Enter a number.")
        if state["verify_status"] == "VERIFIED" and not _has_value(item, state):
            errors[f"{iid}.verify_status"] = msg(
                "측정값이 없으면 검증 완료로 바꿀 수 없습니다." if item["data_type"] != "document" else "문서 확인 표시 없이 검증 완료로 바꿀 수 없습니다.",
                "Cannot verify without a value." if item["data_type"] != "document" else "Cannot verify without confirming the document.")
        for f, v in state.items():
            setattr(row, f, v)
        changed.append(row)
    if errors:
        transaction.set_rollback(True)
        return None, errors
    for row in changed:
        row.save()
    return changed, None


def request_text(case, opts):
    """데이터 요청 메일 초안 = 키트 email_draft(C, progress, ids). 표에서 체크한 ID(ids)가 있으면 그 항목만,
    없으면 아직 받지 않은 항목 전부(해당 없음 제외). 문구만 만들고 발송하지 않습니다. 본문은 키트 문구(한국어)입니다."""
    lang = "en" if opts.get("lang") == "en" else "ko"
    fmt = "html" if opts.get("format") == "html" else "markdown"
    rows = list(case.checklist.all())
    prog = kit.to_kit_progress(rows)
    ids = opts.get("ids")
    ids = [i for i in ids if i in reg.BY_ID] if isinstance(ids, list) else None
    plant = (opts.get("plant") or "").strip()
    text = kit.checklist.email_draft(kit.C(), prog, ids=ids, plant=plant, due=(opts.get("due") or "").strip())
    picked = [i["id"] for i in kit.C()["items"]
              if (i["id"] in ids if ids is not None else not (kit.checklist.is_received(prog, i["id"]) or kit.checklist.is_na(prog, i["id"])))]
    plant_label = plant or ("[발전소명]" if lang == "ko" else "[Plant]")
    subject = (opts.get("subject") or "").strip() or (
        f"[{plant_label}] HRSG 성능·세정 검토용 데이터 요청" if lang == "ko" else f"[{plant_label}] Data request for HRSG performance & cleaning review")
    if fmt == "html":
        from html import escape
        body = "".join(f"<p>{escape(line)}</p>" if line else "" for line in text.split("\n"))
    else:
        body = text
    return {"subject": subject, "body": body, "format": fmt, "lang": lang, "items": picked,
            "items_key": ",".join(sorted(picked)), "generated_at": timezone.now(), "count": len(picked)}


# ---------------------------------------------------------------- 세정 전후 실측값
def measurement_payload(m):
    return {"id": m.id, "dayOffset": m.day_offset, "backPressure": m.back_pressure, "stackTempC": m.stack_temp_c,
            "loadFactor": m.load_factor, "ambientTempC": m.ambient_temp_c,
            "measuredOn": m.measured_on.isoformat() if m.measured_on else None, "memo": m.memo}


_COLUMN = {"dayOffset": "day_offset", "backPressure": "back_pressure", "stackTempC": "stack_temp_c",
           "loadFactor": "load_factor", "ambientTempC": "ambient_temp_c"}


def clean_measurement(data, partial=False):
    """→ (모델 필드 dict, errors)."""
    out, errors = {}, {}
    for key, spec in MEASUREMENT_FIELDS.items():
        if partial and key not in data:
            continue
        v = data.get(key)
        if v in (None, ""):
            if spec["required"]:
                errors[key] = msg("필수 입력입니다.", "Required.")
            out[_COLUMN[key]] = None
            continue
        try:
            x = float(v)
            if not math.isfinite(x):
                raise ValueError
        except (TypeError, ValueError):
            errors[key] = msg("숫자를 입력하세요.", "Enter a number.")
            continue
        if spec.get("integer") and not x.is_integer():
            errors[key] = msg("정수(일)로 입력하세요.", "Enter whole days.")
        elif not spec["min"] <= x <= spec["max"]:
            errors[key] = msg(f"허용 범위 {spec['min']} ~ {spec['max']} {spec['unit']}", f"Allowed range {spec['min']} – {spec['max']} {spec['unit']}")
        else:
            out[_COLUMN[key]] = int(x) if spec.get("integer") else x
    if not partial or "measuredOn" in data:
        d = data.get("measuredOn")
        try:
            out["measured_on"] = date.fromisoformat(d) if d else None
        except (TypeError, ValueError):
            errors["measuredOn"] = msg("날짜 형식(YYYY-MM-DD)이 아닙니다.", "Not a date (YYYY-MM-DD).")
    if not partial or "memo" in data:
        out["memo"] = str(data.get("memo") or "")[:200]
    return out, errors
