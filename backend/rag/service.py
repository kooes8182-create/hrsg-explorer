"""서버용 묶음: 코퍼스·BM25·벡터·임베딩 모델을 한 번만 읽어 두고 검색 결과를 화면용으로 바꿉니다.

BGE-M3 모델은 약 2.3GB 라 서버 시작 때가 아니라 첫 검색 때 불러옵니다(수십 초 걸릴 수 있음).
벡터 파일이 없거나 코퍼스와 맞지 않으면 벡터·하이브리드 검색을 끄고 이유를 알려 줍니다
(BM25 검색과 근거 확인은 계속 됩니다).
"""

import threading

from . import paths
from .retrieval.bm25 import BM25Index, load_expansion
from .retrieval.corpus import load_corpus
from .retrieval.hybrid import SearchConfig, Retriever
from .retrieval.vector_index import IndexMismatch, VectorIndex, read_meta

DEFAULT_CONFIG = SearchConfig()
CORPUS_LABEL = {"ko": "개인 프로토타입 코퍼스 (reference/papers 추출 — 공식 협업 코퍼스와 다른 자료)",
                "en": "Personal prototype corpus (extracted from reference/papers — not the official collaboration corpus)"}

_lock = threading.Lock()
_state = {"corpus": None, "retriever": None, "corpus_error": None, "vector_status": "not_loaded",
          "vector_reason": None}


def _load_base():
    if _state["corpus"] is not None or _state["corpus_error"]:
        return
    try:
        corpus = load_corpus(paths.CORPUS_DIR)
    except FileNotFoundError:
        _state["corpus_error"] = "코퍼스가 없습니다. python manage.py rag_build_corpus 를 실행하세요."
        return
    _state["corpus"] = corpus
    _state["retriever"] = Retriever(corpus, BM25Index([c.text for c in corpus.chunks],
                                                      load_expansion(paths.TERM_EXPANSION)))
    try:  # 무거운 모델 없이 파일 일치만 먼저 확인
        VectorIndex(paths.INDEX_DIR, corpus)
        _state["vector_status"] = "not_loaded"
    except (FileNotFoundError, IndexMismatch) as e:
        _state["vector_status"] = "unavailable"
        _state["vector_reason"] = str(e)


def _load_vectors():
    r = _state["retriever"]
    if r.vector_ready or _state["vector_status"] == "unavailable":
        return
    try:
        from .retrieval.embedder import get_embedder

        vindex = VectorIndex(paths.INDEX_DIR, _state["corpus"])
        emb = get_embedder()
        vindex.check_embedder(emb.settings())
        r.vindex, r.embedder = vindex, emb
        _state["vector_status"] = "ready"
    except (FileNotFoundError, IndexMismatch, NotImplementedError) as e:
        _state["vector_status"], _state["vector_reason"] = "unavailable", str(e)
    except Exception:  # 모델 파일 손상·메모리 부족 등 — 상세는 응답에 넣지 않음
        _state["vector_status"], _state["vector_reason"] = "unavailable", "임베딩 모델을 불러오지 못했습니다."


def get(load_vectors=True):
    with _lock:
        _load_base()
        if load_vectors and _state["retriever"] is not None:
            _load_vectors()
    return _state


def reset():
    """테스트·코퍼스 재생성 후 다시 읽기."""
    with _lock:
        _state.update(corpus=None, retriever=None, corpus_error=None, vector_status="not_loaded", vector_reason=None)


def info():
    s = get(load_vectors=False)
    c = s["corpus"]
    meta = read_meta(paths.INDEX_DIR) if c else None
    return {
        "corpus": None if c is None else {
            "label": CORPUS_LABEL, "prototype": True, "documents": len({x.doc_id for x in c.chunks}),
            "chunks": len(c), "hash": c.hash[:12]},
        "corpus_error": s["corpus_error"],
        "vector": {"status": s["vector_status"], "reason": s["vector_reason"],
                   "model": meta["embedding"]["model"] if meta else None,
                   "revision": (meta["embedding"]["revision"][:8] if meta else None),
                   "truncated_chunks": meta.get("truncated_count") if meta else None},
        "config": DEFAULT_CONFIG.as_dict(),
    }


def chunk_payload(corpus, idx):
    c = corpus.chunks[idx]
    d = corpus.doc(c.doc_id)
    return {"chunk_id": c.chunk_id, "doc_id": c.doc_id, "title": d.get("title"), "file_name": d.get("file_name"),
            "first_author": d.get("first_author"), "year": d.get("year"), "doi": d.get("doi"), "url": d.get("url"),
            "pdf_page": c.pdf_page, "printed_page": c.printed_page, "source_type": c.source_type, "text": c.text}


def entry_payload(corpus, e, with_text=True):
    out = chunk_payload(corpus, e["idx"]) if with_text else {"chunk_id": corpus.chunks[e["idx"]].chunk_id}
    out.update({"list_rank": e["list_rank"], "final_rank": e.get("final_rank"), "decision": e["decision"],
                "bm25_rank": e["ranks"].get("bm25"), "vector_rank": e["ranks"].get("vector"),
                "bm25_score": e["scores"].get("bm25"), "cosine": e["scores"].get("vector"), "rrf": e.get("rrf")})
    return out


def search(question, mode="hybrid", cfg=DEFAULT_CONFIG):
    """화면용 최종 문단. 하이브리드가 불가능하면 BM25 결과를 '대체'로 표시해 돌려줍니다."""
    s = get()
    if s["corpus"] is None:
        return {"error": s["corpus_error"]}
    runs, _ = s["retriever"].search(question, cfg, modes=("bm25", mode) if mode != "bm25" else ("bm25",))
    run, fallback = runs.get(mode), None
    if run is None:
        run, fallback = runs["bm25"], s["vector_reason"]
    return {"mode": run["mode"], "requested_mode": mode, "fallback_reason": fallback,
            "results": [entry_payload(s["corpus"], e) for e in run["final"]],
            "ms": round(run["seconds"] * 1000), "config": cfg.as_dict()}


def compare(question, cfg=DEFAULT_CONFIG):
    """개발용 비교: 세 방식의 최종 문단 + 각 후보의 순위·결정."""
    s = get()
    if s["corpus"] is None:
        return {"error": s["corpus_error"]}
    runs, _ = s["retriever"].search(question, cfg)
    corpus = s["corpus"]
    out = {"config": cfg.as_dict(), "vector_status": s["vector_status"], "vector_reason": s["vector_reason"],
           "modes": {}}
    for m, run in runs.items():
        if run is None:
            out["modes"][m] = None
            continue
        out["modes"][m] = {"ms": round(run["seconds"] * 1000),
                           "final": [entry_payload(corpus, e) for e in run["final"]],
                           # 결합/단독 목록 전체 (본문 없이 순위·결정만, 화면에서 접어 보기)
                           "entries": [dict(entry_payload(corpus, e, with_text=False),
                                            doc_id=corpus.chunks[e["idx"]].doc_id,
                                            pdf_page=corpus.chunks[e["idx"]].pdf_page)
                                       for e in run["entries"]]}
    return out


def chunks_by_ids(ids):
    """답변 생성용: 서버의 코퍼스에서 문단을 다시 찾습니다 (브라우저가 보낸 본문은 쓰지 않음)."""
    s = get(load_vectors=False)
    c = s["corpus"]
    if c is None:
        return None, []
    found, unknown = [], []
    for cid in ids:
        i = c.by_id.get(cid)
        (found.append(chunk_payload(c, i)) if i is not None else unknown.append(cid))
    return found, unknown
