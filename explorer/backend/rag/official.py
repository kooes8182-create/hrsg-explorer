"""공식 평가셋 v1 검색 — recall(test 0.864) 을 측정한 절차를 그대로 재현합니다.

1) BM25: 평가셋 원본 retrieve.js 의 점수식·토큰화·KO_TERMS 확장을 한 줄씩 옮긴 것 (cap 적용 전 순위)
2) Dense: BGE-M3(rev 5617a9f6) 질문 임베딩 · 정규화 → 공식 passages.npy 와 코사인, 같은 값이면 인덱스 오름차순
3) 결합: wrrf-v1 (tools/official_eval/run_test_locked.py 의 fuse 와 같은 규칙)
4) cap: 같은 참고문헌 최대 2개, 상위 8개 (retrieve.js 와 같은 규칙)
원본 파일(corpus.json, eval_questions.json, .cache/official)은 읽기만 합니다. 이식이 맞는지는 rag_verify 명령으로 100문항 순위 일치를 확인합니다.
"""

import hashlib
import json
import math
import os
import re
import threading
import time
from pathlib import Path

import numpy as np
from django.conf import settings

HRSG = Path(settings.BASE_DIR).resolve().parents[1]  # explorer/backend → HRSG


def _p(env, default):
    v = os.environ.get(env)
    return Path(v) if v else default


CORPUS = _p("RAG_OFFICIAL_CORPUS", HRSG / "hrsg_eval_set_v1/App/web-server/data/corpus.json")
QUESTIONS = _p("RAG_OFFICIAL_QUESTIONS", HRSG / "hrsg_eval_set_v1/App/tools/eval_questions.json")
VECTORS = _p("RAG_OFFICIAL_VECTORS", HRSG / ".cache/official/bge-m3")
LOCKED_FILE = HRSG / "tools/official_eval/locked_config.json"

# 운영 설정 = test 전에 확정한 설정 (바꾸지 않음). 실험 설정 = 프롬프트의 동일 가중 RRF (dev 비교용).
LOCKED = json.loads(LOCKED_FILE.read_text(encoding="utf-8")) if LOCKED_FILE.exists() else None
CONFIGS = {
    "locked": {"label": {"ko": "확정 설정 (test 0.864 측정)", "en": "Locked (test 0.864)"}, "vector_weight": 0.7,
               "bm25_k": 30, "vector_k": 50, "rrf_k": 60, "final_k": 8, "per_ref_cap": 2, "validated": True},
    "equal40": {"label": {"ko": "실험: 동일 가중 RRF 40/40 (프롬프트)", "en": "Experiment: equal-weight RRF 40/40 (prompt)"},
                "vector_weight": 0.5, "bm25_k": 40, "vector_k": 40, "rrf_k": 60, "final_k": 8, "per_ref_cap": 2, "validated": False},
}
if LOCKED:  # 파일 값이 원본 — 위 숫자와 다르면 파일을 따릅니다
    CONFIGS["locked"].update({k: LOCKED[k] for k in ("vector_weight", "bm25_k", "vector_k", "rrf_k", "final_k")})
    CONFIGS["locked"]["per_ref_cap"] = LOCKED["per_ref_cap"]

# ---------------------------------------------------------------- BM25 (retrieve.js 이식)
STOP = frozenset("a an and are as at be by for from how in is it of on or that the this to was what when where which why with does do can "
                 "than then there these those their its into not no".split(" "))
KO_TERMS = [("배열회수", "hrsg heat recovery steam generator"), ("보일러", "boiler hrsg"), ("과열기", "superheater"), ("재열", "reheat reheater"),
            ("증발기", "evaporator"), ("절탄기", "economizer"), ("드럼", "drum"), ("핀치", "pinch"), ("어프로치", "approach"), ("연돌", "stack"),
            ("굴뚝", "stack"), ("배기", "exhaust gas"), ("가스터빈", "gas turbine"), ("증기터빈", "steam turbine"), ("터빈", "turbine"),
            ("복수기", "condenser"), ("복수", "condensate"), ("급수", "feedwater"), ("펌프", "pump"), ("파울링", "fouling"), ("오염", "fouling"),
            ("부식", "corrosion"), ("유동가속", "flow accelerated corrosion fac"), ("탈설계", "off-design part load"),
            ("부분부하", "part load off-design"), ("설계", "design"), ("열전달", "heat transfer"), ("전열면", "surface area ua"),
            ("핀튜브", "finned tube fin"), ("튜브", "tube"), ("엑서지", "exergy"), ("효율", "efficiency"), ("이슬점", "dew point"),
            ("순환", "circulation"), ("압력", "pressure"), ("온도", "temperature"), ("유량", "flow"), ("증기", "steam"), ("포화", "saturation"),
            ("스티밍", "steaming"), ("감온", "attemperation attemperator"), ("덕트버너", "duct burner supplementary firing"),
            ("보조연소", "supplementary firing duct burner"), ("기동", "startup start-up"), ("열응력", "thermal stress"),
            ("복합화력", "combined cycle"), ("복합발전", "combined cycle"), ("물성", "properties"), ("비열", "heat capacity cp"),
            ("엔탈피", "enthalpy"), ("손실", "loss"), ("청소", "cleaning"), ("세정", "cleaning"), ("플래싱", "flashing"),
            ("다압력", "multi-pressure"), ("삼압", "triple-pressure"), ("3압력", "triple-pressure"), ("포집", "capture co2"), ("최적화", "optimization")]
_NON = re.compile(r"[^a-z0-9°.+\- ]+")
_WS = re.compile(r"\s+")
_HANGUL = re.compile(r"[가-힣]")


def tokens(s):
    # JS: toLowerCase → 허용 문자 외 공백 → 공백 분할 → 길이 2 이상, 불용어 제외
    return [t for t in _WS.split(_NON.sub(" ", str(s).lower())) if len(t) > 1 and t not in STOP]


def expand_ko(s):
    return s + " " + " ".join(e for k, e in KO_TERMS if k in s) if _HANGUL.search(s) else s


def matched_terms(s):
    """화면 표시용: 질문에서 찾은 한국어 기술 용어 → 영어 매핑"""
    return [{"ko": k, "en": e} for k, e in KO_TERMS if k in s] if _HANGUL.search(s) else []


class BM25:
    def __init__(self, passages):
        self.df, self.docs = {}, []
        for p in passages:
            tf = {}
            for w in tokens(p["text"]):
                tf[w] = tf.get(w, 0) + 1
            for w in tf:
                self.df[w] = self.df.get(w, 0) + 1
            self.docs.append((tf, sum(tf.values())))
        self.N = len(self.docs)
        self.avg = sum(n for _, n in self.docs) / max(1, self.N)

    def rank(self, q):
        """cap 적용 전 순위 [(index, score)]. 점수 > 0, 내림차순 (같은 점수는 인덱스 순서 — JS 안정 정렬과 같음)."""
        terms = list(dict.fromkeys(tokens(expand_ko(q))))
        N, avg, df = self.N, self.avg, self.df
        out = []
        for i, (tf, ln) in enumerate(self.docs):
            s = 0.0
            for w in terms:
                f = tf.get(w)
                if not f:
                    continue
                idf = math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5))
                s += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * ln / avg))
            if s > 0:
                out.append((i, s))
        out.sort(key=lambda x: -x[1])
        return out


def fuse(bm_rank, vec_rank, alpha, kb, kv, kr):
    """wrrf-v1: score = (1−α)/(k+rank_bm25) + α/(k+rank_dense). 같은 점수 → 더 좋은 단독 순위 → 인덱스."""
    wb, wv = 1 - alpha, alpha
    score, rb, rv = {}, {}, {}
    if wb > 0:
        for r, i in enumerate(bm_rank[:kb], 1):
            rb[i] = r
            score[i] = score.get(i, 0) + wb / (kr + r)
    if wv > 0:
        for r, i in enumerate(vec_rank[:kv], 1):
            rv[i] = r
            score[i] = score.get(i, 0) + wv / (kr + r)
    inf = float("inf")
    order = sorted((i for i in score if score[i] > 0), key=lambda i: (-score[i], min(rb.get(i, inf), rv.get(i, inf)), i))
    return order, score, rb, rv


def cap(order, passages, k=8, per=2):
    count, out, skipped = {}, [], []
    for i in order:
        r = passages[i]["ref"]
        if count.get(r, 0) >= per:
            skipped.append(i)
            continue
        count[r] = count.get(r, 0) + 1
        out.append(i)
        if len(out) >= k:
            break
    return out, skipped


# ---------------------------------------------------------------- 서비스 상태 (한 번만 읽음)
_lock = threading.Lock()
_state = {"corpus": None, "bm25": None, "P": None, "model": None, "error": None, "vector": "not_loaded", "vector_reason": None,
          "corpus_sha": None, "loading": False}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_base():
    if _state["corpus"] is not None or _state["error"]:
        return
    try:
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    except FileNotFoundError:
        _state["error"] = f"공식 corpus 파일이 없습니다: {CORPUS}"
        return
    _state["corpus"], _state["corpus_sha"] = corpus, sha256(CORPUS)
    _state["bm25"] = BM25(corpus["passages"])
    # 벡터 파일이 corpus 와 맞는지 (해시·행 대조) 먼저 확인 — 모델은 첫 질의 때
    try:
        meta = json.loads((VECTORS / "passages_meta.json").read_text(encoding="utf-8"))
        rows = meta["rows"]
        ok = (meta["corpus_sha256"] == _state["corpus_sha"] and len(rows) == len(corpus["passages"]) and all(
            r["ref"] == p["ref"] and r["page"] == p.get("page") and r["kind"] == p["kind"]
            and r["text_sha1"] == hashlib.sha1(p["text"].encode()).hexdigest() for r, p in zip(rows, corpus["passages"])))
        if not ok:
            raise ValueError("벡터 파일이 corpus 와 맞지 않습니다")
        if LOCKED and meta["settings"]["revision"] != LOCKED["revision"]:
            raise ValueError("벡터를 만든 모델 버전이 확정 설정과 다릅니다")
        _state["meta"] = meta
        _state["P"] = np.load(VECTORS / "passages.npy")
    except (FileNotFoundError, ValueError, KeyError) as e:
        _state["vector"], _state["vector_reason"] = "unavailable", str(e)


def _load_model():
    if _state["model"] is not None or _state["vector"] == "unavailable":
        return
    try:
        import torch
        from sentence_transformers import SentenceTransformer

        s = _state["meta"]["settings"]
        device = os.environ.get("RAG_EMBED_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
        # 확정 리비전으로 고정 (로컬 캐시 사용 — 문서·질문을 외부로 보내지 않음)
        model = SentenceTransformer(s["model"], device=device, revision=s["revision"], local_files_only=True)
        model.max_seq_length = s["max_length"]
        model.encode([s["query_prefix"] + "warm up"], normalize_embeddings=True)
        _state["model"], _state["device"], _state["vector"] = model, device, "ready"
    except Exception as e:  # 모델 파일 없음·메모리 부족 등 → BM25 로 대체
        _state["vector"], _state["vector_reason"] = "unavailable", f"임베딩 모델을 불러오지 못했습니다 ({type(e).__name__})"


def get(load_model=True):
    with _lock:
        _load_base()
        if load_model and _state["corpus"] is not None:
            _load_model()
    return _state


def dense_rank(q, top=200):
    s = _state["meta"]["settings"]
    v = _state["model"].encode([s["query_prefix"] + q], normalize_embeddings=True, convert_to_numpy=True)[0].astype(np.float32)
    sims = _state["P"] @ v
    idx = np.argpartition(-sims, top - 1)[:top]
    idx = idx[np.lexsort((idx, -sims[idx]))]
    return [int(i) for i in idx], sims


def run(question, config="locked", modes=("bm25", "dense", "hybrid")):
    """세 방식의 순위 계산. Dense 가 불가능하면 dense/hybrid 는 None (BM25 대체는 호출한 쪽에서 표시)."""
    st = get()
    if st["corpus"] is None:
        raise RuntimeError(st["error"])
    cfg = CONFIGS[config]
    passages = st["corpus"]["passages"]
    t0 = time.perf_counter()
    bm = st["bm25"].rank(question)
    bm_order = [i for i, _ in bm]
    bm_score = dict(bm)
    t1 = time.perf_counter()
    out = {"config": config, "terms": matched_terms(question), "timing": {"bm25_ms": round((t1 - t0) * 1000, 1)}}
    dense_order, sims = (None, None)
    if st["vector"] == "ready" and ("dense" in modes or "hybrid" in modes):
        dense_order, sims = dense_rank(question)
        out["timing"]["dense_ms"] = round((time.perf_counter() - t1) * 1000, 1)
    k, per = cfg["final_k"], cfg["per_ref_cap"]

    def pack(order, fused=None, rb=None, rv=None):
        final, skipped = cap(order, passages, k, per)
        return {"final": [{"i": i, "rank": n + 1, "bm25_rank": (rb or {}).get(i) if rb is not None else (bm_order.index(i) + 1 if i in bm_score else None),
                           "dense_rank": (rv or {}).get(i) if rv is not None else None,
                           "bm25_score": round(bm_score[i], 4) if i in bm_score else None,
                           "cosine": round(float(sims[i]), 4) if sims is not None else None,
                           "rrf": round(fused[i], 6) if fused else None} for n, i in enumerate(final)],
                "skipped_by_cap": len(skipped),  # 상위 k 개를 채우는 동안 '참고문헌당 2개' 규칙으로 건너뛴 문단 수
                "candidates": len(order)}

    out["bm25"] = pack(bm_order) if "bm25" in modes else None
    if dense_order is not None:
        rv_full = {i: r for r, i in enumerate(dense_order, 1)}
        out["dense"] = pack(dense_order, rv=rv_full) if "dense" in modes else None
        if "hybrid" in modes:
            order, fused, rb, rv = fuse(bm_order, dense_order, cfg["vector_weight"], cfg["bm25_k"], cfg["vector_k"], cfg["rrf_k"])
            out["hybrid"] = pack(order, fused, rb, rv)
            out["hybrid_order"] = order
    else:
        out["dense"] = out["hybrid"] = None
        out["fallback_reason"] = st["vector_reason"] or "임베딩 서비스를 사용할 수 없습니다."
    out["bm25_order"] = bm_order
    out["dense_order"] = dense_order
    return out


def passage_payload(i, extra=None):
    c = _state["corpus"]
    p = c["passages"][i]
    r = c["refs"].get(p["ref"], {})
    return {"i": i, "ref": p["ref"], "title": r.get("title") or p["ref"], "authors": r.get("authors") or [], "year": r.get("year"),
            "doi": r.get("doi"), "venue": r.get("venue"), "page": p.get("page"), "kind": p["kind"], "text": p["text"], **(extra or {})}


def info():
    st = get(load_model=False)
    c = st["corpus"]
    return {
        "corpus": None if c is None else {"documents": len(c["refs"]), "passages": len(c["passages"]), "sha256": st["corpus_sha"][:12],
                                         "file": str(CORPUS.relative_to(HRSG)) if CORPUS.is_relative_to(HRSG) else str(CORPUS), "official": True},
        "error": st["error"],
        "vector": {"status": st["vector"], "reason": st["vector_reason"], "device": st.get("device"),
                   "model": st.get("meta", {}).get("settings", {}).get("model"), "revision": (st.get("meta", {}).get("settings", {}).get("revision") or "")[:8]},
        "configs": CONFIGS, "locked": LOCKED,
    }
