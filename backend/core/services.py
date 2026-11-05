"""케이스·체크리스트 관련 서버 로직 (진행률, 요청문, 평가 개요)."""

from django.db import transaction

from calculators.economics import evaluate_economics

from . import checklist_seed as seed
from . import evaluation
from .models import CalculationInput, ChecklistItem, EvaluationCase
from .operating_fields import empty_operating_values

Status = ChecklistItem.Status


def lang_of(request):
    return "en" if request.query_params.get("lang") == "en" else "ko"


# ---------------------------------------------------------------- 케이스 생성·항목 동기화

def ensure_case_setup(case):
    """케이스에 빠진 체크리스트 항목과 계산 입력을 추가합니다. 이미 있는 값은 절대 바꾸지 않습니다.

    체크리스트 목록(checklist_seed)에 항목이 새로 추가되면 기존 케이스에도 '미수신'으로 붙습니다.
    반환값: 새로 추가된 항목 수
    """
    existing = set(case.checklist_items.values_list("key", flat=True))
    new_items = [
        ChecklistItem(
            case=case,
            key=c["key"],
            category=c["category"],
            order=i,
            name_ko=c["name_ko"],
            name_en=c["name_en"],
            unit=c["unit"],
            source=c["source"],
        )
        for i, c in enumerate(seed.CHECKLIST_CATALOG)
        if c["key"] not in existing
    ]
    ChecklistItem.objects.bulk_create(new_items)
    CalculationInput.objects.get_or_create(case=case, defaults={"operating_values": empty_operating_values()})
    return len(new_items)


@transaction.atomic
def create_case(name, memo="", seed_key=None):
    case = EvaluationCase.objects.create(name=name, memo=memo, seed_key=seed_key)
    ensure_case_setup(case)
    return case


# ---------------------------------------------------------------- 진행률

def _counts(items):
    total = len(items)
    missing = sum(1 for i in items if i.status == Status.MISSING)
    received = sum(1 for i in items if i.status == Status.RECEIVED)
    verified = sum(1 for i in items if i.status == Status.VERIFIED)
    pct = lambda n: round(n * 100 / total) if total else 0  # noqa: E731
    return {
        "total": total,
        "missing": missing,
        "received": received,
        "verified": verified,
        "received_or_verified": received + verified,
        "received_pct": pct(received + verified),  # 수신 진행률 (수신 + 검증 완료)
        "verified_pct": pct(verified),
    }


def progress(items):
    items = list(items)
    result = _counts(items)
    result["by_category"] = {
        code: _counts([i for i in items if i.category == code]) for code in seed.CATEGORY_CODES
    }
    return result


# ---------------------------------------------------------------- 요청문

REQUEST_TEXT = {
    "ko": {
        "subject": "[HRSG 평가] 플랜트 데이터 요청 — {case}",
        "intro": "안녕하세요.\nHRSG 성능·세정 검토를 위해 아래 데이터를 요청드립니다.\n"
                 "각 항목의 측정 위치·조건과 측정 시점을 함께 알려 주세요.",
        "footer": "※ 본 목록은 계획서 기반 초안입니다. (미수신 {n}개 항목)",
        "none": "미수신 항목이 없습니다.",
        "subject_label": "제목",
    },
    "en": {
        "subject": "[HRSG review] Plant data request — {case}",
        "intro": "Hello,\nFor the HRSG performance and cleaning review, we would like to request the data below.\n"
                 "Please include the measurement location/conditions and measurement time for each item.",
        "footer": "* This list is a plan-based draft. ({n} items not yet received)",
        "none": "There are no items left to request.",
        "subject_label": "Subject",
    },
}


def request_text(case, lang):
    """미수신 항목만 범주별로 묶은 이메일용 요청문. 고객사·발전소 실명은 넣지 않습니다."""
    t = REQUEST_TEXT[lang]
    missing = list(case.checklist_items.filter(status=Status.MISSING))
    subject = t["subject"].format(case=case.name)
    if not missing:
        body = t["none"]
    else:
        blocks = []
        for cat in seed.CATEGORIES:
            rows = [i for i in missing if i.category == cat["code"]]
            if not rows:
                continue
            lines = [f"■ {cat[lang]}"]
            for i in rows:
                name = i.name_en if lang == "en" else i.name_ko
                unit = f" ({i.unit})" if i.unit and i.unit != "—" else ""
                lines.append(f" - {name}{unit}")
            blocks.append("\n".join(lines))
        body = "\n\n".join([t["intro"], *blocks, t["footer"].format(n=len(missing))])
    return {
        "subject": subject,
        "body": body,
        "text": f"{t['subject_label']}: {subject}\n\n{body}",
        "count": len(missing),
        "keys": [i.key for i in missing],
    }


# ---------------------------------------------------------------- 평가 개요

OVERVIEW_TEXT = {
    "ko": {
        "PERFORMANCE_REAL": "성능 평가 (실제)",
        "PERFORMANCE_DEMO": "성능 평가 (DEMO)",
        "ECONOMICS": "경제성 (사용자 가정)",
        "PINCH_APPROACH": "핀치·어프로치",
        "real_unavailable": "산출 불가 — 승인된 계산 모델이 연동되지 않았습니다.",
        "demo_ok": "가상 시나리오를 고르면 시연용 고정 예시 결과를 볼 수 있습니다. (실제 평가 아님)",
        "econ_ok": "사용자 가정 기반 단순 계산이 가능합니다. (검증된 예측 아님)",
        "econ_missing": "가정값을 입력하면 계산할 수 있습니다. (회수 출력, 운전 시간, SMP, 비용)",
        "pinch_unavailable": "산출 불가 — 검증된 물성 계산과 판정 기준값이 없습니다.",
        "REFERENCE": "문헌 기반 참고 추정",
        "ref_ok": "현재·청정 기준 차압으로 공개 문헌 범위의 참고 추정을 볼 수 있습니다. (승인 모델 아님)",
        "ref_missing": "현재 차압과 신규·세정 직후 기준 차압을 입력하면 참고 추정을 볼 수 있습니다.",
        "pinch_ok": "국제 증기 물성 표준(IAPWS-IF97)으로 핀치·어프로치를 참고 계산할 수 있습니다. (판정 아님)",
        "pinch_missing": "드럼 압력(게이지/절대), 절탄기 출구 급수 온도, 증발기 출구 가스 온도가 필요합니다. (참고 계산)",
        "REEVALUATE": "입력이 바뀌어 다시 평가해야 하는 결과가 있습니다: {kinds}.",
        "ENTER_ECONOMICS": "경제성 가정값(회수 출력, 운전 시간, SMP, 비용)을 입력하세요.",
        "kind_names": {"PERFORMANCE": "성능", "ECONOMICS": "경제성", "PINCH_APPROACH": "핀치·어프로치",
                       "REFERENCE": "문헌 참고 추정"},
        "REQUEST_MISSING": "미수신 항목 {n}개 (필수 {r}개, 임시 기준) — 데이터 준비에서 요청문을 복사해 보내세요.",
        "VERIFY_RECEIVED": "수신했지만 검증하지 않은 항목 {n}개 — 값을 확인한 뒤 '검증 완료'로 표시하세요.",
        "ENTER_OPERATING": "운전 입력값 {n}개가 비어 있습니다 — 성능·경제성 평가에서 입력하세요.",
        "ALL_DONE": "모든 체크리스트 항목이 검증 완료되었습니다.",
    },
    "en": {
        "PERFORMANCE_REAL": "Performance (real)",
        "PERFORMANCE_DEMO": "Performance (DEMO)",
        "ECONOMICS": "Economics (user assumptions)",
        "PINCH_APPROACH": "Pinch / approach",
        "real_unavailable": "Not available — the approved calculation model is not connected.",
        "demo_ok": "Pick a virtual scenario to see fixed example results for demonstration. (Not a real evaluation)",
        "econ_ok": "A simple calculation based on user assumptions is possible. (Not a validated forecast)",
        "econ_missing": "Enter assumptions to calculate (recovered output, hours, SMP, costs).",
        "pinch_unavailable": "Not available — no validated property calculation or reference values.",
        "REFERENCE": "Literature-based reference estimate",
        "ref_ok": "A reference estimate within public-literature ranges is available from current and clean ΔP. (Not an approved model)",
        "ref_missing": "Enter current ΔP and the new-and-clean baseline ΔP to see the reference estimate.",
        "pinch_ok": "Pinch/approach can be calculated for reference with the IAPWS-IF97 steam standard. (Not a judgement)",
        "pinch_missing": "Needs drum pressure (gauge/absolute), economizer outlet water temperature and evaporator outlet gas temperature. (Reference calculation)",
        "REEVALUATE": "Some results need re-evaluation because inputs changed: {kinds}.",
        "ENTER_ECONOMICS": "Enter economics assumptions (recovered output, hours, SMP, costs).",
        "kind_names": {"PERFORMANCE": "performance", "ECONOMICS": "economics", "PINCH_APPROACH": "pinch/approach",
                       "REFERENCE": "literature reference"},
        "REQUEST_MISSING": "{n} items not received ({r} required, provisional) — copy the request text in Data preparation.",
        "VERIFY_RECEIVED": "{n} items received but not verified — check the values and mark them as verified.",
        "ENTER_OPERATING": "{n} operating values are empty — enter them in Performance & economics.",
        "ALL_DONE": "All checklist items are verified.",
    },
}


def _required_progress(items, function):
    req = [i for i in items if seed.required_for(i.key)[function]]
    done = sum(1 for i in req if i.status != Status.MISSING)
    return {"received": done, "total": len(req), "provisional": seed.REQUIREMENT_IS_PROVISIONAL}


def overview(case, lang):
    t = OVERVIEW_TEXT[lang]
    items = list(case.checklist_items.all())
    prog = progress(items)
    calc_input, _ = CalculationInput.objects.get_or_create(case=case)
    ops = calc_input.operating_values or {}
    empty_ops = sum(1 for k in empty_operating_values() if ops.get(k) is None)
    _, econ = evaluate_economics(evaluation.economics_values(calc_input))
    econ_ok = any(m["net_benefit"]["value"] is not None for m in econ["methods"])
    stale = [k for k, r in evaluation.results(case).items() if r and r["stale"]]
    ri = calc_input.reference_inputs or {}
    ref_ok = ri.get("current_dp_kpa") is not None and ri.get("clean_dp_kpa") is not None
    pi = calc_input.pinch_inputs or {}
    pinch_ok = all(pi.get(k) is not None for k in ("drum_pressure", "drum_pressure_basis", "eco_outlet_water_temp",
                                                     "evap_outlet_gas_temp"))

    evaluations = [
        {"kind": "PERFORMANCE", "mode": "REAL", "label": t["PERFORMANCE_REAL"], "available": False,
         "reason": t["real_unavailable"], "required": _required_progress(items, seed.PERFORMANCE)},
        {"kind": "PERFORMANCE", "mode": "DEMO", "label": t["PERFORMANCE_DEMO"], "available": True,
         "reason": t["demo_ok"], "required": None},
        {"kind": "ECONOMICS", "mode": None, "label": t["ECONOMICS"], "available": econ_ok,
         "reason": t["econ_ok"] if econ_ok else t["econ_missing"], "required": None},
        {"kind": "REFERENCE", "mode": None, "label": t["REFERENCE"], "available": ref_ok,
         "reason": t["ref_ok"] if ref_ok else t["ref_missing"], "required": None},
        {"kind": "PINCH_APPROACH", "mode": None, "label": t["PINCH_APPROACH"], "available": pinch_ok,
         "reason": t["pinch_ok"] if pinch_ok else t["pinch_missing"],
         "required": _required_progress(items, seed.PINCH_APPROACH)},
    ]

    actions = []
    if stale:
        actions.append({"code": "REEVALUATE", "count": len(stale), "link": "/evaluate",
                        "text": t["REEVALUATE"].format(kinds=", ".join(t["kind_names"][k] for k in stale))})
    if prog["missing"]:
        req_missing = sum(1 for i in items if i.status == Status.MISSING and seed.is_required(i.key))
        actions.append({"code": "REQUEST_MISSING", "count": prog["missing"],
                        "text": t["REQUEST_MISSING"].format(n=prog["missing"], r=req_missing),
                        "link": "/data?status=MISSING"})
    if prog["received"]:
        actions.append({"code": "VERIFY_RECEIVED", "count": prog["received"],
                        "text": t["VERIFY_RECEIVED"].format(n=prog["received"]),
                        "link": "/data?status=RECEIVED"})
    if empty_ops:
        actions.append({"code": "ENTER_OPERATING", "count": empty_ops,
                        "text": t["ENTER_OPERATING"].format(n=empty_ops), "link": "/evaluate"})
    if not econ_ok:
        actions.append({"code": "ENTER_ECONOMICS", "count": 1, "text": t["ENTER_ECONOMICS"], "link": "/evaluate"})
    if not actions:
        actions.append({"code": "ALL_DONE", "count": 0, "text": t["ALL_DONE"], "link": None})

    return {
        "case": {"id": case.id, "name": case.name},
        "readiness": prog,
        "operating_values": {"empty": empty_ops, "total": len(empty_operating_values())},
        "evaluations": evaluations,
        "next_actions": actions[:3],
    }
