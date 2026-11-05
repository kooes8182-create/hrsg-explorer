"""용어집과 자료 분류 (참고 자료 화면).

정의는 일반적인 공학 용어 설명이며, 수치·계수는 넣지 않습니다. 근거가 있는 항목은 public_refs 의 출처 키를 연결합니다.
"""

from .base import msg
from .public_refs import CHECKED_ON, SOURCES, cite


def _t(key, ko, en, dko, den, formula=None, pages=(), sources=()):
    return {"key": key, "term": msg(ko, en), "definition": msg(dko, den), "formula": formula,
            "pages": list(pages), "sources": list(sources)}


GLOSSARY = [
    _t("HRSG", "HRSG (배열회수보일러)", "HRSG (Heat Recovery Steam Generator)",
       "가스터빈 배기가스의 열을 회수해 증기를 만드는 보일러. 복합화력에서 스팀터빈에 증기를 공급합니다.",
       "A boiler that recovers heat from gas-turbine exhaust to make steam for the steam turbine in a combined cycle.",
       pages=["/dashboard", "/simulation"], sources=["IST_2000"]),
    _t("GT", "가스터빈", "Gas Turbine",
       "연료를 연소시켜 터빈을 돌리는 원동기. 배기가스가 HRSG로 들어갑니다.",
       "A prime mover driven by combustion gas; its exhaust flows into the HRSG.", pages=["/simulation"], sources=["GE_GER3567H"]),
    _t("BP", "배압", "Back Pressure",
       "가스터빈 출구에 걸리는 압력. HRSG 가스 통로가 오염되면 커지고, 가스터빈 출력이 줄어듭니다.",
       "Pressure at the gas-turbine exhaust. It rises when the HRSG gas path fouls, reducing GT output.",
       formula="ExcessBP = max(0, CurrentBP − BaselineBP)", pages=["/calculator", "/simulation"], sources=["GE_GER3567H"]),
    _t("DP", "차압", "Pressure Drop (ΔP)",
       "HRSG 가스측 입구와 출구의 압력 차이. 신규·청정 상태 대비 증가량으로 오염 정도를 봅니다.",
       "Gas-side pressure difference across the HRSG; its increase over new-and-clean indicates fouling.",
       pages=["/analysis"], sources=["POWER_2015", "IST_2000"]),
    _t("FOULING", "오염 (파울링)", "Fouling",
       "튜브·핀 표면에 쌓이는 퇴적물. 열전달을 떨어뜨리고 가스측 압력손실을 키웁니다.",
       "Deposits on tubes and fins that reduce heat transfer and increase gas-side pressure loss.",
       pages=["/before-after"], sources=["POWER_2015"]),
    _t("ECO", "절탄기", "Economizer",
       "HRSG 가장 뒤쪽(저온부)에서 급수를 포화온도 가까이 데우는 열교환기.",
       "Low-temperature section that preheats feedwater toward saturation.",
       formula="Approach = Tsat − EconomizerWaterOutletTemp", pages=["/analysis"], sources=["IST_2000"]),
    _t("EVA", "증발기", "Evaporator",
       "드럼 압력의 포화온도에서 물을 증기로 바꾸는 열교환기.",
       "Section that boils water at the drum saturation temperature.",
       formula="Pinch = EvaporatorGasOutletTemp − Tsat", pages=["/analysis"], sources=["IST_2000"]),
    _t("SH", "과열기", "Superheater",
       "포화증기를 더 가열해 과열증기로 만드는 고온부 열교환기.",
       "High-temperature section that heats saturated steam into superheated steam.", pages=["/dashboard"]),
    _t("PINCH", "핀치 포인트", "Pinch Point",
       "증발기 출구 가스 온도와 드럼 포화온도의 차이. 작을수록 열회수가 크지만 전열면적이 커집니다.",
       "Difference between evaporator outlet gas temperature and drum saturation temperature.",
       formula="Pinch = EvaporatorGasOutletTemp − Tsat", pages=["/analysis", "/calculator"], sources=["IST_2000", "IAPWS_IF97"]),
    _t("APPROACH", "어프로치 포인트", "Approach Point",
       "드럼 포화온도와 절탄기 출구 급수 온도의 차이. 너무 작으면 절탄기 안에서 증기가 생길 수 있습니다.",
       "Difference between drum saturation temperature and economizer outlet water temperature.",
       formula="Approach = Tsat − EconomizerWaterOutletTemp", pages=["/analysis", "/calculator"], sources=["IST_2000", "IAPWS_IF97"]),
    _t("HEATRATE", "열소비율", "Heat Rate",
       "1 kWh 를 만드는 데 드는 연료 열량. 값이 커지면 효율이 나빠진 것입니다.",
       "Fuel heat input per kWh generated; higher means lower efficiency.", pages=["/analysis"], sources=["GE_GER3567H"]),
    _t("SMP", "SMP (계통한계가격)", "SMP (System Marginal Price)",
       "전력시장에서 시간대별로 정해지는 전력 도매가격(원/kWh). 경제성 계산에서 회수 출력의 가치를 정할 때 씁니다.",
       "Hourly wholesale electricity price in Korea (KRW/kWh), used to value recovered output.",
       formula="MonthlyRecoveryBenefit = TargetRecoveryMW × 1000 × Hours × SMP", pages=["/calculator", "/analysis"], sources=["KPX_SMP"]),
]

# 자료 분류 (17-3). 내부 승인 문서는 제공받은 것이 없어 비어 있습니다.
CATEGORIES = [
    {"key": "PUBLIC", "label": msg("공개 문헌", "Public literature"),
     "items": [cite(k) | {"quote": SOURCES[k]["quote"]} for k in SOURCES]},
    {"key": "INTERNAL", "label": msg("내부 승인 문서", "Internally approved documents"), "items": [],
     "empty": msg("제공받은 내부 승인 문서가 없습니다.", "No internally approved documents were provided.")},
    {"key": "DEMO", "label": msg("DEMO 참고 자료", "DEMO reference material"),
     "items": [{"key": "PROMPT_GUIDE", "title": msg("사용자 제공 구현 프롬프트 (DEMO 공식·계수·참고 범위)",
                                                   "User-provided implementation prompt (DEMO formulas, coefficients, ranges)"),
                "scope": msg("출력 손실 0.0013, 정지 손실 0.15, BEP 월 30일, 세정 필요도 지수, 핀치 8~15 °C·어프로치 5~12 °C, 세정 전후 편차 5%p·5 °C",
                             "Loss 0.0013, outage 0.15, 30-day month, cleaning index, pinch 8–15 °C / approach 5–12 °C, before/after 5 pp / 5 °C"),
                "limit": msg("가상 시연용 가정. 출처 문헌이 확인되지 않았습니다.", "Demo assumptions; no source literature confirmed.")}]},
    {"key": "UNVERIFIED", "label": msg("검증되지 않은 자료", "Unverified material"),
     "items": [{"key": "MISSING_GUIDE", "title": msg("첨부 최종 구현 가이드 (미제공)", "Attached final implementation guide (not provided)"),
                "scope": msg("추천 질문 14개 문장, 데이터 인벤토리 35개, 일부 실험 수치(0.813, 16→4, 100/100, 39편·2,037청크)",
                             "14 suggested questions, 35-item data inventory, some experiment figures (0.813, 16→4, 100/100, 39 docs / 2,037 chunks)"),
                "limit": msg("파일이 없어 확인할 수 없으므로 앱에 쓰지 않았습니다.", "Not available to verify, so not used in the app.")}]},
]


def payload():
    return {"glossary": GLOSSARY, "categories": CATEGORIES, "checkedOn": CHECKED_ON}
