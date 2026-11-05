"""질문 처리 서비스: 컨텍스트 구성 → Provider 로 답변 생성 → 이력 저장.

[실제 LLM 연결 위치]  get_provider()
  1) qa/llm.py 에 LLMProvider(AnswerProvider) 를 구현합니다. 입력은 AnswerContext 만 사용합니다
     (원문 PDF·비공개 계산식·비밀값을 프롬프트에 넣지 않음). 답변의 수치는 ctx.results 값만 허용하도록 검증합니다.
  2) backend/.env 에 QA_PROVIDER=llm, LLM_API_KEY=..., LLM_MODEL=... 을 설정합니다.
  3) get_provider() 에서 QA_PROVIDER 가 'llm' 이고 키가 있을 때만 LLMProvider 를 돌려줍니다.
  현재는 구현되어 있지 않으므로 환경변수와 관계없이 항상 데모 Provider 를 씁니다. (specs/06 §7)
"""

from core import checklist_seed as seed
from core.evaluation import economics_values, results as case_results
from core.models import ChecklistItem, QuestionLog
from core.services import progress

from .demo import TemplateDemoProvider
from .intents import detect_lang
from .base import AnswerContext

MAX_QUESTION = 500

SUGGESTIONS = {
    "ko": [
        "현재 평가에 어떤 데이터가 부족한가요?",
        "이 경제성 결과는 어떤 입력값으로 계산됐나요?",
        "세정 공법별 비용을 비교하려면 무엇이 필요한가요?",
        "튜브 오염이 열 회수 성능에 어떤 영향을 주나요?",
    ],
    "en": [
        "What data is missing for the current evaluation?",
        "Which inputs were used for this economics result?",
        "What do I need to compare cleaning costs by method?",
        "How does tube fouling affect heat recovery performance?",
    ],
}
# 계산 결과 화면의 '이 결과 질문하기' 버튼이 채우는 질문
ABOUT_RESULT = {
    "PERFORMANCE": {"ko": "이 성능 평가 결과의 운전 상태와 손실·회수 효과는 어떻게 나왔나요?",
                    "en": "How were the status, loss and recovery in this performance result obtained?"},
    "ECONOMICS": {"ko": SUGGESTIONS["ko"][1], "en": SUGGESTIONS["en"][1]},
    "PINCH_APPROACH": {"ko": "핀치 포인트 결과는 어떻게 계산됐나요?",
                       "en": "How was the pinch point result calculated?"},
    "REFERENCE": {"ko": "문헌 기반 참고 추정으로 출력 손실은 어느 정도인가요?",
                  "en": "What output loss does the literature-based reference estimate give?"},
}


def get_provider():
    """실제 LLM 연결 위치. 현재는 항상 템플릿 데모 Provider (LLM 미연결)."""
    return TemplateDemoProvider()


def provider_status():
    p = get_provider()
    return {"answer_type": p.answer_type, "llm_connected": False}


def build_context(case, lang):
    items = list(case.checklist_items.all())
    required_missing = {"PERFORMANCE": [], "PINCH_APPROACH": []}
    for i in items:
        if i.status != ChecklistItem.Status.MISSING:
            continue
        for func, req in seed.required_for(i.key).items():
            if req:
                required_missing[func].append({"ko": i.name_ko, "en": i.name_en})
    return AnswerContext(
        case_id=case.id,
        case_name=case.name,
        lang=lang,
        checklist={"progress": progress(items), "required_missing": required_missing},
        economics_inputs=economics_values(case.calc_input),
        results=case_results(case),
    )


def ask(case, question):
    lang = detect_lang(question)
    answer = get_provider().answer(question, build_context(case, lang))
    return QuestionLog.objects.create(
        case=case, lang=lang, question=question, answer=answer.text, answer_type=answer.answer_type,
        intent=answer.intent, referenced={"citations": answer.citations, "cards": answer.cards},
    )
