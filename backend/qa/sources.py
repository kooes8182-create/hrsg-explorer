"""일반 설명에 쓸 수 있는 자료 = 'HRSG 레퍼런스 앱 계획서' 에서 확인한 내용만 (요약, 페이지 표시).

- 원문 PDF는 웹으로 제공하지 않습니다(링크·다운로드 없음). 여기에는 짧은 요약만 둡니다.
- 계획서에 없는 설명(물성, 운전 한계, 산정식 등)은 추가하지 않습니다.
- 협력사 기술 자료·사례는 제공되지 않았습니다 (specs/09).
"""

DOC_TITLE = {"ko": "HRSG 레퍼런스 앱 계획서", "en": "HRSG Reference App project plan"}


def _cite(page, section_ko, section_en, note=None):
    c = {"type": "document", "title": DOC_TITLE, "page": page, "section": {"ko": section_ko, "en": section_en}}
    if note:
        c["note"] = note
    return c


P1_NOTE = {
    "ko": "계획서 p.1이 밝힌 원출처: Week 2 세미나 자료 「HRSG 도메인 설명 & 예측 모델」",
    "en": "Source stated on plan p.1: Week 2 seminar material 'HRSG domain & prediction model'",
}

TOPICS = {
    "HRSG_DEF": {
        "text": {
            "ko": "HRSG(배열회수보일러)는 가스터빈 배기가스(500~650°C)의 폐열로 증기를 만들어, 스팀터빈으로 두 번째 발전을 하는 폐열회수 설비입니다.",
            "en": "An HRSG (heat recovery steam generator) uses waste heat from gas turbine exhaust (500–650°C) to make steam, which drives a steam turbine for a second stage of power generation.",
        },
        "cite": [_cite(1, "1. 도메인 배경 — HRSG", "1. Domain background — HRSG", P1_NOTE)],
    },
    "FOULING": {
        "text": {
            "ko": "배기가스는 튜브 바깥(가스 통로)을, 물·증기는 튜브 안쪽을 흐르며, 오염은 튜브 바깥의 핀(fin) 표면에 쌓입니다. "
                  "오염은 두 경로로 성능을 떨어뜨립니다.\n"
                  "① 유동 저항 증가: 가스 통로가 좁아져 차압(ΔP)이 오르고, 가스터빈 배압이 높아져 출력·효율이 떨어집니다.\n"
                  "② 열전달 저항 증가: 오염층이 단열재처럼 작용해 증기 생산량이 줄고, 열을 덜 빼앗긴 가스가 그대로 나가 굴뚝(스택) 온도가 오릅니다.\n"
                  "그래서 운전 중 튜브가 오염되면 배압과 굴뚝 온도가 오르고 발전 출력이 줄어듭니다.",
            "en": "Exhaust gas flows outside the tubes (gas path) and water/steam inside; fouling builds up on the fin surfaces outside the tubes. "
                  "Fouling reduces performance in two ways.\n"
                  "① Higher flow resistance: the gas path narrows, the differential pressure (ΔP) rises, GT back pressure increases, and output/efficiency drop.\n"
                  "② Higher heat-transfer resistance: the fouling layer acts like insulation, steam production falls, and gas leaves with more heat, so stack temperature rises.\n"
                  "As a result, fouling during operation raises back pressure and stack temperature and reduces power output.",
        },
        "cite": [
            _cite(1, "1. 도메인 배경 — 가스측 오염의 영향", "1. Domain background — effects of gas-side fouling", P1_NOTE),
            _cite(2, "2. 프로젝트 목표", "2. Project goal"),
        ],
    },
    "PRESSURE": {
        "text": {
            "ko": "배압은 가스터빈 배기 압력이며 오염 시 상승합니다. 튜브 표면에 오염물질이 쌓여 가스 통로가 좁아지면 차압(ΔP)이 오르고, "
                  "이것이 가스터빈 배압 증가와 출력·효율 저하로 이어집니다. (이 앱은 HRSG 차압과 가스터빈 배압을 서로 다른 측정값으로 다룹니다.)",
            "en": "Back pressure is the gas turbine exhaust pressure and rises with fouling. When deposits build up on the tubes and narrow the gas path, "
                  "the differential pressure (ΔP) rises, which leads to higher GT back pressure and lower output/efficiency. (This app treats HRSG ΔP and GT back pressure as separate measurements.)",
        },
        "cite": [
            _cite(3, "5. 참고 사항 — 용어 (배압)", "5. Notes — terms (back pressure)"),
            _cite(1, "1. 도메인 배경 — 유동 저항 증가: 차압", "1. Domain background — flow resistance: ΔP", P1_NOTE),
        ],
    },
    "STACK": {
        "text": {
            "ko": "굴뚝 온도는 HRSG를 빠져나가는 배기가스 온도이며, 오염 시 상승합니다(오염층이 열전달을 막아 열을 덜 회수하기 때문).",
            "en": "Stack temperature is the temperature of exhaust gas leaving the HRSG, and it rises with fouling (the fouling layer blocks heat transfer, so less heat is recovered).",
        },
        "cite": [
            _cite(3, "5. 참고 사항 — 용어 (굴뚝 온도)", "5. Notes — terms (stack temperature)"),
            _cite(1, "1. 도메인 배경 — 열전달 저항 증가: 스택 온도", "1. Domain background — heat-transfer resistance: stack temperature", P1_NOTE),
        ],
    },
    "PINCH_DEF": {
        "text": {
            "ko": "핀치·어프로치 포인트는 HRSG 열 회수 상태를 나타내는 온도 차 지표입니다. 계획서에는 계산 방법이나 판정 기준값이 없어, "
                  "이 앱은 국제 증기 물성 표준(IAPWS-IF97)의 포화온도 식으로 '참고 계산'만 하고 판정하지 않습니다.",
            "en": "Pinch and approach points are temperature-difference indicators of HRSG heat recovery. The plan gives no calculation method or criteria, "
                  "so this app only makes a reference calculation with the IAPWS-IF97 saturation equation and does not judge.",
        },
        "cite": [_cite(3, "5. 참고 사항 — 용어 (핀치·어프로치 포인트)", "5. Notes — terms (pinch/approach point)")],
    },
    "SMP_DEF": {
        "text": {
            "ko": "SMP는 전력 도매 가격입니다. 계획서는 한국전력거래소(KPX) 공개 SMP를 공공 데이터로 적고 있습니다. 이 앱은 SMP를 실시간으로 가져오지 않으며, "
                  "경제성 계산에는 사용자가 가정값을 넣거나 확인된 과거 실적(공개 통계)을 골라 넣습니다.",
            "en": "SMP is the wholesale electricity price. The plan lists KPX public SMP as public data. This app does not fetch SMP live; "
                  "for economics, users enter an assumption or pick a verified historical value (public statistics).",
        },
        "cite": [
            _cite(3, "5. 참고 사항 — 용어 (SMP)", "5. Notes — terms (SMP)"),
            _cite(3, "4. 데이터 — 공공 데이터", "4. Data — public data"),
        ],
    },
}
