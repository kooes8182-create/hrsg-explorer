"""평가 실행·결과 저장·오래된 결과(stale) 판단."""

from django.utils import timezone

from calculators import demo_scenarios as demo
from calculators.economics import METHODS, NUMBER_FIELDS, evaluate_economics, empty_assumptions
from calculators.economics import DATA_SOURCE as ECON_SOURCE, FIELD_NAMES, VERSION as ECON_VERSION
from calculators.performance import evaluate_performance
from calculators.pinch_approach import DATA_SOURCE as PINCH_SOURCE, FIELDS as PINCH_FIELDS
from calculators.pinch_approach import VERSION as PINCH_VERSION, evaluate_pinch
from calculators import reference_estimate as ref

from .models import CalculationResult
from .operating_fields import OPERATING_FIELDS

Kind = CalculationResult.Kind
ECON_UNITS = {"recovered_mw": "MW", "operating_hours": "h", "cleaning_cost": "원", "extra_cost": "원"}


def economics_values(calc):
    return calc.economics_assumptions or empty_assumptions()


def _input_rows(kind, calc):
    """결과와 함께 보여줄 입력 조건 (이름·값·단위)."""
    if kind == Kind.PERFORMANCE:
        ov = calc.operating_values or {}
        return [{"key": f["key"], "label": {"ko": f["ko"], "en": f["en"]}, "value": ov.get(f["key"]), "unit": f["unit"]}
                for f in OPERATING_FIELDS]
    if kind == Kind.PINCH_APPROACH:
        pi = calc.pinch_inputs or {}
        rows = [{"key": f["key"], "label": {"ko": f["ko"], "en": f["en"]}, "value": pi.get(f["key"]), "unit": f["unit"]}
                for f in PINCH_FIELDS]
        basis = pi.get("drum_pressure_basis")
        rows.insert(1, {"key": "drum_pressure_basis", "label": {"ko": "드럼 압력 기준", "en": "Drum pressure basis"},
                        "value": {"gauge": "게이지 (g)", "absolute": "절대 (a)"}.get(basis) if basis else None, "unit": ""})
        return rows
    if kind == Kind.REFERENCE:
        ri = calc.reference_inputs or {}
        return [{"key": f["key"], "label": {"ko": f["ko"], "en": f["en"]}, "value": ri.get(f["key"]), "unit": f["unit"]}
                for f in ref.FIELDS]
    a = economics_values(calc)
    rows = [{"key": "smp", "label": FIELD_NAMES["smp"], "value": a["smp"], "unit": "원/kWh",
             "source": a["sources"].get("smp")}]
    for key, name in METHODS.items():
        for field in NUMBER_FIELDS:
            rows.append({
                "key": f"{key}.{field}",
                "label": {lang: f"{name[lang]} · {FIELD_NAMES[field][lang]}" for lang in ("ko", "en")},
                "value": a["methods"][key][field], "unit": ECON_UNITS[field],
                "source": a["sources"].get(f"{key}.{field}"),
            })
    return rows


def run(case, kind):
    """저장된 입력으로 계산하고 결과를 (case, kind) 1건으로 저장합니다."""
    calc = case.calc_input
    notice = None
    if kind == Kind.PERFORMANCE:
        basis, result, version, source, notice = evaluate_performance(
            calc.mode, calc.scenario_id, calc.operating_values or {})
    elif kind == Kind.ECONOMICS:
        basis, result = evaluate_economics(economics_values(calc))
        version, source = ECON_VERSION, ECON_SOURCE
    elif kind == Kind.REFERENCE:
        basis, result = ref.evaluate_reference(calc.reference_inputs or {})
        version, source = ref.VERSION, ref.DATA_SOURCE
    else:
        basis, result = evaluate_pinch(calc.pinch_inputs or {})
        version, source = PINCH_VERSION, PINCH_SOURCE

    now = timezone.now()
    rows = _input_rows(kind, calc)
    meta = {
        "kind": kind,
        "mode": calc.mode if kind == Kind.PERFORMANCE else None,
        "scenario_id": calc.scenario_id if kind == Kind.PERFORMANCE else None,
        "basis": basis,
        "model_version": version,
        "data_source": source,
        "notice": notice,
        "computed_at": now.isoformat(),
        "inputs": rows,
        "missing_inputs": [r["key"] for r in rows if r["value"] is None and r["key"] != "drum_pressure_basis"],
    }
    payload = {"result": result, "meta": meta}
    CalculationResult.objects.update_or_create(
        case=case, kind=kind,
        defaults={"basis": basis, "payload": payload, "inputs_snapshot": calc.snapshot(kind),
                  "model_version": version, "data_source": source, "computed_at": now},
    )
    return {**payload, "stale": False}


def results(case):
    """kind별 최신 결과. 지금 입력과 결과의 입력 스냅샷이 다르면 stale=True (화면은 '재평가 필요'로 가림)."""
    calc = case.calc_input
    out = {k: None for k in Kind.values}
    for r in case.results.all():
        out[r.kind] = {**r.payload, "stale": r.inputs_snapshot != calc.snapshot(r.kind)}
    return out


def reference_mw_values(case):
    """저장된(무효 아닌) 참고 추정의 회수 출력 MW (경제성 입력 출처 '문헌 참고 추정' 확인용)."""
    r = results(case).get(Kind.REFERENCE)
    if not r or r["stale"] or not r["result"].get("recovery"):
        return []
    mw = r["result"]["recovery"]["output_loss_mw"]
    return [x["value"] for x in (mw["low"], mw["high"]) if x["value"] is not None]


def scenarios_payload():
    return {"scenarios": demo.public_scenarios(), "economics_example": demo.ECONOMICS_EXAMPLE, "notice": demo.DEMO_NOTICE,
            "scenario_note": demo.SCENARIO_NOTE}
