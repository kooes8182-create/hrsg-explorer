"""HRSG 계산기·체크리스트 키트(팀 1, common-0.2) 연결.

- 키트 폴더(HRSG/hrsg_calc_kit_team1)의 calc.py · checklist.py · data/*.json 을 고치지 않고 그대로 불러 씁니다.
- 화면 상태(이 앱의 입력 필드 이름) → 키트 입력(inp) 변환은 이 파일의 어댑터 함수 하나(to_kit_inputs)에서만 합니다.
  압력은 키 이름 끝에 단위를 붙여 넘기고(gt_bp_mmh2o, hrsg_dp_kpa …) 직접 환산하지 않습니다.
- 체크리스트 진행 상태는 DB 의 상태 코드(NOT_ENTERED …)를 키트 영문 키(not_entered …)로 바꿔(to_kit_progress) 키트 함수에 넘깁니다.
- 모든 수치는 키트의 DEMO 값입니다.
"""

import importlib.util
import sys
from functools import lru_cache

from django.conf import settings


def _load(name):
    path = settings.HRSG_KIT_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"hrsg_kit_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    keep, sys.dont_write_bytecode = sys.dont_write_bytecode, True  # 키트 폴더에 __pycache__ 를 만들지 않음 (폴더 구조 유지)
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = keep
    return mod


calc = _load("calc")
checklist = _load("checklist")


@lru_cache(maxsize=1)
def D():
    """data/calculator.json (= JS 의 D). 호출한 쪽에서 바꾸지 않습니다."""
    return calc.load_calculator_data()


@lru_cache(maxsize=1)
def C():
    """data/checklist.json (= JS 의 C)."""
    return checklist.load_checklist_data()


# ---------------------------------------------------------------- 이름 대응 (화면 ↔ 키트)
# 세정 공법: 키트 data 의 id → 이 앱 입력 필드 이름에 쓰는 키 (기존 케이스에 저장된 값의 이름을 유지하려고 3개는 그대로 둠)
METHOD_KEY = {"mechanical": "Mechanical", "water": "HighPressureWater", "dryice": "DryIce", "chemical": "Chemical"}
METHOD_EN = {"mechanical": "Mechanical cleaning", "water": "High-pressure water", "dryice": "Dry-ice blasting", "chemical": "Chemical cleaning"}


def method_key(mid):
    return METHOD_KEY.get(mid, mid)


def class_choice(cid):
    """GT 등급 id('F') → 화면 선택지 글자('F-Class')"""
    return f"{cid}-Class"


def class_id(choice):
    """화면 선택지 글자('F-Class') → 키트 gt_class('F'). 모르는 값은 그대로 넘겨 validate_inputs 가 오류로 알리게 합니다."""
    s = str(choice or "")
    return s[:-6] if s.endswith("-Class") else s


def _put(obj, key, v):
    """빈 값은 넣지 않습니다 (키트 기본값 사용 · 압력 키에 None 을 넣으면 '숫자가 아님' 오류)."""
    if v is not None and v != "":
        obj[key] = v


def to_kit_inputs(v):
    """화면 상태(입력 필드 값 dict) → 키트 입력 inp. README 「팀 1 화면 연결표」와 같은 대응입니다.

    화면에 없는 키트 입력은 넣지 않습니다(키트가 GT 등급 값·data 값을 씀). 단, 공법별 회수율(recovery_ratio)은
    화면 입력란이 없어 data/calculator.json 의 값을 그대로 붙입니다.
    """
    eq = {"gt_class": class_id(v.get("turbineModel"))}
    _put(eq, "rated_gt_mw", v.get("capacityMW"))
    _put(eq, "load_pct", v.get("loadFactor"))
    _put(eq, "gt_bp_mmh2o", v.get("currentBP"))
    _put(eq, "base_gt_bp_mmh2o", v.get("baselineBP"))
    _put(eq, "stack_c", v.get("stackTempC"))
    _put(eq, "base_stack_c", v.get("baselineStackTempC"))
    _put(eq, "hrsg_dp_kpa", v.get("hrsgDpKpa"))
    _put(eq, "ambient_c", v.get("ambientTempC"))

    ec = {}
    _put(ec, "monthly_hours", v.get("operatingHoursMonth"))
    _put(ec, "price_krw_per_kwh", v.get("smpWonPerKWh"))
    _put(ec, "target_recovery_mw", v.get("targetRecoveryMW"))

    methods = []
    for m in D()["methods"]:
        k = method_key(m["id"])
        row = {"id": m["id"], "name": m["name"]}
        _put(row, "cost_krw", v.get(f"cost{k}"))
        _put(row, "outage_days", v.get(f"outageDays{k}"))
        _put(row, "indirect_krw", v.get(f"indirectCost{k}"))
        _put(row, "recovery_mw", v.get(f"recoveryMW{k}"))
        _put(row, "recovery_ratio", m.get("recovery_ratio"))
        methods.append(row)

    hp = {}
    drum = v.get("drumPressureBar")
    if drum is not None:
        # 키트는 게이지압(barg)만 받습니다. 화면에서 '절대압' 기준을 고른 경우에만 표준 대기압을 뺍니다.
        _put(hp, "drum_barg", drum if (v.get("drumPressureBasis") or "gauge") == "gauge" else drum - 1.01325)
    _put(hp, "evap_outlet_gas_c", v.get("evaOutletGasTempC"))
    _put(hp, "econ_outlet_water_c", v.get("ecoOutletWaterTempC"))
    _put(hp, "pinch_design_c", v.get("pinchDesignC"))
    _put(hp, "approach_design_c", v.get("approachDesignC"))
    return {"equipment": eq, "economics": ec, "methods": methods, "sections": {"HP": hp or None}}


def screen_defaults():
    """「기본값 초기화」 = defaultInputs(D) 를 화면 필드 값으로. 압력 단위 변환은 키트 함수(from_mbar)를 씁니다."""
    d = D()
    k = calc.default_inputs(d)
    eq, ec, hp = k["equipment"], k["economics"], k["sections"]["HP"]
    cls = next(g for g in d["gt_classes"] if g["id"] == eq["gt_class"])
    ind = cls["indicators"]
    r1 = lambda x: round(x, 1)  # noqa: E731 — mmH₂O 는 소수 1자리로 표시·저장
    out = {
        "turbineModel": class_choice(eq["gt_class"]), "capacityMW": cls["rated_gt_mw"], "loadFactor": eq["load_pct"],
        "currentBP": r1(calc.from_mbar(eq["gt_bp_mbar"], "mmh2o")),
        "baselineBP": r1(calc.from_mbar(ind["gt_bp_mbar"]["design"], "mmh2o")),
        "stackTempC": eq["stack_c"], "baselineStackTempC": ind["stack_c"]["design"],
        "operatingHoursMonth": ec["monthly_hours"], "ambientTempC": eq["ambient_c"],
        "hrsgDpKpa": calc.from_mbar(eq["hrsg_dp_mbar"], "kpa"),
        "designHrsgDpKpa": calc.from_mbar(ind["hrsg_dp_mbar"]["design"], "kpa"),  # 화면 입력 아님 (청정 기준 차압 기본값용)
        "drumPressureBar": hp["drum_barg"], "drumPressureBasis": "gauge",
        "ecoOutletWaterTempC": hp["econ_outlet_water_c"], "evaOutletGasTempC": hp["evap_outlet_gas_c"],
        "smpWonPerKWh": ec["price_krw_per_kwh"], "targetRecoveryMW": ec["target_recovery_mw"],
    }
    for m in k["methods"]:
        mk = method_key(m["id"])
        out.update({f"cost{mk}": m["cost_krw"], f"outageDays{mk}": m["outage_days"], f"indirectCost{mk}": m["indirect_krw"],
                    f"recoveryMW{mk}": m["recovery_mw"]})
    return out


# ---------------------------------------------------------------- 체크리스트 상태 (DB 코드 ↔ 키트 키)
SUPPLY_TO_KIT = {"NOT_ENTERED": "not_entered", "REQUEST_NEEDED": "requested", "RECEIVED": "received",
                 "NEEDS_CHECK": "verify_needed", "NA": "na"}
VERIFY_TO_KIT = {"UNVERIFIED": "unverified", "IN_PROGRESS": "in_progress", "VERIFIED": "verified", "FAILED": "failed"}
SUPPLY_FROM_KIT = {v: k for k, v in SUPPLY_TO_KIT.items()}
VERIFY_FROM_KIT = {v: k for k, v in VERIFY_TO_KIT.items()}


def to_kit_progress(rows):
    """DB 체크리스트 행 → 키트 progress { "A-01": { supply, verify, reviewed, value, note } }"""
    return {r.item_id: {"supply": SUPPLY_TO_KIT.get(r.supply_status, r.supply_status),
                        "verify": VERIFY_TO_KIT.get(r.verify_status, r.verify_status),
                        "reviewed": bool(r.reviewed), "value": r.value, "note": r.memo or None}
            for r in rows}
