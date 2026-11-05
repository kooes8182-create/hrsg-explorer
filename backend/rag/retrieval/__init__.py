"""검색 핵심 모듈 (Django 비의존).

corpus.py        코퍼스(문단)·문헌 정보 읽기, 코퍼스 해시
bm25.py          BM25 키워드 검색 (+ 선택: 한국어 용어 확장)
embedder.py      임베딩 인터페이스 — 로컬 BGE-M3 / (향후) Cloudflare Workers AI
vector_index.py  저장된 문단 벡터 + 코사인 유사도 전체 비교, 코퍼스·모델 일치 검사
hybrid.py        RRF 결합, 문헌당 최대 N 문단 선택, 단계별 추적 정보
metrics.py       Recall@k, MRR, 실패 원인 분류
"""
