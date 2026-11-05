"""플랜트 데이터 요청 체크리스트 항목 목록 (계획서 기반 초안).

사내 데이터 요청 양식은 제공되지 않았습니다. 아래 항목은 계획서에 적힌 범주명만 근거로 만든 초안입니다.

실제 요청 양식을 받으면:
  1) CHECKLIST_CATALOG 에 항목을 추가·수정하고 source 를 "COMPANY_FORM" 으로 둡니다.
  2) required 와 REQUIREMENT_IS_PROVISIONAL 을 확정 기준으로 바꿉니다.
  3) `python manage.py seed_demo_cases` 를 실행하면 기존 케이스에 새 항목이 '미수신'으로 추가됩니다.
     (이미 입력된 값은 바꾸지 않습니다. 기존 항목의 이름·단위 변경은 새 케이스부터 적용됩니다.)
"""

SOURCE_PLAN_DRAFT = "PLAN_DRAFT"  # 계획서 기반 초안
SOURCE_COMPANY_FORM = "COMPANY_FORM"  # 사내 요청 양식 (미제공)
SOURCE_PUBLIC_REF = "PUBLIC_REF"  # 공개 자료(문헌·표준 소개문) 참고로 추가한 항목

SOURCE_LABELS = {
    SOURCE_PLAN_DRAFT: {"ko": "계획서 기반 초안", "en": "Plan-based draft"},
    SOURCE_COMPANY_FORM: {"ko": "사내 요청 양식", "en": "Company request form"},
    SOURCE_PUBLIC_REF: {"ko": "공개 자료 참고", "en": "From public references"},
}

# 평가 기능 코드
PERFORMANCE = "PERFORMANCE"
PINCH_APPROACH = "PINCH_APPROACH"
ECONOMICS = "ECONOMICS"

# 필수 여부 기준은 확정되지 않았습니다 → 화면에 '임시 기준' 표시
REQUIREMENT_IS_PROVISIONAL = True

CATEGORIES = [
    {"code": "GT_INFO", "ko": "가스터빈 정보", "en": "Gas turbine information"},
    {"code": "FUEL_EXHAUST", "ko": "연료 및 배기가스 운전 데이터", "en": "Fuel & exhaust gas operating data"},
    {"code": "WATER_STEAM", "ko": "급수 및 증기 운전 데이터", "en": "Feedwater & steam operating data"},
    {"code": "EMISSIONS", "ko": "배출가스 운전 데이터", "en": "Stack emission operating data"},
    {"code": "MODULE_DESIGN", "ko": "열교환 모듈 사양과 설계값", "en": "Heat exchange module specs & design values"},
    {"code": "PINCH_APPROACH", "ko": "핀치·어프로치 평가 항목", "en": "Pinch/approach evaluation items"},
    {"code": "SCHEDULE_SITE", "ko": "일정과 현장 조건", "en": "Schedule & site conditions"},
]
CATEGORY_CODES = [c["code"] for c in CATEGORIES]
CATEGORY_BY_CODE = {c["code"]: c for c in CATEGORIES}

P = {PERFORMANCE: True}
A = {PINCH_APPROACH: True}


def _item(category, key, ko, en, unit, required=None, source=SOURCE_PLAN_DRAFT, ref=None):
    return {
        "category": category,
        "key": key,
        "name_ko": ko,
        "name_en": en,
        "unit": unit,
        "required": required or {},
        "source": source,
        "ref": ref,  # 공개 자료 항목의 근거 (calculators/public_refs.SOURCES 의 key)
    }


CHECKLIST_CATALOG = [
    _item("GT_INFO", "gt_model", "가스터빈 모델명", "Gas turbine model", "—", P),
    _item("GT_INFO", "gt_rated_output", "가스터빈 정격 출력", "Gas turbine rated output", "MW"),
    _item("GT_INFO", "gt_load", "운전 부하", "Operating load", "%", P),
    _item("GT_INFO", "ambient_temp", "대기 온도", "Ambient temperature", "°C", P),
    _item("FUEL_EXHAUST", "fuel_type", "연료 종류", "Fuel type", "—"),
    _item("FUEL_EXHAUST", "fuel_flow", "연료 유량", "Fuel flow", "kg/s"),
    _item("FUEL_EXHAUST", "gt_exhaust_temp", "가스터빈 배기가스 온도", "GT exhaust gas temperature", "°C", P),
    _item("FUEL_EXHAUST", "gt_exhaust_flow", "가스터빈 배기가스 유량", "GT exhaust gas flow", "kg/s", P),
    _item("FUEL_EXHAUST", "gt_back_pressure", "가스터빈 배압", "GT back pressure", "kPa", P),
    _item("FUEL_EXHAUST", "hrsg_dp", "HRSG 가스측 차압 (ΔP)", "HRSG gas-side differential pressure (ΔP)", "kPa", P),
    _item("WATER_STEAM", "feedwater_flow", "급수 유량", "Feedwater flow", "t/h", P),
    _item("WATER_STEAM", "feedwater_temp", "급수 온도 (절탄기 입구)", "Feedwater temperature (economizer inlet)", "°C", P),
    _item("WATER_STEAM", "steam_flow", "주증기 유량", "Main steam flow", "t/h", P),
    _item("WATER_STEAM", "steam_pressure", "주증기 압력", "Main steam pressure", "MPa", P),
    _item("WATER_STEAM", "steam_temp", "주증기 온도", "Main steam temperature", "°C", P),
    _item("EMISSIONS", "stack_temp", "굴뚝(스택) 온도", "Stack temperature", "°C", P),
    _item("EMISSIONS", "stack_o2", "배출가스 O₂ 농도", "Stack O₂ concentration", "%"),
    _item("EMISSIONS", "stack_nox", "배출가스 NOx 농도", "Stack NOx concentration", "ppm"),
    _item("MODULE_DESIGN", "module_arrangement", "열교환 모듈 구성 (과열기·증발기·절탄기 배열)",
          "Module arrangement (superheater, evaporator, economizer)", "—", P),
    _item("MODULE_DESIGN", "tube_fin_spec", "튜브·핀 사양", "Tube & fin specification", "—"),
    _item("MODULE_DESIGN", "design_hrsg_dp", "설계 가스측 차압", "Design gas-side differential pressure", "kPa", P),
    _item("MODULE_DESIGN", "design_stack_temp", "설계 굴뚝 온도", "Design stack temperature", "°C", P),
    _item("MODULE_DESIGN", "design_steam_flow", "설계 증기 생산량", "Design steam production", "t/h", P),
    _item("PINCH_APPROACH", "drum_pressure", "드럼 압력", "Drum pressure", "MPa", A),
    _item("PINCH_APPROACH", "eco_outlet_water_temp", "절탄기 출구 급수 온도", "Economizer outlet water temperature", "°C", A),
    _item("PINCH_APPROACH", "evap_outlet_gas_temp", "증발기 출구 가스 온도", "Evaporator outlet gas temperature", "°C", A),
    _item("SCHEDULE_SITE", "outage_window", "세정 가능 정지 기간", "Available outage window for cleaning", "—"),
    _item("SCHEDULE_SITE", "last_cleaning", "최근 세정 이력 (시기·공법)", "Last cleaning (date & method)", "—"),
    _item("SCHEDULE_SITE", "site_access", "현장 접근·작업 조건", "Site access & work conditions", "—"),
    _item("SCHEDULE_SITE", "data_period", "운전 데이터 측정 기간", "Operating data measurement period", "—"),
    # 공개 자료 참고 항목 (계획서 범주 안에서 보강)
    _item("MODULE_DESIGN", "clean_hrsg_dp", "신규·세정 직후 기준 가스측 차압 (같은 부하 기준)",
          "New-and-clean baseline gas-side ΔP (same load)", "kPa", P, SOURCE_PUBLIC_REF, "POWER_2015"),
    _item("FUEL_EXHAUST", "duct_burner_fuel_flow", "보조연소(덕트 버너) 연료 유량 (설치된 경우)",
          "Duct burner (supplementary firing) fuel flow, if installed", "kg/s", None, SOURCE_PUBLIC_REF, "ASME_PTC44"),
    _item("FUEL_EXHAUST", "gt_exhaust_flow_method", "가스터빈 배기 유량 산정 방법 (두 가지 방법 비교 여부)",
          "GT exhaust flow determination method (two methods compared?)", "—", None, SOURCE_PUBLIC_REF, "ASME_PTC44"),
]

CATALOG_BY_KEY = {item["key"]: item for item in CHECKLIST_CATALOG}


def required_for(key):
    """항목이 어느 평가 기능에 필요한지 (임시 기준). 목록에 없는 항목은 필수 아님."""
    req = CATALOG_BY_KEY.get(key, {}).get("required", {})
    return {PERFORMANCE: bool(req.get(PERFORMANCE)), PINCH_APPROACH: bool(req.get(PINCH_APPROACH))}


def is_required(key):
    return any(required_for(key).values())
