"""계산 결과 공통 형식과 숫자 검증.

결과 값: {"value": 숫자|문자|None, "unit": 단위, "reason": None | {"ko": ..., "en": ...}}
  - value 가 None 이면 reason 은 반드시 있습니다(한/영). 입력 누락을 0으로 바꾸지 않습니다.
"""

import math

# basis: 결과의 근거 종류 (specs/05 §0)
DEMO_FIXED = "DEMO_FIXED"
USER_ASSUMPTION = "USER_ASSUMPTION"
UNAVAILABLE = "UNAVAILABLE"
REEVALUATION_REQUIRED = "REEVALUATION_REQUIRED"


def msg(ko, en):
    return {"ko": ko, "en": en}


def val(value, unit, reason=None, **extra):
    return {"value": value, "unit": unit, "reason": reason, **extra}


def none(unit, reason, **extra):
    assert reason, "null 결과에는 사유가 필요합니다"
    return {"value": None, "unit": unit, "reason": reason, **extra}


class NumberError(ValueError):
    pass


def parse_number(v, min_value=None):
    """사용자 입력 → 숫자 | None(빈 칸). 숫자가 아니거나 범위를 벗어나면 NumberError."""
    if isinstance(v, str):
        v = v.strip().replace(",", "")
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise NumberError("숫자를 입력하세요.")
    try:
        num = float(v)
    except (TypeError, ValueError):
        raise NumberError("숫자를 입력하세요.")
    if not math.isfinite(num):
        raise NumberError("숫자를 입력하세요.")
    if min_value is not None and num < min_value:
        raise NumberError(f"{min_value} 이상이어야 합니다.")
    return int(num) if num.is_integer() and not isinstance(v, float) else num


def numbers_equal(a, b):
    """시나리오 값과 현재 입력 비교 (3 과 "3.0" 은 같은 값)."""
    if a is None or b is None:
        return a is None and b is None
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a).strip() == str(b).strip()
