"""AI 질문하기 (현재: 템플릿 기반 데모 답변, 실제 LLM 미연결).

    base.py     답변 생성 인터페이스(AnswerProvider)와 자료형
    intents.py  언어 감지·질문 의도 분류 (한/영 키워드)
    sources.py  답변에 쓸 수 있는 일반 설명 = HRSG 계획서에서 확인한 범위만 (자료명·페이지)
    demo.py     TemplateDemoProvider (데모 답변 생성)
    service.py  컨텍스트 구성·Provider 선택·이력 저장 (실제 LLM 연결 위치)
"""
