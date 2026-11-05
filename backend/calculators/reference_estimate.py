"""공개 문헌 기반 참고 추정: HRSG 가스측 차압 증가 → 가스터빈 출력·열소비율 영향 (범위).

- 낮은 쪽: GE GER-3567H (Frame 7EA, 4 in H2O 당 출력 −0.42%) / 높은 쪽: IST 2000 (4 in WG 당 약 −1%)
- 4 in 당 값을 차압 증가량에 비례해 적용합니다(선형 적용 가정 — 원문은 4 in 한 점만 제시).
- 승인된 계산 모델이 아닙니다. 스팀터빈 출력·굴뚝 온도 영향은 공개 근거가 없어 산출하지 않습니다.
"""

from decimal import ROUND_HALF_UP, Decimal

from . import public_refs as R
from .base import NumberError, msg, none, parse_number, val

REFERENCE_ESTIMATE = "REFERENCE_ESTIMATE"
VERSION = "PUBLIC-REF-ESTIMATE-v1"
DATA_SOURCE = msg("공개 문헌 (GE GER-3567H, IST 2000, POWER 2015) — 참고 추정, 승인 모델 아님",
                  "Public literature (GE GER-3567H, IST 2000, POWER 2015) — reference estimate, not an approved model")
NOTICE = msg(
    "공개 문헌의 다른 기종·사례 값을 차압 증가량에 비례해 적용한 참고 범위입니다. 이 설비의 성능 예측이 아니며, 원문도 압력손실 영향은 설계마다 다르다고 밝힙니다.",
    "A reference range that scales values from other machines and cases in public literature by the ΔP increase. It is not a performance forecast for this plant; the source itself says the effects are unique to each design.",
)
NO_PUBLIC_BASIS = msg("공개 문헌에서 일반적으로 쓸 수 있는 관계를 찾지 못해 산출하지 않습니다.",
                      "Not calculated: no generally applicable relationship was found in public literature.")

FIELDS = [
    {"key": "current_dp_kpa", "ko": "현재 HRSG 가스측 차압", "en": "Current HRSG gas-side ΔP", "unit": "kPa", "required": True},
    {"key": "clean_dp_kpa", "ko": "신규·세정 직후 기준 차압", "en": "New-and-clean baseline ΔP", "unit": "kPa", "required": True},
    {"key": "post_cleaning_dp_kpa", "ko": "세정 후 기대 차압", "en": "Expected ΔP after cleaning", "unit": "kPa", "required": False},
    {"key": "gt_output_mw", "ko": "가스터빈 출력 (현재)", "en": "Gas turbine output (current)", "unit": "MW", "required": False},
]
NAMES = {f["key"]: f for f in FIELDS}
Q2 = Decimal("0.01")


def _r(d, q=Q2):
    v = d.quantize(q, rounding=ROUND_HALF_UP)
    return float(v)


def clean_reference(raw):
    if not isinstance(raw, dict):
        return None, {"reference_inputs": ["객체(JSON object) 형식이어야 합니다."]}
    errors, out = {}, {}
    for key in raw:
        if key not in NAMES:
            errors[key] = ["알 수 없는 항목입니다."]
    for f in FIELDS:
        try:
            out[f["key"]] = parse_number(raw.get(f["key"]), min_value=0)
        except NumberError as e:
            errors[f["key"]] = [str(e)]
    cur, post = out.get("current_dp_kpa"), out.get("post_cleaning_dp_kpa")
    if cur is not None and post is not None and post > cur:
        errors["post_cleaning_dp_kpa"] = ["세정 후 기대 차압은 현재 차압보다 클 수 없습니다."]
    return out, errors


def _missing(keys):
    return msg("입력 필요: " + ", ".join(NAMES[k]["ko"] for k in keys),
               "Input required: " + ", ".join(NAMES[k]["en"] for k in keys))


def _effects(inc_in, output_mw, prefix_reason=None):
    """차압 증가(in H2O) → 출력 손실 % 범위, MW 범위, 열소비율 %, 배기온도 °C."""
    four = Decimal(4)
    low_pct = inc_in * R.GE_OUTPUT_LOSS_PCT_PER_4IN / four
    high_pct = inc_in * R.IST_OUTPUT_LOSS_PCT_PER_4IN / four
    res = {
        "output_loss_pct": {"low": val(_r(low_pct), "%", source="GE_GER3567H"),
                            "high": val(_r(high_pct), "%", source="IST_2000")},
        "heat_rate_increase_pct": val(_r(inc_in * R.GE_HEAT_RATE_PCT_PER_4IN / four), "%", source="GE_GER3567H"),
        "exhaust_temp_increase_c": val(_r(inc_in * R.GE_EXHAUST_TEMP_C_PER_4IN / four), "°C", source="GE_GER3567H"),
    }
    if output_mw is None:
        reason = _missing(["gt_output_mw"])
        res["output_loss_mw"] = {"low": none("MW", reason), "high": none("MW", reason)}
    else:
        mw = Decimal(str(output_mw))
        res["output_loss_mw"] = {"low": val(_r(mw * low_pct / 100), "MW", source="GE_GER3567H"),
                                 "high": val(_r(mw * high_pct / 100), "MW", source="IST_2000")}
    return res


def evaluate_reference(inputs):
    """반환: (basis, result). 같은 입력이면 같은 결과 (Decimal)."""
    cur, clean = inputs.get("current_dp_kpa"), inputs.get("clean_dp_kpa")
    post, output_mw = inputs.get("post_cleaning_dp_kpa"), inputs.get("gt_output_mw")
    result = {
        "notice": NOTICE,
        "trigger_reference_in_h2o": [float(R.CLEANING_TRIGGER_IN_H2O[0]), float(R.CLEANING_TRIGGER_IN_H2O[1])],
        "steam_turbine_loss": none("MW", NO_PUBLIC_BASIS),
        "stack_temp_increase": none("°C", NO_PUBLIC_BASIS),
        "sources": [R.cite("GE_GER3567H"), R.cite("IST_2000"), R.cite("POWER_2015")],
    }
    missing = [k for k in ("current_dp_kpa", "clean_dp_kpa") if inputs.get(k) is None]
    if missing:
        reason = _missing(missing)
        result.update({
            "dp_increase": {"kpa": none("kPa", reason), "in_h2o": none("in H2O", reason)},
            "trigger_position": None,
            "effects": None, "effects_reason": reason,
            "recovery": None, "recovery_reason": reason,
        })
        return REFERENCE_ESTIMATE, result

    inc_kpa = Decimal(str(cur)) - Decimal(str(clean))
    if inc_kpa < 0:
        reason = msg("현재 차압이 청정 기준보다 낮습니다. 같은 부하·측정 위치에서 잰 값인지 확인하세요.",
                     "Current ΔP is below the clean baseline. Check that both were measured at the same load and location.")
        result.update({
            "dp_increase": {"kpa": val(_r(inc_kpa), "kPa"), "in_h2o": val(_r(inc_kpa * 1000 / R.IN_H2O_PA), "in H2O")},
            "trigger_position": None, "effects": None, "effects_reason": reason, "recovery": None, "recovery_reason": reason,
        })
        return REFERENCE_ESTIMATE, result

    inc_in = inc_kpa * 1000 / R.IN_H2O_PA
    lo, hi = R.CLEANING_TRIGGER_IN_H2O
    position = "BELOW" if inc_in < lo else ("WITHIN" if inc_in <= hi else "ABOVE")
    result.update({
        "dp_increase": {"kpa": val(_r(inc_kpa), "kPa"), "in_h2o": val(_r(inc_in), "in H2O")},
        "trigger_position": position,  # 참고 기준(3~4 in H2O)과의 비교 — 판정 아님
        "effects": _effects(inc_in, output_mw),
        "effects_reason": None,
    })
    if post is None:
        result["recovery"], result["recovery_reason"] = None, _missing(["post_cleaning_dp_kpa"])
    else:
        rec_kpa = Decimal(str(cur)) - Decimal(str(post))
        rec_in = rec_kpa * 1000 / R.IN_H2O_PA
        result["recovery"] = {"dp_reduction": {"kpa": val(_r(rec_kpa), "kPa"), "in_h2o": val(_r(rec_in), "in H2O")},
                              **_effects(rec_in, output_mw)}
        result["recovery_reason"] = None
    return REFERENCE_ESTIMATE, result
