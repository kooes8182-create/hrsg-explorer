"""핀치·어프로치 참고 계산.

- 드럼 포화온도: IAPWS-IF97 Eq. (31) (calculators/iapws.py, 공식 검증값으로 확인)
- 정의 (IST 2000, 1.2 Common HRSG Terms):
    핀치 = 증발기 출구 가스 온도 − 드럼 압력의 포화온도
    어프로치 = 드럼 압력의 포화온도 − 절탄기 출구 급수 온도
- 문헌 설계 범위(IST 2000: 핀치 10~30 °F, 어프로치 약 25 °F)와 '참고 비교'만 하고 판정하지 않습니다.
  이 설비의 설계값·판정 기준값은 제공되지 않았습니다.
"""

from decimal import ROUND_HALF_UP, Decimal

from . import public_refs as R
from .base import NumberError, msg, none, parse_number, val
from .iapws import P_CRIT_MPA, P_MIN_MPA, STANDARD_ATM_MPA, saturation_temperature_k

REFERENCE_ESTIMATE = "REFERENCE_ESTIMATE"
VERSION = "IAPWS-IF97-EQ31+IST-2000-v1"
DATA_SOURCE = msg("IAPWS-IF97 포화온도 식 + IST 2000 정의·설계 범위 — 참고 계산",
                  "IAPWS-IF97 saturation equation + IST 2000 definitions/ranges — reference calculation")
FIELDS = [
    {"key": "drum_pressure", "ko": "드럼 압력", "en": "Drum pressure", "unit": "MPa"},
    {"key": "eco_outlet_water_temp", "ko": "절탄기 출구 급수 온도", "en": "Economizer outlet water temperature", "unit": "°C"},
    {"key": "evap_outlet_gas_temp", "ko": "증발기 출구 가스 온도", "en": "Evaporator outlet gas temperature", "unit": "°C"},
]
BASIS_CHOICES = ("gauge", "absolute")
F_TO_C = Decimal(5) / Decimal(9)
NOTICE = msg(
    "포화온도는 국제 표준 식(IAPWS-IF97)으로 계산했습니다. 범위 비교는 HRSG 제조사 자료(IST 2000)의 일반 설계 범위와의 참고 비교이며, 이 설비의 판정 기준이 아닙니다.",
    "Saturation temperature uses the IAPWS-IF97 standard equation. The range comparison is against general design ranges from a vendor source (IST 2000), not criteria for this plant.",
)


def _r(x, q="0.01"):
    return float(Decimal(str(x)).quantize(Decimal(q), rounding=ROUND_HALF_UP))


def clean_pinch(raw):
    if not isinstance(raw, dict):
        return None, {"pinch_inputs": ["객체(JSON object) 형식이어야 합니다."]}
    errors, out = {}, {}
    allowed = {f["key"] for f in FIELDS} | {"drum_pressure_basis"}
    for key in raw:
        if key not in allowed:
            errors[key] = ["알 수 없는 항목입니다."]
    for f in FIELDS:
        try:
            out[f["key"]] = parse_number(raw.get(f["key"]))
        except NumberError as e:
            errors[f["key"]] = [str(e)]
    basis = raw.get("drum_pressure_basis") or None
    if basis is not None and basis not in BASIS_CHOICES:
        errors["drum_pressure_basis"] = ["게이지 또는 절대압력 중에서 고르세요."]
    out["drum_pressure_basis"] = basis
    return out, errors


def _reason(missing_labels):
    return msg("입력 필요: " + ", ".join(m["ko"] for m in missing_labels),
               "Input required: " + ", ".join(m["en"] for m in missing_labels))


def evaluate_pinch(inputs):
    """반환: (basis, result)."""
    p, basis = inputs.get("drum_pressure"), inputs.get("drum_pressure_basis")
    water, gas = inputs.get("eco_outlet_water_temp"), inputs.get("evap_outlet_gas_temp")
    ranges = {
        "pinch_c": [_r(R.PINCH_RANGE_F[0] * F_TO_C), _r(R.PINCH_RANGE_F[1] * F_TO_C)],
        "approach_typical_c": _r(R.APPROACH_TYPICAL_F * F_TO_C),
    }
    result = {"notice": NOTICE, "reference_ranges": ranges,
              "sources": [R.cite("IAPWS_IF97"), R.cite("IST_2000")]}

    # 포화온도
    missing = []
    if p is None:
        missing.append({"ko": "드럼 압력", "en": "drum pressure"})
    if p is not None and basis is None:
        missing.append({"ko": "드럼 압력 기준(게이지/절대)", "en": "drum pressure basis (gauge/absolute)"})
    tsat = None
    if missing:
        result["saturation_temp"] = none("°C", _reason(missing))
    else:
        p_abs = p + STANDARD_ATM_MPA if basis == "gauge" else p
        try:
            tsat = saturation_temperature_k(p_abs) - 273.15
            result["saturation_temp"] = val(_r(tsat), "°C")
            result["drum_pressure_abs_mpa"] = _r(p_abs, "0.000001")
        except ValueError:
            result["saturation_temp"] = none("°C", msg(
                f"드럼 절대압력은 {P_MIN_MPA * 1e6:.3f} Pa ~ {P_CRIT_MPA} MPa 범위여야 합니다 (IAPWS-IF97 적용 범위).",
                f"Absolute drum pressure must be between {P_MIN_MPA * 1e6:.3f} Pa and {P_CRIT_MPA} MPa (IAPWS-IF97 range)."))

    def temperature_difference(measured, label, sign):
        """sign=+1: 측정값 − 포화온도 (핀치), sign=−1: 포화온도 − 측정값 (어프로치)."""
        lacking = list(missing) + ([label] if measured is None else [])
        if lacking:
            return none("°C", _reason(lacking))
        if tsat is None:  # 압력이 적용 범위 밖
            return none("°C", result["saturation_temp"]["reason"])
        return val(_r(sign * (measured - tsat)), "°C")

    result["pinch"] = temperature_difference(gas, {"ko": "증발기 출구 가스 온도", "en": "evaporator outlet gas temperature"}, +1)
    result["approach"] = temperature_difference(water, {"ko": "절탄기 출구 급수 온도", "en": "economizer outlet water temperature"}, -1)

    lo, hi = ranges["pinch_c"]
    pv, av = result["pinch"]["value"], result["approach"]["value"]
    result["pinch_position"] = None if pv is None else ("BELOW" if pv < lo else "WITHIN" if pv <= hi else "ABOVE")
    result["approach_steaming_note"] = None if av is None or av > 0 else msg(
        "어프로치가 0 이하입니다. IST 자료는 절탄기 안에서 증기가 생기는 것(steaming)을 피해야 한다고 설명합니다. 입력값과 측정 조건을 확인하세요.",
        "Approach is zero or below. The IST source says steaming in the economizer should be avoided. Check the inputs and conditions.")
    return REFERENCE_ESTIMATE, result
