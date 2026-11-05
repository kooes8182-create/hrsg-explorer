"""계산 입력 규격 (시뮬레이션·계산기·세정 전후가 같은 입력을 공유).

- 기본값은 사용자 제공 구현 프롬프트 11-1 의 DEMO 값입니다. 프롬프트에 기본값이 없는 항목은 비워 둡니다(null).
- 기본값이 있는 항목은 필수(빈 값 차단). 선택 항목이 비면 그 값이 필요한 결과만 '산출 불가 + 이유'.
- 저장 단위: 배압 mmH₂O, HRSG 차압 kPa(공개 문헌 사례 단위), 드럼 압력 bar, 온도 °C, 금액 원.
"""

import hashlib
import json
import math

from . import kit
from .base import msg

# 월간 가동시간: 프롬프트에 기본값이 없어 '월 30일 × 24 h = 720 h' 로 둡니다 (손익분기 '월 30일' DEMO 가정과 같은 전제).
HOURS_DEMO_NOTE = msg("월 30일 × 24 h 가정 (DEMO)", "30 days × 24 h assumption (DEMO)")

# 세정 공법·GT 등급·기본값은 키트 data/calculator.json 에서 읽습니다 (engine/kit.py). 공법 4개: 기계식·고압수·드라이아이스·화학
METHODS = [{"key": kit.method_key(m["id"]), "kit_id": m["id"], "ko": m["name"], "en": kit.METHOD_EN.get(m["id"], m["name"])}
           for m in kit.D()["methods"]]
_KD = kit.screen_defaults()

GROUPS = {
    "equipment": msg("설비 및 운전", "Equipment & operation"),
    "thermo": msg("열역학", "Thermodynamics"),
    "economics": msg("경제성", "Economics"),
    "methods": msg("세정 공법", "Cleaning methods"),
}


def _f(key, group, ko, en, unit, lo, hi, default=None, note=None, kind="number", choices=None, method=None, required=None):
    return {"key": key, "group": group, "label": msg(ko, en), "unit": unit, "min": lo, "max": hi,
            "default": default, "required": default is not None if required is None else required, "kind": kind, "choices": choices,
            "note": note, "method": method}


FIELDS = [
    _f("turbineModel", "equipment", "가스터빈 등급", "Gas turbine class", None, None, None, _KD["turbineModel"],
       kind="choice", choices=[kit.class_choice(g["id"]) for g in kit.D()["gt_classes"]]),
    _f("capacityMW", "equipment", "정격 용량", "Rated capacity", "MW", 50, 600, _KD["capacityMW"],
       note=msg("GT 정격. ST 정격은 GT 등급 값 사용 (키트)", "GT rating. ST rating uses the GT class value (kit)")),
    _f("loadFactor", "equipment", "운전 부하율", "Load factor", "%", 30, 105, _KD["loadFactor"]),
    _f("currentBP", "equipment", "현재 배압", "Current back pressure", "mmH2O", 0, 1200, _KD["currentBP"]),
    _f("baselineBP", "equipment", "기준 배압", "Baseline back pressure", "mmH2O", 0, 800, _KD["baselineBP"]),
    _f("stackTempC", "equipment", "스택 온도", "Stack temperature", "°C", 60, 250, _KD["stackTempC"]),
    _f("baselineStackTempC", "equipment", "기준 스택 온도", "Baseline stack temperature", "°C", 60, 250, _KD["baselineStackTempC"]),
    _f("operatingHoursMonth", "equipment", "월간 가동시간", "Monthly operating hours", "h", 0, 744, _KD["operatingHoursMonth"],
       note=msg("연간 운전 시간은 ×12 로 계산 (키트)", "Annual hours = ×12 (kit)")),
    _f("ambientTempC", "equipment", "외기 온도", "Ambient temperature", "°C", -30, 50, _KD["ambientTempC"]),
    _f("hrsgDpKpa", "equipment", "HRSG 가스측 차압 (현재)", "HRSG gas-side ΔP (current)", "kPa", 0, 10, _KD["hrsgDpKpa"],
       note=msg("출력 손실·세정 필요도 계산에 쓰임 (키트)", "Used for output loss and the cleaning index (kit)")),
    # 공개 문헌 추정(차압 증가분)용 청정·세정 후 기대 차압: 기본값 = 키트 GT 등급의 설계 HRSG 차압 (비워도 저장됨)
    _f("hrsgDpCleanKpa", "equipment", "HRSG 차압 (신규·세정 직후 기준)", "HRSG ΔP (new & clean)", "kPa", 0, 10, _KD["designHrsgDpKpa"], required=False),
    _f("hrsgDpPostKpa", "equipment", "HRSG 차압 (세정 후 기대)", "HRSG ΔP (expected after cleaning)", "kPa", 0, 10, _KD["designHrsgDpKpa"], required=False),
    _f("drumPressureBar", "thermo", "HP 드럼 압력", "HP drum pressure", "bar", 10, 200, _KD["drumPressureBar"]),
    _f("drumPressureBasis", "thermo", "드럼 압력 기준", "Drum pressure basis", None, None, None, _KD["drumPressureBasis"],
       kind="choice", choices=["absolute", "gauge"]),
    _f("ecoOutletWaterTempC", "thermo", "절탄기 출구 급수 온도", "Economizer outlet water temp", "°C", 50, 370, _KD["ecoOutletWaterTempC"]),
    _f("evaOutletGasTempC", "thermo", "증발기 출구 가스 온도", "Evaporator outlet gas temp", "°C", 100, 600, _KD["evaOutletGasTempC"]),
    _f("pinchDesignC", "thermo", "핀치 설계값", "Pinch design value", "°C", 0, 100,
       note=msg("비우면 키트 설계값 사용", "If empty, the kit design value is used")),
    _f("approachDesignC", "thermo", "어프로치 설계값", "Approach design value", "°C", 0, 100,
       note=msg("비우면 키트 설계값 사용", "If empty, the kit design value is used")),
    _f("smpWonPerKWh", "economics", "SMP", "SMP", "원/kWh", 50, 500, _KD["smpWonPerKWh"]),
    _f("targetRecoveryMW", "economics", "목표 회수 출력", "Target recovered output", "MW", 0, 30, _KD["targetRecoveryMW"],
       note=msg("공법 회수 출력·회수율이 모두 없을 때 사용", "Used when a method has neither recovered output nor ratio")),
]

# 공법별 입력은 비워도 저장됩니다 (비면 그 공법만 「산출 불가 — 입력 필요: …」).
for m in METHODS:
    k = m["key"]
    FIELDS += [
        _f(f"cost{k}", "methods", f"{m['ko']} 비용", f"{m['en']} cost", "원", 0, 1_000_000_000, _KD[f"cost{k}"], method=k, required=False),
        _f(f"outageDays{k}", "methods", f"{m['ko']} 정지일수", f"{m['en']} outage days", "일", 0, 30, _KD[f"outageDays{k}"], method=k, required=False),
        _f(f"indirectCost{k}", "methods", f"{m['ko']} 간접 비용", f"{m['en']} indirect cost", "원", 0, 1_000_000_000,
           _KD[f"indirectCost{k}"], method=k, required=False),
        _f(f"recoveryMW{k}", "methods", f"{m['ko']} 회수 출력", f"{m['en']} recovered output", "MW", 0, 30, _KD[f"recoveryMW{k}"], method=k, required=False,
           note=msg("비우면 키트 회수율(DEMO)로 계산 → 그것도 없으면 목표 회수 출력", "If empty, the kit recovery ratio (DEMO) is used, then the target output")),
    ]

BY_KEY = {f["key"]: f for f in FIELDS}
DEFAULTS = {f["key"]: f["default"] for f in FIELDS}

# ---------------------------------------------------------------- DEMO 시나리오
# 상태는 키트의 지표 판정입니다: GT 배압·HRSG 차압·스택 온도가 GT 등급의 DEMO 주의·위험값(data/calculator.json) 이상이면
# 주의·위험, 종합 = 가장 나쁜 것. 시나리오 값은 키트 F 등급 지표값(mbar)에서 만들고(단위 변환은 키트 from_mbar),
# 「오염 진행」은 키트 기본값(예시 운전 상태)과 같습니다. 시나리오마다 표시하는 상태도 키트로 계산합니다.
STATUS = {
    "NORMAL": msg("정상", "Normal"),
    "ALARM": msg("주의", "Caution"),
    "TRIP": msg("위험", "Danger"),
    "UNKNOWN": msg("미확인", "Unknown"),
}
LEVEL_TO_STATUS = {"normal": "NORMAL", "caution": "ALARM", "danger": "TRIP"}


def _scenario_values():
    ind = next(g for g in kit.D()["gt_classes"] if g["id"] == kit.class_id(DEFAULTS["turbineModel"]))["indicators"]
    bp = lambda mbar: round(kit.calc.from_mbar(mbar, "mmh2o"), 1)  # noqa: E731
    dp = lambda mbar: kit.calc.from_mbar(mbar, "kpa")  # noqa: E731
    common = {}
    return {
        # 정상: 세 지표 모두 주의값 아래 (HRSG 차압 설계 +1 mbar, 스택 설계 +2 °C)
        "NORMAL": {**common, "hrsgDpKpa": dp(ind["hrsg_dp_mbar"]["design"] + 1), "stackTempC": ind["stack_c"]["design"] + 2},
        # 오염 진행: 키트 기본값 그대로
        "ALARM": {**common},
        # 세정 필요: HRSG 차압·스택 온도가 위험값 이상, GT 배압은 주의값
        "TRIP": {**common, "currentBP": bp(ind["gt_bp_mbar"]["caution"]), "hrsgDpKpa": dp(ind["hrsg_dp_mbar"]["danger"] + 1.5),
                 "stackTempC": ind["stack_c"]["danger"] + 2},
    }


_SV = _scenario_values()


def _kit_status(values):
    return LEVEL_TO_STATUS[kit.calc.calculate(kit.to_kit_inputs(values), kit.D())["overall_level"]]


SCENARIOS = {
    "NORMAL": {"label": msg("정상 운전", "Normal operation"), "values": _SV["NORMAL"]},
    "ALARM": {"label": msg("오염 진행", "Fouling building up"), "values": _SV["ALARM"]},
    "TRIP": {"label": msg("세정 필요", "Cleaning needed"), "values": _SV["TRIP"]},
}
for _s in SCENARIOS.values():
    _s["status"] = _kit_status({**DEFAULTS, **_s["values"]})
SCENARIO_NOTE = msg(
    "시나리오 값과 상태는 시연용 가상 값입니다. 상태는 키트의 DEMO 주의·위험값 기준이며 실제 설비의 운전 한계나 판정 기준이 아닙니다.",
    "Scenario values and statuses are virtual demo values; statuses use the kit's DEMO caution/danger values, not real operating limits.",
)


def scenario_inputs(sid):
    return {**DEFAULTS, **SCENARIOS[sid]["values"]}


def match_scenario(values):
    """값이 시나리오 하나와 모두 같으면 그 시나리오, 아니면 CUSTOM (키트 기본값 = 「오염 진행」)."""
    return next((k for k in SCENARIOS if effective_scenario(values, k) == k), "CUSTOM")


def effective_scenario(values, claimed):
    """주장한 시나리오의 값과 하나라도 다르면 CUSTOM."""
    if claimed in SCENARIOS and all(_same(values.get(k), v) for k, v in scenario_inputs(claimed).items()):
        return claimed
    return "CUSTOM"


def _same(a, b):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    return float(a) == float(b)


# ---------------------------------------------------------------- 검증
def _num(raw, field):
    """숫자 하나 검증. {"value": .., "unit": ..} 형식이면 단위가 저장 단위와 같아야 합니다."""
    if isinstance(raw, dict):
        unit = raw.get("unit")
        if unit is not None and unit != field["unit"]:
            raise ValueError(msg(f"단위 불일치: {field['unit']} 로 입력하세요 (받은 단위 {unit}).",
                                 f"Unit mismatch: enter in {field['unit']} (got {unit})."))
        raw = raw.get("value")
    if isinstance(raw, str):
        raw = raw.strip().replace(",", "")
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        raise ValueError(msg("숫자를 입력하세요.", "Enter a number."))
    try:
        v = float(raw)
    except (TypeError, ValueError):
        raise ValueError(msg("숫자를 입력하세요.", "Enter a number."))
    if not math.isfinite(v):
        raise ValueError(msg("숫자를 입력하세요 (NaN·무한대 불가).", "Enter a finite number (no NaN/infinity)."))
    lo, hi = field["min"], field["max"]
    if v < lo or v > hi:
        raise ValueError(msg(f"허용 범위 {lo:g} ~ {hi:g} {field['unit']} 를 벗어났습니다.",
                             f"Out of the allowed range {lo:g} – {hi:g} {field['unit']}."))
    return int(v) if v.is_integer() else v


def clean_inputs(raw):
    """→ (values, errors, warnings). errors: {key: {ko, en}}. 모르는 항목은 오류."""
    errors, warnings, out = {}, [], {}
    if not isinstance(raw, dict):
        return None, {"inputs": msg("객체(JSON object) 형식이어야 합니다.", "Must be a JSON object.")}, []
    for key in raw:
        if key not in BY_KEY:
            errors[key] = msg("알 수 없는 항목입니다.", "Unknown field.")
    for f in FIELDS:
        v = raw.get(f["key"])
        if f["kind"] == "choice":
            v = v if v not in ("", None) else None
            if v is not None and v not in f["choices"]:
                errors[f["key"]] = msg("목록에 있는 값을 고르세요.", "Choose a listed value.")
        else:
            try:
                v = _num(v, f)
            except ValueError as e:
                errors[f["key"]] = e.args[0]
                continue
        if v is None and f["required"]:
            errors[f["key"]] = msg("필수 입력입니다.", "Required.")
        out[f["key"]] = v
    cur, base = out.get("currentBP"), out.get("baselineBP")
    if "currentBP" not in errors and "baselineBP" not in errors and cur is not None and base is not None and cur < base:
        warnings.append({"key": "currentBP", "message": msg(
            "현재 배압이 기준 배압보다 낮습니다. 초과 배압은 0 으로 계산하며 음수 손실은 만들지 않습니다.",
            "Current back pressure is below the baseline. Excess back pressure is treated as 0; no negative loss is produced.")})
    post, dp = out.get("hrsgDpPostKpa"), out.get("hrsgDpKpa")
    if post is not None and dp is not None and post > dp:
        errors["hrsgDpPostKpa"] = msg("세정 후 기대 차압은 현재 차압보다 클 수 없습니다.",
                                      "Expected ΔP after cleaning cannot exceed the current ΔP.")
    return out, errors, warnings


def inputs_hash(mode, values):
    """결과 유효성 판단용. 입력·모드가 하나라도 바뀌면 다른 값."""
    blob = json.dumps({"mode": mode, "values": values}, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def value_sources(mode, scenario, values):
    """값마다 출처: DEMO(DEMO 기본값·시나리오 값과 같음) / USER_INPUT / null(빈 값)."""
    preset = scenario_inputs(scenario) if scenario in SCENARIOS else DEFAULTS
    out = {}
    for f in FIELDS:
        v = values.get(f["key"])
        if v is None:
            out[f["key"]] = None
        elif _same(v, preset.get(f["key"])) or _same(v, DEFAULTS.get(f["key"])):
            out[f["key"]] = "DEMO"
        else:
            out[f["key"]] = "USER_INPUT"
    return out


def schema():
    return {"fields": FIELDS, "groups": GROUPS, "methods": METHODS,
            "scenarios": [{"id": k, "label": s["label"], "status": s["status"], "status_label": STATUS[s["status"]],
                           "values": scenario_inputs(k)} for k, s in SCENARIOS.items()],
            "scenario_note": SCENARIO_NOTE, "defaults": DEFAULTS}
