"""핀치·어프로치 계산.

- 포화온도: IAPWS-IF97 Eq. (31) (iapws.py, 공식 검증값으로 테스트)
- 정의 (IST 2000): 핀치 = 증발기 출구 가스 온도 − 포화온도, 어프로치 = 포화온도 − 절탄기 출구 급수 온도
- 비교 기준 두 가지를 출처와 함께 나란히 보여 줍니다 (판정 아님):
    DEMO 참고 범위 — 사용자 제공 프롬프트 11-4 (핀치 8~15 °C, 어프로치 5~12 °C)
    공개 문헌 — IST 2000 (핀치 10~30 °F = 5.56~16.67 °C, 어프로치 약 25 °F = 13.89 °C)
"""

from decimal import ROUND_HALF_UP, Decimal

from . import public_refs as R
from . import kit
from .base import msg, none, val
from .iapws import P_CRIT_MPA, STANDARD_ATM_MPA, saturation_temperature_k

VERSION = "IAPWS-IF97-EQ31-v1"
F_TO_C = Decimal(5) / Decimal(9)
DEMO_RANGES = {"pinch": [8, 15], "approach": [5, 12]}
NOTICE = msg(
    "포화온도는 국제 표준식(IAPWS-IF97)으로 계산했습니다. 범위 비교는 DEMO 참고 범위와 공개 문헌 일반값과의 비교이며, 이 설비의 설계 기준이나 허용 범위가 아닙니다.",
    "Saturation temperature uses the IAPWS-IF97 standard. Range comparisons are against DEMO reference ranges and general literature values, not this plant's design criteria.",
)


def _r(x, q="0.01"):
    return float(Decimal(str(x)).quantize(Decimal(q), rounding=ROUND_HALF_UP))


def _position(v, lo, hi):
    return None if v is None else ("BELOW" if v < lo else "WITHIN" if v <= hi else "ABOVE")


def evaluate_pinch(v):
    """핀치·어프로치 = 키트 pinch_section('HP', inp.sections.HP, D) (포화온도·핀치·어프로치·판정·문구).
    DEMO 참고 범위·공개 문헌(IST 2000) 비교는 이 앱의 기존 표시로 함께 둡니다 (판정 아님)."""
    basis = v.get("drumPressureBasis") or "gauge"
    ist = {"pinch": [_r(R.PINCH_RANGE_F[0] * F_TO_C), _r(R.PINCH_RANGE_F[1] * F_TO_C)],
           "approachTypical": _r(R.APPROACH_TYPICAL_F * F_TO_C)}
    hp = kit.to_kit_inputs(v)["sections"]["HP"]
    barg = (hp or {}).get("drum_barg")
    p_abs = None if barg is None else (barg + 1.01325) / 10
    out = {"notice": NOTICE, "basis": basis, "drumPressureAbsMPa": None if p_abs is None else _r(p_abs, "0.000001"),
           "ranges": {"demo": DEMO_RANGES, "ist2000": ist},
           "sources": [R.cite("IAPWS_IF97"), R.cite("IST_2000")],
           "steps": [
               {"id": "tsat", "label": msg("포화온도", "Saturation temperature"),
                "formula": "포화온도 = IAPWS-IF97 Region 4 (드럼 압력 + 1.01325 bar → 절대압)",
                "substituted": f"P_abs = {_r(p_abs, '0.0001')} MPa" if p_abs is not None else None},
               {"id": "pinch", "label": msg("핀치", "Pinch"), "formula": "핀치 = 증발기 출구 가스 온도 − 포화온도"},
               {"id": "approach", "label": msg("어프로치", "Approach"), "formula": "어프로치 = 포화온도 − 절탄기 출구 급수 온도"},
               {"id": "level", "label": msg("판정 (키트 DEMO)", "Check (kit DEMO)"),
                "formula": "어프로치 < 0 → 위험(스티밍 우려) / 핀치 > 설계 + 3 °C → 주의 / |어프로치 − 설계| > 3 °C → 주의 / 그 외 정상"},
           ]}
    try:
        sec = kit.calc.pinch_section("HP", hp, kit.D())
    except ValueError as e:
        reason = msg(str(e), "The evaporator outlet gas temperature cannot be below saturation. Check the inputs.")
        out.update(saturationTempC=none("°C", reason), pinch=none("°C", reason), approach=none("°C", reason),
                   position=None, designDiff=None, level="no_data", message=reason, design=None, warnings=[reason])
        return out
    out.update(level=sec["level"], message=msg(sec["message"], sec["message"]), design=sec["design"])
    if sec["current"] is None:
        reason = msg("평가에 필요한 운전 데이터가 없습니다 (체크리스트 B. HRSG 열역학/설계).", "Operating data needed (checklist B).")
        out.update(saturationTempC=none("°C", reason), pinch=none("°C", reason), approach=none("°C", reason),
                   position=None, designDiff=None, warnings=[])
        return out
    tsat, pinch, approach = sec["t_sat_c"], sec["current"]["pinch_c"], sec["current"]["approach_c"]
    out["saturationTempC"] = val(_r(tsat), "°C", rel="PUBLIC_REF")
    out["pinch"] = val(_r(pinch), "°C")
    out["approach"] = val(_r(approach), "°C")
    out["position"] = {
        "demo": {"pinch": _position(pinch, *DEMO_RANGES["pinch"]), "approach": _position(approach, *DEMO_RANGES["approach"])},
        "ist2000": {"pinch": _position(pinch, *ist["pinch"])},
    }
    pd, ad = sec["design"]["pinch_c"], sec["design"]["approach_c"]
    out["designDiff"] = {"pinch": val(_r(pinch - pd), "°C"), "approach": val(_r(approach - ad), "°C")}
    out["warnings"] = [] if sec["level"] == "normal" else [msg(sec["message"], sec["message"])]
    return out
