"""업로드 문헌 범위 검색. 공식 검색과 같은 BM25 이식·BGE-M3·확정 결합 설정을 쓰지만 인덱스는 따로입니다.
이 범위는 정답 라벨이 없어 recall 이 측정되지 않았습니다 (화면에 '측정되지 않은 범위'로 표시)."""

import threading

import numpy as np

from rag import official

from .models import PaperChunk

_lock = threading.Lock()
_idx = {"rows": None, "bm25": None, "P": None, "ids": None}


def reset():
    with _lock:
        _idx.update(rows=None, bm25=None, P=None, ids=None)


def _load():
    with _lock:
        if _idx["rows"] is not None:
            return _idx
        rows = list(PaperChunk.objects.filter(paper__status="READY").select_related("paper").order_by("paper_id", "idx"))
        _idx["rows"] = rows
        _idx["bm25"] = official.BM25([{"text": r.text} for r in rows]) if rows else None
        vec = [(i, np.frombuffer(r.vector, dtype=np.float32)) for i, r in enumerate(rows) if r.vector]
        _idx["ids"] = [i for i, _ in vec]
        _idx["P"] = np.stack([v for _, v in vec]) if vec else None
        return _idx


def stats():
    ix = _load()
    rows = ix["rows"]
    return {"papers": len({r.paper_id for r in rows}), "chunks": len(rows), "embedded": len(ix["ids"] or [])}


def payload(r, extra=None):
    p = r.paper
    return {"i": r.id, "ref": f"upload:{p.id}", "title": p.title, "authors": p.authors, "year": p.year, "doi": p.doi or None,
            "venue": None, "page": r.page, "kind": "text", "text": r.text, "scope": "UPLOAD", **(extra or {})}


def search(question, k=3):
    """업로드 범위 상위 k (문헌당 최대 2). 의미 검색이 안 되면 BM25 만."""
    ix = _load()
    if not ix["rows"]:
        return []
    cfg = official.CONFIGS["locked"]
    bm = ix["bm25"].rank(question)
    bm_order = [i for i, _ in bm]
    bm_score = dict(bm)
    st = official.get()
    dense_order, sims = None, None
    if st["vector"] == "ready" and ix["P"] is not None:
        s = st["meta"]["settings"]
        v = st["model"].encode([s["query_prefix"] + question], normalize_embeddings=True, convert_to_numpy=True)[0].astype(np.float32)
        sc = ix["P"] @ v
        order = np.argsort(-sc, kind="stable")
        dense_order = [ix["ids"][j] for j in order]
        sims = {ix["ids"][j]: float(sc[j]) for j in range(len(sc))}
    if dense_order is None:
        order, fused, rb, rv = bm_order, None, {i: n for n, i in enumerate(bm_order, 1)}, {}
    else:
        order, fused, rb, rv = official.fuse(bm_order, dense_order, cfg["vector_weight"], cfg["bm25_k"], cfg["vector_k"], cfg["rrf_k"])
    rows = ix["rows"]
    final, _ = official.cap(order, [{"ref": r.paper_id} for r in rows], k, cfg["per_ref_cap"])
    return [payload(rows[i], {"rank": n + 1, "bm25_rank": rb.get(i), "dense_rank": rv.get(i) if rv else None,
                              "bm25_score": round(bm_score[i], 4) if i in bm_score else None,
                              "cosine": round(sims[i], 4) if sims and i in sims else None,
                              "rrf": round(fused[i], 6) if fused else None}) for n, i in enumerate(final)]
