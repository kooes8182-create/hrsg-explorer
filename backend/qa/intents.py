"""언어 감지와 질문 의도 분류 (한/영 키워드, 우선순위 순서대로 판정).

데모 범위 밖 질문은 UNKNOWN 으로 분류하고, 임의 설명이나 수치를 만들지 않습니다.
"""

import re

SENSITIVE = "SENSITIVE"  # 내부 계산식·원문·고객사·비밀값 요청 → 거절
OUT_OF_SCOPE = "OUT_OF_SCOPE"  # 예측·고장 시점 등 근거 자료 없음
ECON_REQUIREMENTS = "ECON_REQUIREMENTS"  # 공법별 비용 비교에 필요한 입력
ECON_RESULT = "ECON_RESULT"  # 저장된 경제성 결과와 입력 조건
DATA_GAP = "DATA_GAP"  # 체크리스트 기준 부족 데이터
PINCH_RESULT = "PINCH_RESULT"  # 핀치·어프로치 결과(산출 불가 사유)
PERF_RESULT = "PERF_RESULT"  # 저장된 성능 평가 결과
REFERENCE_RESULT = "REFERENCE_RESULT"  # 공개 문헌 기반 참고 추정 (저장된 결과 + 출처 계수)
SMP_DATA = "SMP_DATA"  # 공개 SMP 실적 (KPX/EPSIS 확인값)
CONCEPT = "CONCEPT"  # 계획서 범위의 일반 설명
UNKNOWN = "UNKNOWN"


def detect_lang(text):
    return "ko" if re.search(r"[가-힣]", text) else "en"


def _has(q, words):
    return any(w in q for w in words)


W = {
    "sensitive": ["계산식", "산정식", "산정 방식", "수식", "내부 계산", "원문", "원본", "pdf", "파일", "다운로드", "고객사",
                  "발전소 이름", "발전소명", "어느 발전소", "개인정보", "api 키", "api key", "비밀번호", "비밀 키",
                  "formula", "equation", "internal calculation", "source document", "original document", "raw document",
                  "download", "customer", "client", "plant name", "which plant", "personal", "password", "secret"],
    "forecast": ["내년", "다음 달", "앞으로", "미래", "전망", "예측해", "예측하", "고장", "수명", "언제 세정",
                 "next year", "next month", "future", "forecast", "predict", "will ", "fail", "lifetime", "when should"],
    "econ": ["경제성", "경제", "순편익", "매출", "편익", "추가 발전량", "공법", "비용", "smp 가정",
             "economics", "economic", "net benefit", "revenue", "cost", "method"],
    "need": ["비교하려면", "무엇이 필요", "뭐가 필요", "필요한 입력", "필요한가", "필요해", "필요합니까",
             "what do i need", "what is needed", "needed to", "required to", "requirements", "need to compare"],
    "econ_result": ["경제성", "순편익", "매출", "추가 발전량", "편익", "비교해", "economics", "net benefit", "revenue",
                    "additional generation", "compare the cost"],
    "gap": ["부족", "누락", "미수신", "빠진", "필요한 데이터", "받아야", "missing", "lacking", "not received", "still need",
            "which data", "what data"],
    "pinch": ["핀치", "어프로치", "pinch", "approach"],
    "pinch_result": ["결과", "값", "산출", "얼마", "왜", "result", "value", "why", "calculated", "temperature"],
    "reference": ["문헌", "참고 추정", "논문", "공개 자료", "공개 문헌", "경험값", "literature", "reference estimate",
                  "published", "rule of thumb", "paper"],
    "smp_data": ["실적", "최근", "연평균", "월평균", "작년", "지난", "얼마였", "평균", "추이", "recent", "average", "last year",
                 "history", "historical", "actual", "trend"],
    "perf": ["운전 상태", "상태가", "상태는", "상태를", "정상", "경보", "트립", "성능 손실", "손실", "회수 효과", "회복",
             "성능 평가 결과", "성능 결과", "status", "alarm", "trip", "normal", "loss", "recovery", "recover",
             "performance result"],
}

CONCEPT_WORDS = {
    "FOULING": ["오염", "파울링", "열 회수", "열회수", "열전달", "fouling", "foul", "dirty", "heat recovery", "heat transfer"],
    "PRESSURE": ["차압", "배압", "differential pressure", "back pressure", "backpressure", "δp", "Δp"],
    "STACK": ["굴뚝", "스택", "stack"],
    "PINCH_DEF": ["핀치", "어프로치", "pinch", "approach"],
    "HRSG_DEF": ["hrsg", "배열회수보일러", "배열 회수 보일러"],
    "SMP_DEF": ["smp"],
}


def concept_topics(q):
    q = q.lower()
    found = [t for t, words in CONCEPT_WORDS.items() if _has(q, [w.lower() for w in words])]
    # 다른 주제가 있으면 'HRSG' 라는 단어만으로 정의를 덧붙이지 않습니다.
    if len(found) > 1 and "HRSG_DEF" in found:
        found.remove("HRSG_DEF")
    return found[:3]


def classify(question):
    q = question.lower().strip()
    econ = _has(q, W["econ"])
    if _has(q, W["sensitive"]) and not (econ and _has(q, ["계산식", "formula"])):
        return SENSITIVE
    if _has(q, W["forecast"]):
        return OUT_OF_SCOPE
    if econ and _has(q, W["need"]):
        return ECON_REQUIREMENTS
    if "smp" in q and _has(q, W["smp_data"]) and not _has(q, ["경제성", "economics"]):
        return SMP_DATA
    if _has(q, W["econ_result"]) or (econ and _has(q, ["계산식", "formula", "입력", "input", "assum"])):
        return ECON_RESULT
    if _has(q, W["gap"]):
        return DATA_GAP
    if _has(q, W["pinch"]) and _has(q, W["pinch_result"]):
        return PINCH_RESULT
    if _has(q, W["reference"]):
        return REFERENCE_RESULT
    if "FOULING" in concept_topics(q):  # 'heat recovery' 의 'recover' 가 성능 결과로 잡히지 않도록 먼저 판정
        return CONCEPT
    if _has(q, W["perf"]):
        return PERF_RESULT
    if concept_topics(q):
        return CONCEPT
    return UNKNOWN
