"""평가 명령(rag_eval, rag_tune) 공통: 자료 읽기, 결과 표 출력, 실행 기록 저장."""

import hashlib
import json
from datetime import datetime

from django.core.management.base import CommandError

from . import paths
from .retrieval.bm25 import BM25Index, load_expansion
from .retrieval.corpus import load_corpus
from .retrieval.embedder import get_embedder
from .retrieval.hybrid import Retriever
from .retrieval.metrics import load_eval
from .retrieval.vector_index import VectorIndex

NOT_COMPARABLE = ("※ 이 수치는 개인 프로토타입 코퍼스와 이 평가 파일 기준입니다. 협업안의 BM25 기준선"
                  "(공식 corpus.json·평가 질문 100개, recall@8 0.73 등)과는 코퍼스·평가셋이 달라 직접 비교할 수 없습니다.")
CAUSES = {"not_in_candidates": "검색 후보에 없음", "pushed_down_after_rrf": "후보에는 있었지만 RRF 결합 후 밀림",
          "per_doc_limit": "문헌별 제한·최종 선택에서 제외", "other": "기타"}


def load_questions(path, split):
    if not path.exists():
        raise CommandError(
            f"평가 파일이 없습니다: {path}\n"
            f"  → data/eval/eval_questions.template.csv 를 eval_questions.csv 로 복사해 질문·정답 문헌·근거 페이지·dev/test 를 채우세요.\n"
            f"  (평가 파일이 없으면 성능 수치를 계산하지 않습니다.)")
    corpus = load_corpus(paths.CORPUS_DIR)
    questions, warnings = load_eval(path, known_docs=set(corpus.documents))
    sel = [q for q in questions if q.split == split]
    if not sel:
        raise CommandError(f"평가 파일에 split={split} 질문이 없습니다.")
    return corpus, sel, warnings


def build_retriever(corpus):
    vindex = VectorIndex(paths.INDEX_DIR, corpus)  # 코퍼스와 벡터가 다르면 여기서 중단
    emb = get_embedder()
    vindex.check_embedder(emb.settings())
    bm = BM25Index([c.text for c in corpus.chunks], load_expansion(paths.TERM_EXPANSION))
    return Retriever(corpus, bm, vindex, emb), vindex.meta


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def fmt(s):
    if not s.get("n"):
        return "      -        -    (질문 0)"
    return f"{s['recall']:7.3f}  {s['mrr']:7.3f}  {s['n']:4d}  {s['zero_recall']:4d}  {s['ms_mean']:7.1f}"


def print_summary(w, summaries):
    w("방식     구분   Recall@8     MRR  질문  0건   평균ms")
    for mode, s in summaries.items():
        for part in ("all", "ko", "en"):
            w(f"{mode:8} {part:4} {fmt(s[part])}")
    w("  (0건 = 정답 문헌을 하나도 찾지 못한 질문 수, ms = 질문 임베딩 포함 검색 시간)")


def save_run(kind, payload):
    paths.RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out = paths.RUNS_DIR / f"{datetime.now():%Y%m%d_%H%M%S}_{kind}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return out
