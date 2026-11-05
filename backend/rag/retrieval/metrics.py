"""검색 평가: Recall@k, MRR, 실패 원인.

판정 기준 (협업안 p.7 정의를 따름 — 문헌 단위)
  - 정답 = 질문에 표시된 '정답 문헌' (같은 문헌의 어느 문단이든 정답으로 인정)
  - Recall@k = (최종 k 문단에 들어온 서로 다른 정답 문헌 수) / (그 질문의 정답 문헌 수)
      같은 문헌의 문단을 여러 개 찾아도 1개로 셉니다.
  - MRR = 1 / (최종 k 문단 중 정답 문헌의 문단이 처음 나온 위치), 없으면 0
  - 답이 없는 질문(answerable = N)은 평균에서 빼고 따로 기록합니다.
  - 근거 페이지는 실패 분석 참고용으로만 씁니다 (페이지 단위 지표는 계산하지 않음).

평가 파일의 정답 정보는 여기서만 쓰고, 검색(Retriever)에는 질문 문장만 넘깁니다.
"""

import csv
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from .hybrid import BEYOND_FINAL, PER_DOC_LIMIT

COLUMNS = ["qid", "split", "lang", "question", "answerable", "gold_doc_ids", "evidence_pages", "note"]


@dataclass
class EvalQuestion:
    qid: str
    split: str
    lang: str
    question: str
    answerable: bool
    gold_docs: list = field(default_factory=list)
    evidence: dict = field(default_factory=dict)  # doc_id -> [PDF 페이지]


def _pages(spec):
    """'A:3,5;B:12-13' → {'A': [3, 5], 'B': [12, 13]}"""
    out = {}
    for part in filter(None, (p.strip() for p in (spec or "").split(";"))):
        doc, _, pages = part.partition(":")
        nums = []
        for p in filter(None, (x.strip() for x in pages.split(","))):
            a, _, b = p.partition("-")
            nums.extend(range(int(a), int(b or a) + 1))
        out[doc.strip()] = nums
    return out


def load_eval(path, known_docs=None):
    """평가 CSV (UTF-8, BOM 허용) → (질문 목록, 경고 목록)."""
    questions, warnings = [], []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS[:6] if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"평가 파일에 열이 없습니다: {missing}")
        for row in reader:
            if not (row.get("qid") or "").strip() or row["qid"].startswith("#"):
                continue
            split = row["split"].strip().lower()
            lang = row["lang"].strip().lower()
            if split not in ("dev", "test") or lang not in ("ko", "en"):
                raise ValueError(f"{row['qid']}: split 은 dev/test, lang 은 ko/en 이어야 합니다.")
            answerable = row["answerable"].strip().upper() in ("Y", "YES", "TRUE", "1")
            gold = [d.strip() for d in (row["gold_doc_ids"] or "").split(";") if d.strip()]
            if answerable and not gold:
                raise ValueError(f"{row['qid']}: 답이 있는 질문인데 정답 문헌이 비어 있습니다.")
            if known_docs is not None:
                unknown = [d for d in gold if d not in known_docs]
                if unknown:
                    warnings.append(f"{row['qid']}: 코퍼스에 없는 정답 문헌 {unknown} (이 문헌은 찾을 수 없어 0으로 계산됨)")
            questions.append(EvalQuestion(row["qid"].strip(), split, lang, row["question"].strip(), answerable,
                                          gold, _pages(row.get("evidence_pages"))))
    ids = [q.qid for q in questions]
    if len(ids) != len(set(ids)):
        raise ValueError("평가 파일에 qid 중복이 있습니다.")
    return questions, warnings


def score_final(final_docs, gold):
    """final_docs: 최종 문단들의 문헌 ID (순위순). → (recall, rr, 찾은 정답 문헌, 첫 정답 위치)"""
    gold = set(gold)
    found = set(final_docs) & gold
    first = next((i for i, d in enumerate(final_docs, 1) if d in gold), None)
    return len(found) / len(gold), (1.0 / first if first else 0.0), sorted(found), first


def diagnose(gold_doc, run, cands_docs, bm25_final_docs, doc_of):
    """하이브리드 최종 결과에서 빠진 정답 문헌 하나의 원인."""
    in_bm25 = gold_doc in cands_docs["bm25"]
    in_vec = gold_doc in cands_docs["vector"]
    entries = [e for e in run["entries"] if doc_of(e["idx"]) == gold_doc]
    info = {"doc_id": gold_doc, "in_bm25_candidates": in_bm25, "in_vector_candidates": in_vec,
            "best_list_rank": entries[0]["list_rank"] if entries else None,
            "found_by_bm25_only": gold_doc in bm25_final_docs}
    if not entries:
        info["cause"] = "not_in_candidates"  # 두 검색 후보 어디에도 없음
    elif any(e["decision"] == PER_DOC_LIMIT for e in entries):
        info["cause"] = "per_doc_limit"  # 문헌별 제한·최종 선택 과정에서 제외
    elif all(e["decision"] == BEYOND_FINAL for e in entries):
        info["cause"] = "pushed_down_after_rrf"  # 후보에는 있었지만 결합 후 순위가 밀림
    else:
        info["cause"] = "other"
    return info


def summarize(rows, mode):
    """rows: 질문별 결과 → 전체·언어별 평균 (답이 있는 질문만)."""
    def agg(rs):
        rs = [r for r in rs if r["answerable"] and r["modes"].get(mode)]
        if not rs:
            return {"n": 0}
        rec = [r["modes"][mode]["recall"] for r in rs]
        rr = [r["modes"][mode]["rr"] for r in rs]
        secs = [r["modes"][mode]["seconds"] for r in rs]
        return {"n": len(rs), "recall": statistics.fmean(rec), "mrr": statistics.fmean(rr),
                "zero_recall": sum(1 for x in rec if x == 0),
                "ms_mean": statistics.fmean(secs) * 1000, "ms_median": statistics.median(secs) * 1000}
    return {"all": agg(rows), "ko": agg([r for r in rows if r["lang"] == "ko"]),
            "en": agg([r for r in rows if r["lang"] == "en"])}


def evaluate(retriever, questions, cfg, modes=("bm25", "vector", "hybrid"), cache=None):
    """질문별 결과 목록. 검색에는 q.question 만 넘깁니다.
    cache: {qid: 후보} — 튜닝 때 최대 후보 수로 한 번 구한 후보를 잘라 씁니다 (소요 시간도 처음 값)."""
    doc_of = retriever.doc_of
    rows = []
    for q in questions:
        if cache is not None and q.qid in cache:
            cands = cache[q.qid]
        else:
            cands = retriever.candidates(q.question, cfg.bm25_k, cfg.vector_k)
            if cache is not None:
                cache[q.qid] = cands
        runs = {m: retriever.rank(cands, cfg, m) for m in modes}
        cands_docs = {"bm25": {doc_of(i) for i, _ in cands["bm25"][:cfg.bm25_k]},
                      "vector": {doc_of(i) for i, _ in (cands["vector"] or [])[:cfg.vector_k]}}
        row = {"qid": q.qid, "lang": q.lang, "split": q.split, "question": q.question,
               "answerable": q.answerable, "gold": q.gold_docs, "modes": {}}
        finals = {}
        for m, run in runs.items():
            if run is None:
                row["modes"][m] = None
                continue
            docs = [doc_of(e["idx"]) for e in run["final"]]
            finals[m] = docs
            entry = {"final_docs": docs, "seconds": run["seconds"],
                     "top_score": run["final"][0]["scores"] if run["final"] else None}
            if q.answerable:
                entry["recall"], entry["rr"], entry["found"], entry["first_rank"] = score_final(docs, q.gold_docs)
            row["modes"][m] = entry
        hyb = runs.get("hybrid")
        if q.answerable and hyb is not None:
            missing = [d for d in q.gold_docs if d not in set(finals["hybrid"])]
            row["failures"] = [diagnose(d, hyb, cands_docs, set(finals.get("bm25", [])), doc_of) for d in missing]
        rows.append(row)
    return rows


def write_template(path):
    p = Path(path)
    with open(p, "w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f).writerow(COLUMNS)
