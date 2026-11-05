"""답변 생성 인터페이스. 데모 Provider 와 (향후) LLM Provider 가 같은 형식으로 답합니다."""

from dataclasses import dataclass, field


@dataclass
class AnswerContext:
    """답변에 쓸 수 있는 근거 전부. 이 밖의 정보(원문 PDF, 비공개 계산식, 비밀값)는 Provider 에 넘기지 않습니다."""

    case_id: int
    case_name: str
    lang: str  # 'ko' | 'en' — 질문 언어
    checklist: dict  # 진행률, 미수신 항목(이름·필수 여부), 수신 후 미검증 수
    economics_inputs: dict  # 현재 저장된 경제성 가정값 (무엇이 비었는지 안내용)
    results: dict  # kind -> {"result", "meta", "stale"} | None  (stale 결과는 수치 인용 금지)


@dataclass
class Answer:
    text: str
    intent: str
    answer_type: str  # "DEMO_TEMPLATE" (향후 "LLM")
    citations: list = field(default_factory=list)  # 근거: checklist / result / document / app_rule
    cards: list = field(default_factory=list)  # 결과 카드: 저장된(무효 아닌) 결과 수치만


class AnswerProvider:
    answer_type = ""

    def answer(self, question: str, ctx: AnswerContext) -> Answer:
        raise NotImplementedError
