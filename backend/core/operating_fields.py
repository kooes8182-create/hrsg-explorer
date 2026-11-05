"""성능 평가 운전 입력값 항목 (05 §2.2 의 운전값 key 와 같음).

값이 없으면 None 으로 저장합니다. 빈 칸을 0으로 바꾸지 않습니다.
"""

from calculators.base import NumberError, parse_number

OPERATING_FIELDS = [
    {"key": "gt_model", "ko": "가스터빈 모델명", "en": "Gas turbine model", "unit": "—", "type": "text"},
    {"key": "gt_load", "ko": "운전 부하", "en": "Operating load", "unit": "%", "type": "number"},
    {"key": "ambient_temp", "ko": "대기 온도", "en": "Ambient temperature", "unit": "°C", "type": "number"},
    {"key": "gt_exhaust_temp", "ko": "가스터빈 배기가스 온도", "en": "GT exhaust gas temperature", "unit": "°C", "type": "number"},
    {"key": "gt_exhaust_flow", "ko": "가스터빈 배기가스 유량", "en": "GT exhaust gas flow", "unit": "kg/s", "type": "number"},
    {"key": "gt_back_pressure", "ko": "가스터빈 배압", "en": "GT back pressure", "unit": "kPa", "type": "number"},
    {"key": "hrsg_dp", "ko": "HRSG 가스측 차압 (ΔP)", "en": "HRSG gas-side ΔP", "unit": "kPa", "type": "number"},
    {"key": "stack_temp", "ko": "굴뚝(스택) 온도", "en": "Stack temperature", "unit": "°C", "type": "number"},
    {"key": "steam_flow", "ko": "주증기 유량", "en": "Main steam flow", "unit": "t/h", "type": "number"},
]
FIELD_BY_KEY = {f["key"]: f for f in OPERATING_FIELDS}


def empty_operating_values():
    return {f["key"]: None for f in OPERATING_FIELDS}


def clean_operating_values(raw):
    """입력 dict 를 검증해 (값 dict, 오류 dict) 를 돌려줍니다. 빠진 key 는 None 입니다."""
    if not isinstance(raw, dict):
        return None, {"operating_values": ["객체(JSON object) 형식이어야 합니다."]}

    errors = {}
    for key in raw:
        if key not in FIELD_BY_KEY:
            errors[key] = ["알 수 없는 항목입니다."]

    values = empty_operating_values()
    for field in OPERATING_FIELDS:
        key = field["key"]
        v = raw.get(key)
        if isinstance(v, str):
            v = v.strip()
        if v is None or v == "":
            values[key] = None
            continue
        if field["type"] == "text":
            if not isinstance(v, str) or len(v) > 100:
                errors[key] = ["100자 이하 글자로 입력하세요."]
            else:
                values[key] = v
            continue
        try:
            values[key] = parse_number(v)
        except NumberError as e:
            errors[key] = [str(e)]
    return values, errors
