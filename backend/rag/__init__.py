"""논문 근거 RAG 챗봇 (개인 프로토타입).

retrieval/  검색 핵심 (Django 비의존 — 협업 제출 후보 코드)
prototype/  reference/papers PDF → 프로토타입 코퍼스 (개인 실험용, 공식 협업 코퍼스 아님)
answer.py   검색 문단 → Gemini 답변 생성 (서버 전용)
service.py  코퍼스·인덱스를 한 번만 읽어 두는 서버용 묶음
"""
