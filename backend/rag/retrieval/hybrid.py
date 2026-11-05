"""하이브리드 검색: BM25 후보 + 벡터 후보 → RRF 결합 → 문헌당 최대 N 문단 → 최종 K 문단.

RRF(d) = Σ 1 / (rrf_k + 순위(d))   (BM25 점수와 코사인 유사도는 단위가 달라 더하지 않고 순위만 씁니다)
같은 문단은 문단 번호로 합쳐 양쪽 순위 기여를 모두 더합니다.
최종 선택: 결합 순위대로 보면서 이미 같은 문헌이 per_doc 개 뽑혔으면 건너뜁니다('문헌당 제한').
final_k 개가 차면 멈추고, 그 뒤 후보는 '최종 개수 초과'로 기록합니다.
후보가 부족하면 그만큼 적게 돌려줍니다 (중복·빈 문단으로 채우지 않음).

같은 선택 규칙(문헌당 제한, 최종 K)을 BM25 단독·벡터 단독에도 똑같이 적용해 세 방식을 비교합니다.
"""

import time
from dataclasses import asdict, dataclass

MODES = ("bm25", "vector", "hybrid")

SELECTED = "selected"
PER_DOC_LIMIT = "per_doc_limit"
BEYOND_FINAL = "beyond_final_k"


@dataclass(frozen=True)
class SearchConfig:
    bm25_k: int = 50
    vector_k: int = 50
    rrf_k: int = 60
    final_k: int = 8
    per_doc: int = 2

    def as_dict(self):
        return asdict(self)


def rrf_fuse(lists, rrf_k):
    """lists: {'bm25': [(idx, score), ...], 'vector': [...]} (각각 순위순) → 결합 순위순 목록."""
    merged = {}
    for name, ranked in lists.items():
        for rank, (idx, score) in enumerate(ranked, 1):
            e = merged.setdefault(idx, {"idx": idx, "ranks": {}, "scores": {}, "rrf": 0.0})
            e["ranks"][name] = rank
            e["scores"][name] = score
            e["rrf"] += 1.0 / (rrf_k + rank)
    # 동점이면 더 좋은 개별 순위, 그다음 문단 번호 순 (실행마다 같은 결과)
    return sorted(merged.values(), key=lambda e: (-e["rrf"], min(e["ranks"].values()), e["idx"]))


def select(entries, doc_of, final_k, per_doc):
    """결합(또는 단독) 순위 목록에 문헌당 제한과 최종 개수를 적용. 각 항목에 decision 을 붙입니다."""
    per = {}
    chosen = 0
    for e in entries:
        if chosen >= final_k:
            e["decision"] = BEYOND_FINAL
            continue
        doc = doc_of(e["idx"])
        if per.get(doc, 0) >= per_doc:
            e["decision"] = PER_DOC_LIMIT
            continue
        per[doc] = per.get(doc, 0) + 1
        chosen += 1
        e["decision"] = SELECTED
        e["final_rank"] = chosen
    return [e for e in entries if e["decision"] == SELECTED]


class Retriever:
    def __init__(self, corpus, bm25, vector_index=None, embedder=None, vector_unavailable_reason=None):
        self.corpus = corpus
        self.bm25 = bm25
        self.vindex = vector_index
        self.embedder = embedder
        self.vector_reason = vector_unavailable_reason

    @property
    def vector_ready(self):
        return self.vindex is not None and self.embedder is not None

    def doc_of(self, idx):
        return self.corpus.chunks[idx].doc_id

    def candidates(self, query, bm25_k, vector_k):
        """두 검색의 후보 목록과 소요 시간(초). 튜닝 때는 최대 K 로 한 번만 구하고 잘라 씁니다."""
        t0 = time.perf_counter()
        bm = self.bm25.search(query, bm25_k)
        t1 = time.perf_counter()
        out = {"bm25": bm, "vector": None, "time": {"bm25": t1 - t0}}
        if self.vector_ready:
            qv = self.embedder.embed([query])[0]  # 벡터 검색에는 원래 질문 그대로 (용어 확장 없음)
            t2 = time.perf_counter()
            out["vector"] = self.vindex.search(qv, vector_k)
            t3 = time.perf_counter()
            out["time"].update({"embed": t2 - t1, "vector": t3 - t2})
        return out

    def rank(self, cands, cfg, mode):
        """후보 → 한 방식의 전체 순위 목록(결정 포함)과 최종 목록, 소요 시간."""
        t = cands["time"]
        if mode == "bm25":
            entries = [{"idx": i, "ranks": {"bm25": r}, "scores": {"bm25": s}} for r, (i, s) in
                       enumerate(cands["bm25"][:cfg.bm25_k], 1)]
            elapsed = t["bm25"]
        elif mode == "vector":
            if cands["vector"] is None:
                return None
            entries = [{"idx": i, "ranks": {"vector": r}, "scores": {"vector": s}} for r, (i, s) in
                       enumerate(cands["vector"][:cfg.vector_k], 1)]
            elapsed = t["embed"] + t["vector"]
        elif mode == "hybrid":
            if cands["vector"] is None:
                return None
            t0 = time.perf_counter()
            entries = rrf_fuse({"bm25": cands["bm25"][:cfg.bm25_k], "vector": cands["vector"][:cfg.vector_k]},
                               cfg.rrf_k)
            elapsed = t["bm25"] + t["embed"] + t["vector"] + (time.perf_counter() - t0)
        else:
            raise ValueError(mode)
        for pos, e in enumerate(entries, 1):
            e["list_rank"] = pos  # 이 방식의 (결합 후) 순위
        final = select(entries, self.doc_of, cfg.final_k, cfg.per_doc)
        return {"mode": mode, "entries": entries, "final": final, "seconds": elapsed}

    def search(self, query, cfg, modes=MODES):
        cands = self.candidates(query, cfg.bm25_k, cfg.vector_k)
        return {m: self.rank(cands, cfg, m) for m in modes}, cands
