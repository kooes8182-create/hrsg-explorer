"""공개 자료 목록 (출처·쪽·원문 인용) 과 공개 통계값.

여기 있는 값은 모두 원문에서 직접 확인한 것만 넣었습니다 (확인일 2026-10-19). 확인 기록: specs/11_public_references.md
- 원문 PDF·웹 페이지 자체는 앱에서 제공하지 않습니다 (링크 주소만 표시).
- 문헌 값은 특정 기종·사례의 값이며 우리 설비의 값이 아닙니다. 결과는 항상 '참고 추정' 으로 표시합니다.
"""

from decimal import Decimal

CHECKED_ON = "2026-10-19"

SOURCES = {
    "GE_GER3567H": {
        "title": "GE Gas Turbine Performance Characteristics (GER-3567H)",
        "author": "F. J. Brooks, GE Power Systems",
        "year": 2000,
        "where": "p.10, Figure 12 'Pressure drop effects (MS7001EA)'",
        "quote": "4 Inches (10 mbar) H2O Exhaust Drop Produces: 0.42% Power Output Loss, 0.42% Heat Rate Increase, "
                 "1.9 F (1.1 C) Exhaust Temperature Increase",
        "scope": {"ko": "GE Frame 7EA(MS7001EA) 단순사이클 가스터빈 1개 기종. 원문: 압력손실 영향은 설계마다 다름(p.9)",
                  "en": "One model only: GE Frame 7EA (MS7001EA), simple cycle. Source p.9: effects are unique to each design"},
    },
    "IST_2000": {
        "title": "Heat Recovery Steam Generators (EPIC Turbines & Cogeneration Workshop)",
        "author": "Innovative Steam Technologies",
        "year": 2000,
        "where": "Section 1.1(e) Actual Gas Side Pressure Drop; 1.2 Common HRSG Terms (a) Pinch Point, (b) Approach Temperature",
        "quote": "An additional gas side pressure drop of 4 inches WG results in approximately 1% decline in the electrical "
                 "power output of the gas turbine. / For unfired HRSGs, the optimum pinch point ranges from 10 F to 30 F. / "
                 "Typical approach temperatures are approximately 25 F.",
        "scope": {"ko": "HRSG 제조사 자료의 일반 경험값 (기종 명시 없음)", "en": "Vendor rule of thumb (no GT model stated)"},
    },
    "POWER_2015": {
        "title": "CO2 Blasting Restores HRSG Performance",
        "author": "C. Norton, R. Taikowski Jr., POWER magazine",
        "year": 2015,
        "where": "powermag.com, 2015-06-01",
        "quote": "HRSG cleaning is required when the gas path pressure drop across the HRSG reaches 3 to 4 inches H2O over "
                 "'new and clean' condition. / ~19.5 in. H2O ... reduced to ~13.2 in. H2O",
        "scope": {"ko": "GE Frame 6B 3기 발전소 1곳의 사례·경험 기준", "en": "One plant case (three GE Frame 6B units) and rule of thumb"},
    },
    "ASME_PTC44": {
        "title": "ASME PTC 4.4 Gas Turbine Heat Recovery Steam Generators (공개 소개문)",
        "author": "ASME",
        "year": None,
        "where": "asme.org 표준 소개 페이지",
        "quote": "The test approach involves the determination of the gas turbine exhaust flow by two different means and "
                 "combining the result. This would apply to multipressure HRSG's including units with auxiliary duct burners.",
        "scope": {"ko": "표준 본문(유료)은 보지 않았고 공개 소개문만 참고", "en": "Only the public description; the paid standard was not read"},
    },
    "IAPWS_IF97": {
        "title": "Revised Release on the IAPWS Industrial Formulation 1997 for the Thermodynamic Properties of Water and Steam",
        "author": "IAPWS, R7-97(2012)",
        "year": 2012,
        "where": "Section 8.2 Eq. (31), Table 34 coefficients, Table 36 verification values",
        "quote": "Table 36: p = 0.1, 1, 10 MPa → Ts = 372.755919, 453.035632, 584.149488 K",
        "scope": {"ko": "국제 증기 물성 표준의 포화온도 식", "en": "International steam-property standard, saturation temperature"},
    },
    "KPX_SMP": {
        "title": "SMP 월별·연도별 (육지)",
        "author": "한국전력거래소(KPX) / 전력통계정보시스템(EPSIS)",
        "year": 2026,
        "where": "new.kpx.or.kr 월별 SMP·연도별 SMP, epsis.kpx.or.kr 가중평균 SMP",
        "quote": "가중평균SMP는 시간대별 SMP를 시간대별 전력수요예측량으로 가중평균한 값 (EPSIS 비고). 단위: 원/kWh",
        "scope": {"ko": f"공개 통계 (공공데이터포털 이용허락범위 제한 없음), {CHECKED_ON} 조회", "en": f"Public statistics, retrieved {CHECKED_ON}"},
    },
}


def cite(key, ko_note=None):
    s = SOURCES[key]
    return {"type": "public_ref", "key": key, "title": s["title"], "author": s["author"], "year": s["year"],
            "where": s["where"], "scope": s["scope"], "checked_on": CHECKED_ON}


# ---------------------------------------------------------------- 문헌 계수 (원문 그대로)
# 배기측 압력손실 4 in H2O 당 영향
GE_OUTPUT_LOSS_PCT_PER_4IN = Decimal("0.42")
GE_HEAT_RATE_PCT_PER_4IN = Decimal("0.42")
GE_EXHAUST_TEMP_C_PER_4IN = Decimal("1.1")
IST_OUTPUT_LOSS_PCT_PER_4IN = Decimal("1")  # "approximately 1%"
# 세정 필요 참고 기준: 신규·청정 대비 3~4 in H2O 증가 (POWER 2015)
CLEANING_TRIGGER_IN_H2O = (Decimal("3"), Decimal("4"))
# 핀치·어프로치 (IST 2000, °F 온도차 → °C 온도차 = ×5/9)
PINCH_RANGE_F = (10, 30)
APPROACH_TYPICAL_F = 25

# 1 in H2O = 0.0254 m × 1000 kg/m³ × 9.80665 m/s² = 249.08891 Pa (관용 인치 수주)
IN_H2O_PA = Decimal("249.08891")

# ---------------------------------------------------------------- 공개 SMP (육지, 원/kWh, 수요예측량 가중평균)
# KPX 월별 SMP 페이지에서 직접 확인한 값 (2025-01 ~ 2026-09)
SMP_MONTHLY = {
    "2025-01": 117.11, "2025-02": 116.39, "2025-03": 113.12, "2025-04": 124.63, "2025-05": 125.50, "2025-06": 118.02,
    "2025-07": 120.39, "2025-08": 117.39, "2025-09": 112.90, "2025-10": 101.53, "2025-11": 94.80, "2025-12": 90.43,
    "2026-01": 103.54, "2026-02": 108.52, "2026-03": 110.03, "2026-04": 118.94, "2026-05": 121.36, "2026-06": 114.11,
    "2026-07": 133.79, "2026-08": 148.39, "2026-09": 119.02,
}
# KPX 연도별 SMP 페이지에서 직접 확인한 값
SMP_ANNUAL = {"2022": 196.04, "2023": 167.00, "2024": 128.33, "2025": 112.73}


def smp_public_values():
    """경제성 입력의 출처를 '공개 통계' 로 인정할 수 있는 값들."""
    return {Decimal(str(v)) for v in list(SMP_MONTHLY.values()) + list(SMP_ANNUAL.values())}


def smp_payload():
    return {
        "unit": "원/kWh",
        "region": {"ko": "육지", "en": "Mainland"},
        "average": {"ko": "시간대별 전력수요예측량 가중평균", "en": "Weighted by hourly demand forecast"},
        "monthly": [{"month": k, "value": v} for k, v in SMP_MONTHLY.items()],
        "annual": [{"year": k, "value": v} for k, v in SMP_ANNUAL.items()],
        "source": cite("KPX_SMP"),
        "notice": {"ko": "과거 실적값입니다. 앞으로의 SMP를 예측하지 않습니다.",
                   "en": "Historical values. They are not a forecast of future SMP."},
    }
