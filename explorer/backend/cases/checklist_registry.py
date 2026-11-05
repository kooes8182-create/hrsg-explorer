"""통합 체크리스트 항목 레지스트리 (하나의 데이터 모델).

[2026-11-05 키트 연결] 항목 49개·카테고리 5개·필수/우선순위·수급/검증 상태 글자는 HRSG 계산기·체크리스트 키트
(data/checklist.json, common-0.2)에서 읽습니다. 아래의 기존 정의(_LEGACY)는 영문 이름·데이터 유형·출처·기존 키처럼
키트에 없는 보조 정보에만 씁니다. 새 9개 항목(A-06, B-10~B-13, C-09, D-01~D-03)은 영문 이름이 없어 한국어를 그대로 씁니다.

- A·B·C (22개): 사용자 제공 구현 프롬프트 9-1 의 기본 항목.
- E (확장): 기존 HRSG 앱 체크리스트(34개, 7범주) 중 A·B·C 와 겹치지 않는 항목. legacy 키를 그대로 기록합니다.
  겹치는 항목은 A·B·C 쪽 하나로 합쳤습니다 (legacy 에 원래 키 목록).
- 필수 여부·우선순위는 확정 기준이 없어 '임시 기준'입니다: 계산 입력과 연결된 항목 = 필수·높음.
- 필요 이유는 이 앱의 계산·검토에서 그 값을 어디에 쓰는지 설명합니다.
"""

from engine.base import msg

PROVISIONAL = True

from engine import kit

_CAT_EN = {"A": "Gas turbine / operation", "B": "HRSG thermodynamics / design", "C": "Cleaning / maintenance", "D": "Economics", "E": "Extended"}
CATEGORIES = [{"code": c["id"], "label": msg(c["name"].split(". ", 1)[-1], _CAT_EN.get(c["id"], c["name"]))} for c in kit.C()["categories"]]

SOURCE_PROMPT = "PROMPT_GUIDE"   # 사용자 제공 프롬프트 22개
SOURCE_PLAN = "PLAN_DRAFT"       # 기존 앱: 계획서 기반 초안
SOURCE_PUBLIC = "PUBLIC_REF"     # 기존 앱: 공개 자료 참고

# data_type: number(측정값) / text / date / document(문서·도면 — 첨부·확인으로 검증)


def _i(id_, ko, en, dtype, unit, reason_ko, reason_en, calc=None, source=SOURCE_PROMPT, legacy=(), ref=None, ext_group=None):
    required = calc is not None
    return {"id": id_, "category": id_[0], "name": msg(ko, en), "data_type": dtype, "unit": unit,
            "reason": msg(reason_ko, reason_en), "required": required, "priority": "HIGH" if required else ("MEDIUM" if id_[0] != "E" else "LOW"),
            "calc_field": calc, "source": source, "legacy": list(legacy), "ref": ref, "ext_group": ext_group}


_LEGACY = [
    # A. 가스터빈/운전
    _i("A-01", "GT 모델 및 정격 용량", "GT model & rated capacity", "number", "MW",
       "출력 손실·정지 손실 계산의 기준 용량", "Base capacity for loss and outage-cost calculations", "capacityMW", legacy=["gt_model", "gt_rated_output"]),
    _i("A-02", "운전 배압", "Operating back pressure", "number", "mmH2O",
       "초과 배압과 출력 손실 계산", "Excess back pressure and output loss", "currentBP", legacy=["gt_back_pressure"]),
    _i("A-03", "차압 (ΔP)", "Differential pressure (ΔP)", "number", "kPa",
       "공개 문헌 기준 세정 효과 추정", "Literature-based cleaning-effect estimate", "hrsgDpKpa", legacy=["hrsg_dp"]),
    _i("A-04", "외기 온도 및 습도", "Ambient temperature & humidity", "number", "°C",
       "세정 전후 운전 조건 편차 확인", "Check before/after condition deviation", "ambientTempC", legacy=["ambient_temp"]),
    _i("A-05", "월간 가동시간", "Monthly operating hours", "number", "h",
       "월간 손실액·회수 편익 계산", "Monthly loss and recovery benefit", "operatingHoursMonth"),
    # B. HRSG 열역학/설계
    _i("B-01", "스택 출구 온도", "Stack outlet temperature", "number", "°C",
       "세정 필요도 지수, 열회수 상태 확인", "Cleaning-need index and heat-recovery check", "stackTempC", legacy=["stack_temp"]),
    _i("B-02", "HP 드럼 압력", "HP drum pressure", "number", "bar",
       "포화온도(IAPWS-IF97) → 핀치·어프로치", "Saturation temperature (IAPWS-IF97) → pinch/approach", "drumPressureBar", legacy=["drum_pressure"]),
    _i("B-03", "주증기 유량", "Main steam flow", "number", "t/h",
       "증기 생산량 변화로 열회수 성능 확인", "Heat-recovery performance via steam production", legacy=["steam_flow"]),
    _i("B-04", "과열기 (주증기) 온도", "Superheater (main steam) temperature", "number", "°C",
       "과열기 열교환 상태 확인", "Superheater heat-transfer check", legacy=["steam_temp"]),
    _i("B-05", "절탄기 출구 급수 온도", "Economizer outlet water temperature", "number", "°C",
       "어프로치 온도차 계산", "Approach temperature difference", "ecoOutletWaterTempC", legacy=["eco_outlet_water_temp"]),
    _i("B-06", "증발기 출구 가스 온도", "Evaporator outlet gas temperature", "number", "°C",
       "핀치 온도차 계산", "Pinch temperature difference", "evaOutletGasTempC", legacy=["evap_outlet_gas_temp"]),
    _i("B-07", "핀치 설계값", "Pinch design value", "number", "°C",
       "계산한 핀치와 설계값 비교", "Compare calculated pinch with design", "pinchDesignC"),
    _i("B-08", "어프로치 설계값", "Approach design value", "number", "°C",
       "계산한 어프로치와 설계값 비교", "Compare calculated approach with design", "approachDesignC"),
    _i("B-09", "튜브 배열 도면", "Tube arrangement drawing", "document", None,
       "오염 위치·세정 범위 검토", "Review fouling location and cleaning scope", legacy=["module_arrangement"]),
    # C. 세정/유지보수
    _i("C-01", "직전 세정일자", "Last cleaning date", "date", None,
       "세정 후 경과일 기준점", "Reference point for days since cleaning", legacy=["last_cleaning"]),
    _i("C-02", "세정 공법 이력", "Cleaning method history", "text", None,
       "공법별 효과 비교의 근거", "Basis for comparing methods"),
    _i("C-03", "정지 가능 일정", "Available outage schedule", "text", None,
       "공법별 정지일수·정지 손실 검토", "Outage days and outage cost by method", legacy=["outage_window"]),
    _i("C-04", "유틸리티 가용 여부", "Utility availability", "text", None,
       "고압수·화학 세정 가능 여부 (용수·전력·압축공기)", "Feasibility of water/chemical cleaning (water, power, air)"),
    _i("C-05", "세정 예산", "Cleaning budget", "number", "원",
       "공법별 비용 입력의 상한 확인", "Upper bound for method cost inputs"),
    _i("C-06", "폐수 처리 설비", "Wastewater treatment facility", "document", None,
       "고압수·화학 세정 폐수 처리 가능 여부", "Wastewater handling for water/chemical cleaning"),
    _i("C-07", "비계 설치 공간", "Scaffolding space", "text", None,
       "세정 작업 접근성", "Access for cleaning work", legacy=["site_access"]),
    _i("C-08", "안전관리 지침", "Safety management guideline", "document", None,
       "작업 계획 수립 시 확인", "Required for work planning"),
]

# E. 확장 — 기존 HRSG 앱 항목 중 위와 겹치지 않는 것 (ext_group = 기존 범주)
_EXT = [
    ("gt_load", "운전 부하", "Operating load", "number", "%", "GT_INFO", "loadFactor",
     "출력 손실 계산의 부하율", "Load factor for loss calculation"),
    ("fuel_type", "연료 종류", "Fuel type", "text", None, "FUEL_EXHAUST", None, "운전 조건 기록", "Operating condition record"),
    ("fuel_flow", "연료 유량", "Fuel flow", "number", "kg/s", "FUEL_EXHAUST", None, "운전 조건 기록", "Operating condition record"),
    ("gt_exhaust_temp", "가스터빈 배기가스 온도", "GT exhaust gas temperature", "number", "°C", "FUEL_EXHAUST", None,
     "HRSG 입구 열량 확인", "HRSG inlet heat"),
    ("gt_exhaust_flow", "가스터빈 배기가스 유량", "GT exhaust gas flow", "number", "kg/s", "FUEL_EXHAUST", None,
     "HRSG 입구 열량 확인", "HRSG inlet heat"),
    ("feedwater_flow", "급수 유량", "Feedwater flow", "number", "t/h", "WATER_STEAM", None, "물·증기 수지 확인", "Water/steam balance"),
    ("feedwater_temp", "급수 온도 (절탄기 입구)", "Feedwater temperature (economizer inlet)", "number", "°C", "WATER_STEAM", None,
     "절탄기 열교환 확인", "Economizer heat transfer"),
    ("steam_pressure", "주증기 압력", "Main steam pressure", "number", "MPa", "WATER_STEAM", None, "증기 조건 확인", "Steam conditions"),
    ("stack_o2", "배출가스 O₂ 농도", "Stack O₂", "number", "%", "EMISSIONS", None, "운전 조건 기록", "Operating condition record"),
    ("stack_nox", "배출가스 NOx 농도", "Stack NOx", "number", "ppm", "EMISSIONS", None, "운전 조건 기록", "Operating condition record"),
    ("tube_fin_spec", "튜브·핀 사양", "Tube & fin specification", "document", None, "MODULE_DESIGN", None,
     "오염 영향 검토", "Fouling impact review"),
    ("design_hrsg_dp", "설계 가스측 차압", "Design gas-side ΔP", "number", "kPa", "MODULE_DESIGN", None,
     "현재 차압과 설계값 비교", "Compare current ΔP with design"),
    ("design_stack_temp", "설계 굴뚝 온도", "Design stack temperature", "number", "°C", "MODULE_DESIGN", "baselineStackTempC",
     "세정 필요도 지수의 기준 스택 온도", "Baseline stack temperature for the cleaning index"),
    ("design_steam_flow", "설계 증기 생산량", "Design steam production", "number", "t/h", "MODULE_DESIGN", None,
     "증기 생산량 비교", "Steam production comparison"),
    ("data_period", "운전 데이터 측정 기간", "Operating data period", "text", None, "SCHEDULE_SITE", None,
     "비교 기간 확인", "Comparison period"),
    ("clean_hrsg_dp", "신규·세정 직후 기준 가스측 차압", "New-and-clean baseline ΔP", "number", "kPa", "MODULE_DESIGN", "hrsgDpCleanKpa",
     "문헌 기준 세정 효과 추정의 기준값 (POWER 2015)", "Baseline for the literature estimate (POWER 2015)"),
    ("duct_burner_fuel_flow", "보조연소(덕트 버너) 연료 유량", "Duct burner fuel flow", "number", "kg/s", "FUEL_EXHAUST", None,
     "ASME PTC 4.4 시험 범위 확인", "ASME PTC 4.4 test scope"),
    ("gt_exhaust_flow_method", "가스터빈 배기 유량 산정 방법", "GT exhaust flow determination method", "text", None, "FUEL_EXHAUST", None,
     "ASME PTC 4.4: 두 가지 방법 비교 여부", "ASME PTC 4.4: two methods compared?"),
]
_PUBLIC = {"clean_hrsg_dp": "POWER_2015", "duct_burner_fuel_flow": "ASME_PTC44", "gt_exhaust_flow_method": "ASME_PTC44"}
for n, (key, ko, en, dtype, unit, group, calc, rko, ren) in enumerate(_EXT, start=1):
    _LEGACY.append(_i(f"E-{n:02d}", ko, en, dtype, unit, rko, ren, calc,
                    source=SOURCE_PUBLIC if key in _PUBLIC else SOURCE_PLAN, legacy=[key], ref=_PUBLIC.get(key), ext_group=group))

_OLD = {i["id"]: i for i in _LEGACY}

# 키트 calc_input(키트 입력 경로) → 이 앱 계산 입력 필드 (어댑터 to_kit_inputs 의 반대 방향, 화면에 없는 입력은 None)
CALC_FIELD = {"equipment.gt_class": "turbineModel", "equipment.gt_bp": "currentBP", "equipment.hrsg_dp": "hrsgDpKpa",
              "equipment.ambient_c": "ambientTempC", "economics.monthly_hours": "operatingHoursMonth", "equipment.base_gt_bp": "baselineBP",
              "equipment.stack_c": "stackTempC", "sections.HP.drum_barg": "drumPressureBar",
              "sections.HP.econ_outlet_water_c": "ecoOutletWaterTempC", "sections.HP.evap_outlet_gas_c": "evaOutletGasTempC",
              "sections.HP.pinch_design_c": "pinchDesignC", "sections.HP.approach_design_c": "approachDesignC",
              "economics.price": "smpWonPerKWh", "equipment.load_pct": "loadFactor", "equipment.base_stack_c": "baselineStackTempC"}


def _from_kit(k):
    old = _OLD.get(k["id"], {})
    dtype = "document" if k["kind"] == "document" else old.get("data_type") or ("number" if k["unit"] and "," not in k["unit"] else "text")
    return {"id": k["id"], "category": k["category"],
            "name": msg(k["name"], old["name"]["en"] if old else k["name"]),
            "reason": msg(k["reason"], old["reason"]["en"] if old else k["reason"]),
            "unit": k["unit"] or None, "kind": k["kind"], "data_type": dtype,
            "required": k["required"], "priority": k["priority"].upper(),
            "priority_label": kit.checklist.priority_label(kit.C(), k),
            "calc_input": k["calc_input"], "calc_field": CALC_FIELD.get(k["calc_input"]),
            "source": old.get("source", "KIT"), "legacy": old.get("legacy", []), "ref": old.get("ref"), "ext_group": old.get("ext_group")}


ITEMS = [_from_kit(k) for k in kit.C()["items"]]
BY_ID = {i["id"]: i for i in ITEMS}

# 상태 코드는 DB 에 저장하는 값이고, 키트 키와의 대응은 engine/kit.py (SUPPLY_TO_KIT …). 화면 글자는 키트 data 의 글자.
SUPPLY = list(kit.SUPPLY_TO_KIT)
VERIFY = list(kit.VERIFY_TO_KIT)
_SUPPLY_EN = {"NOT_ENTERED": "Not entered", "REQUEST_NEEDED": "Request needed", "RECEIVED": "Received", "NEEDS_CHECK": "Needs check", "NA": "Not applicable"}
_VERIFY_EN = {"UNVERIFIED": "Unverified", "IN_PROGRESS": "In progress", "VERIFIED": "Verified", "FAILED": "Failed"}
SUPPLY_LABELS = {c: msg(kit.C()["supply_states"][k], _SUPPLY_EN[c]) for c, k in kit.SUPPLY_TO_KIT.items()}
VERIFY_LABELS = {c: msg(kit.C()["verify_states"][k], _VERIFY_EN[c]) for c, k in kit.VERIFY_TO_KIT.items()}


def legacy_status(old):
    """기존 HRSG 앱 상태 → (수급 상태, 검증 상태). 기존 VERIFIED 는 '수령 완료 + 검증 완료' 입니다."""
    return {"MISSING": ("REQUEST_NEEDED", "UNVERIFIED"), "RECEIVED": ("RECEIVED", "UNVERIFIED"),
            "VERIFIED": ("RECEIVED", "VERIFIED")}.get(old, ("NOT_ENTERED", "UNVERIFIED"))
