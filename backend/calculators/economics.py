"""사용자 가정 기반 단순 경제성 계산 (가상 공법 A/B).

    추가 발전량(kWh)        = 회수 출력(MW) × 1,000 × 세정 후 예상 운전 시간(h)
    추가 발전 매출(원)       = 추가 발전량(kWh) × SMP(원/kWh)
    입력 비용 반영 순편익(원) = 추가 발전 매출 − 세정 비용 − 정지 손실 및 추가 비용

- 운전 시간은 세정 정지 시간을 뺀 값입니다(정지 시간은 다시 빼지 않음).
- 정지 손실·추가 비용이 세정 비용에 이미 포함되었다고 표시하면 다시 빼지 않습니다(중복 차감 방지).
- 비어 있는 값은 0으로 바꾸지 않고, 그 값이 필요한 결과를 null + 사유로 돌려줍니다.
- 일정한 회수 출력과 SMP를 가정한 단순 비교이며, 실제 순이익이나 검증된 성능 예측이 아닙니다.
"""

from decimal import ROUND_HALF_UP, Decimal

from . import demo_scenarios as demo
from .base import USER_ASSUMPTION, NumberError, msg, none, parse_number, val
from .public_refs import smp_public_values

VERSION = "USER-ASSUMPTION-CALC-v1"
DATA_SOURCE = msg("사용자 입력 가정값 (값마다 출처 표시: 사용자 가정·데모 값·공개 통계·문헌 참고 추정)",
                  "User-entered assumptions (source shown per value: user, demo, public statistics, literature reference)")
NOTICE = msg(
    "일정한 회수 출력과 SMP를 가정한 단순 비교입니다. 실제 순이익이나 검증된 성능 예측이 아닙니다. SMP는 공식 가격이 아닌 입력값입니다.",
    "A simple comparison assuming constant recovered output and SMP. It is not actual profit or a validated performance forecast. SMP is an input value, not an official price.",
)

METHODS = {"A": msg("가상 공법 A", "Virtual method A"), "B": msg("가상 공법 B", "Virtual method B")}
NUMBER_FIELDS = ["recovered_mw", "operating_hours", "cleaning_cost", "extra_cost"]
FIELD_NAMES = {
    "smp": msg("SMP", "SMP"),
    "recovered_mw": msg("회수 출력", "recovered output"),
    "operating_hours": msg("세정 후 예상 운전 시간", "expected operating hours after cleaning"),
    "cleaning_cost": msg("세정 비용", "cleaning cost"),
    "extra_cost": msg("정지 손실 및 추가 비용", "outage loss & additional cost"),
}
# 값 출처: USER(사용자 가정) / DEMO(데모 예시값) / PUBLIC(공개 통계 SMP) / REFERENCE(문헌 참고 추정 회수 출력)
SOURCES = ("USER", "DEMO", "PUBLIC", "REFERENCE")


def empty_assumptions():
    return {
        "smp": None,
        "methods": {k: {f: None for f in NUMBER_FIELDS} | {"extra_cost_included": False} for k in METHODS},
        "sources": {},
    }


def _demo_value(path):
    if path == "smp":
        return demo.ECONOMICS_EXAMPLE["smp"]
    key, field = path.split(".")
    return demo.ECONOMICS_EXAMPLE["methods"][key][field]


def clean_assumptions(raw, reference_mw_values=()):
    """입력 검증 → (값, 오류). 오류 key 는 'smp', 'A.cleaning_cost' 같은 경로입니다.

    reference_mw_values: 저장된(무효 아닌) 문헌 참고 추정의 회수 출력 MW 값들 — 이 값과 같을 때만 출처 REFERENCE 인정.
    """
    if not isinstance(raw, dict):
        return None, {"economics_assumptions": ["객체(JSON object) 형식이어야 합니다."]}
    errors = {}
    out = empty_assumptions()

    try:
        out["smp"] = parse_number(raw.get("smp"), min_value=0)
    except NumberError as e:
        errors["smp"] = [str(e)]

    methods = raw.get("methods") or {}
    if not isinstance(methods, dict):
        errors["methods"] = ["객체(JSON object) 형식이어야 합니다."]
        methods = {}
    elif any(k not in METHODS for k in methods):
        errors["methods"] = ["가상 공법 A/B 만 입력할 수 있습니다."]
    for key in METHODS:
        m = methods.get(key) or {}
        for field in NUMBER_FIELDS:
            try:
                out["methods"][key][field] = parse_number(m.get(field), min_value=0)
            except NumberError as e:
                errors[f"{key}.{field}"] = [str(e)]
        included = bool(m.get("extra_cost_included", False))
        out["methods"][key]["extra_cost_included"] = included
        if included and out["methods"][key]["extra_cost"] is not None:
            errors[f"{key}.extra_cost"] = [
                "세정 비용에 포함했다고 표시했다면 이 칸은 비워 두세요. (같은 비용 중복 차감 방지)"
            ]

    # 값 출처는 주장만으로 인정하지 않고 실제 값과 맞을 때만 인정합니다. 나머지는 사용자 가정.
    raw_sources = raw.get("sources") or {}
    public_smp = smp_public_values()
    reference_mw = {Decimal(str(v)) for v in reference_mw_values}
    for path in ["smp"] + [f"{k}.{f}" for k in METHODS for f in NUMBER_FIELDS]:
        key, _, field = path.partition(".")
        value = out["smp"] if path == "smp" else out["methods"][key][field]
        if value is None:
            continue
        claimed = raw_sources.get(path) if isinstance(raw_sources, dict) else None
        v = Decimal(str(value))
        if claimed == "DEMO" and v == Decimal(str(_demo_value(path))):
            out["sources"][path] = "DEMO"
        elif claimed == "PUBLIC" and path == "smp" and v in public_smp:
            out["sources"][path] = "PUBLIC"
        elif claimed == "REFERENCE" and field == "recovered_mw" and v in reference_mw:
            out["sources"][path] = "REFERENCE"
        else:
            out["sources"][path] = "USER"
    return out, errors


def _d(x):
    return Decimal(str(x))


def _won(d):
    return int(d.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _kwh(d):
    q = d.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    return int(q) if q == q.to_integral_value() else float(q)


def _missing(names):
    ko = ", ".join(FIELD_NAMES[n]["ko"] for n in names)
    en = ", ".join(FIELD_NAMES[n]["en"] for n in names)
    return msg(f"입력 필요: {ko}", f"Input required: {en}")


def evaluate_economics(a):
    """반환: (basis, result). 같은 입력이면 항상 같은 결과 (Decimal 계산)."""
    smp = a.get("smp")
    sources = a.get("sources", {})
    methods_out = []
    for key, label in METHODS.items():
        m = a["methods"][key]
        mw, hours, cost, extra = m["recovered_mw"], m["operating_hours"], m["cleaning_cost"], m["extra_cost"]
        included = m["extra_cost_included"]

        miss_kwh = [n for n, v in (("recovered_mw", mw), ("operating_hours", hours)) if v is None]
        kwh = None if miss_kwh else _d(mw) * 1000 * _d(hours)
        extra_kwh = none("kWh", _missing(miss_kwh)) if kwh is None else val(_kwh(kwh), "kWh")

        miss_rev = miss_kwh + (["smp"] if smp is None else [])
        revenue = None if miss_rev else kwh * _d(smp)
        revenue_out = none("원", _missing(miss_rev)) if revenue is None else val(_won(revenue), "원")

        miss_net = miss_rev + (["cleaning_cost"] if cost is None else [])
        if not included and extra is None:
            miss_net.append("extra_cost")
        if miss_net:
            net_out = none("원", _missing(miss_net))
        else:
            net = revenue - _d(cost) - (Decimal(0) if included else _d(extra))
            net_out = val(_won(net), "원")

        methods_out.append({
            "key": key,
            "name": label,
            "inputs": {
                "recovered_mw": val(mw, "MW", source=sources.get(f"{key}.recovered_mw")),
                "operating_hours": val(hours, "h", source=sources.get(f"{key}.operating_hours")),
                "cleaning_cost": val(cost, "원", source=sources.get(f"{key}.cleaning_cost")),
                "extra_cost": val(extra, "원", source=sources.get(f"{key}.extra_cost")),
                "extra_cost_included": included,
            },
            "extra_kwh": extra_kwh,
            "revenue": revenue_out,
            "net_benefit": net_out,
        })

    computed = [m for m in methods_out if m["net_benefit"]["value"] is not None]
    best = max(computed, key=lambda m: m["net_benefit"]["value"])["key"] if computed else None
    result = {
        "smp": val(smp, "원/kWh", source=sources.get("smp")),
        "methods": methods_out,
        "max_net_benefit_method": best,  # '가정 기준 순편익 최대' (추천이 아님)
        "complete": len(computed) == len(methods_out),
        "notice": NOTICE,
    }
    return USER_ASSUMPTION, result
