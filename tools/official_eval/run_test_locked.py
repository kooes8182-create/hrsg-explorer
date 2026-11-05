"""확정 설정(locked_config.json)으로 공식 평가셋 v1 전체(100문항, test 포함)를 한 번 채점한다.

- 원본 eval_questions.json 을 그대로 쓴다(SHA256 확인). 설정은 locked_config.json 에서만 읽는다.
- passage 벡터는 dev 실험 때 만든 캐시를 재사용하되, 모델·리비전·corpus 해시·ref/page/kind/본문 해시가 같은지 확인한다.
- 질문은 dev 실험과 같은 방식(예열 후 한 개씩, 접두사 없음)으로 임베딩한다.
- 채점: 공식 채점 복사본 + lookup_retrieve.js(원본과 같은 cap). 기준선은 원본 eval_retrieval.mjs 를 그대로 실행.
- 문항별 test 결과는 출력하지 않고, 공식 문항 점수를 그룹별로 평균한 값만 낸다.
- dev 부분이 dev 실험 결과와 같은지 확인한다(같은 설정·같은 입력이면 같아야 함).

실행 (HRSG 폴더에서, 백엔드 끈 상태): backend/.venv/bin/python tools/official_eval/run_test_locked.py
"""

import csv
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EVAL = ROOT / "hrsg_eval_set_v1/App/tools/eval_questions.json"
CORPUS = ROOT / "hrsg_eval_set_v1/App/web-server/data/corpus.json"
EVAL_SHA = "7a4744dab9255454f7e8f4926327faa0a7eacf8851377016dc005ce3d7393d25"
WORK = ROOT / ".cache/official/test_locked"
OUT = ROOT / "data/official_eval"
LOCK = json.loads((HERE / "locked_config.json").read_text(encoding="utf-8"))


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def fuse(bm_rank, vec_rank, alpha, kb, kv, kr):
    """run_experiments.py 의 fuse() 와 같은 규칙 (wrrf-v1)."""
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
    return sorted((i for i in score if score[i] > 0), key=lambda i: (-score[i], min(rb.get(i, inf), rv.get(i, inf)), i))


def groups(result):
    """공식 채점 출력의 문항별 점수(recall, hit, rr, page)를 그룹별로 평균 (공식 summary 와 같은 평균 방식)."""
    rows = [q for q in result["questions"] if q["answerable"]]
    def summ(rs):
        wp = [r for r in rs if r["page"] is not None]
        m = lambda xs, k: sum(x[k] for x in xs) / len(xs) if xs else None
        return {"n": len(rs), "recall": m(rs, "recall"), "hit": m(rs, "hit"), "mrr": m(rs, "rr"),
                "page": m(wp, "page"), "page_n": len(wp)}
    g = {}
    for split in ("all", "dev", "test"):
        for lang in ("all", "ko", "en"):
            g[f"{split}/{lang}"] = summ([r for r in rows if (split == "all" or r["split"] == split)
                                         and (lang == "all" or r["lang"] == lang)])
    return g


def main():
    assert sha256(EVAL) == EVAL_SHA, "원본 평가셋 해시 불일치"
    WORK.mkdir(parents=True, exist_ok=True)
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    keys = [{"ref": p["ref"], "page": p.get("page"), "kind": p["kind"]} for p in corpus["passages"]]
    questions = json.loads(EVAL.read_text(encoding="utf-8"))

    # 1) 공식 BM25 cap 전 순위 (전체 문항)
    bm_file = WORK / "bm25_candidates.all.json"
    subprocess.run(["node", str(HERE / "bm25_candidates.mjs"), "--questions", str(EVAL), "--out", str(bm_file)],
                   cwd=ROOT, check=True)
    BM = {r["question"]: [x["i"] for x in r["ranking"]] for r in json.loads(bm_file.read_text())["questions"]}

    # 2) 확정 모델로 질문 임베딩 (passage 벡터 캐시 대조 후 재사용)
    import torch
    from sentence_transformers import SentenceTransformer

    mdir = ROOT / ".cache/official" / LOCK["model_key"]
    pm = json.loads((mdir / "passages_meta.json").read_text(encoding="utf-8"))
    rows = [{"ref": r["ref"], "page": r["page"], "kind": r["kind"]} for r in pm["rows"]]
    text_sha = [hashlib.sha1(p["text"].encode()).hexdigest() for p in corpus["passages"]]
    assert pm["corpus_sha256"] == sha256(CORPUS) and rows == keys and [r["text_sha1"] for r in pm["rows"]] == text_sha
    assert pm["settings"]["model"] == LOCK["model"] and pm["settings"]["revision"] == LOCK["revision"]
    P = np.load(mdir / "passages.npy")
    s = pm["settings"]
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = SentenceTransformer(s["model"], device=device)
    model.max_seq_length = s["max_length"]
    model.encode([s["query_prefix"] + "warm up"], normalize_embeddings=True)
    VEC, lat = {}, []
    for q in questions:
        t0 = time.perf_counter()
        v = model.encode([s["query_prefix"] + q["question"]], normalize_embeddings=True, convert_to_numpy=True)[0]
        sims = P @ v.astype(np.float32)
        top = np.argpartition(-sims, 199)[:200]
        VEC[q["question"]] = [int(i) for i in top[np.lexsort((top, -sims[top]))]]
        lat.append((time.perf_counter() - t0) * 1000)

    # 3) 확정 설정으로 결합 → 공식 채점 복사본
    rankings = {q["question"]: fuse(BM[q["question"]], VEC[q["question"]], LOCK["vector_weight"], LOCK["bm25_k"],
                                    LOCK["vector_k"], LOCK["rrf_k"]) for q in questions}
    rank_file = WORK / "locked.ranking.json"
    rank_file.write_text(json.dumps({"corpus_sha256": sha256(CORPUS), "passages": keys, "rankings": rankings}))
    locked_json, base_json = WORK / "locked_all.json", WORK / "bm25_official_all.json"
    subprocess.run(["node", str(HERE / "eval_retrieval_dev.mjs"), "--retriever", str(HERE / "lookup_retrieve.js"),
                    "--json", str(locked_json)], cwd=ROOT, check=True, capture_output=True,
                   env={**os.environ, "RAG_RANKING": str(rank_file)})
    # 기준선: 원본 채점 스크립트를 원본 위치에서 그대로 실행
    subprocess.run(["node", "App/tools/eval_retrieval.mjs", "--json", str(base_json)], cwd=ROOT / "hrsg_eval_set_v1",
                   check=True, capture_output=True)
    L, B = json.loads(locked_json.read_text()), json.loads(base_json.read_text())
    gl, gb = groups(L), groups(B)

    # 공식 summary 와 집계가 같은지 (all, ko, en, dev, test)
    for res, g in ((L, gl), (B, gb)):
        for k, gk in (("all", "all/all"), ("ko", "all/ko"), ("en", "all/en"), ("dev", "dev/all"), ("test", "test/all")):
            assert abs(res["summary"][k]["recall"] - g[gk]["recall"]) < 1e-9 and abs(res["summary"][k]["mrr"] - g[gk]["mrr"]) < 1e-9

    # dev 부분 = dev 실험 결과인지
    dev_cached = next((ROOT / ".cache/official/runs/bge-m3").glob("*/hybrid_a0.7_b30_v50_k60.json"))
    dc = json.loads(dev_cached.read_text())["summary"]
    dev_same = all(abs(dc[k]["recall"] - gl[f"dev/{k}"]["recall"]) < 1e-9 and abs(dc[k]["mrr"] - gl[f"dev/{k}"]["mrr"]) < 1e-9
                   for k in ("ko", "en")) and abs(dc["all"]["recall"] - gl["dev/all"]["recall"]) < 1e-9

    labels = {"all/all": "전체 (dev+test)", "all/ko": "한국어 전체 (dev+test)", "all/en": "영어 전체 (dev+test)",
              "test/all": "test 전체", "test/ko": "test 한국어", "test/en": "test 영어",
              "dev/all": "dev 전체", "dev/ko": "dev 한국어", "dev/en": "dev 영어"}
    order = ["test/all", "test/ko", "test/en", "all/all", "all/ko", "all/en", "dev/all", "dev/ko", "dev/en"]
    table = []
    for k in order:
        b, l = gb[k], gl[k]
        table.append({"group": labels[k], "n": b["n"], "page_n": b["page_n"],
                      **{f"base_{m}": b[m] for m in ("recall", "hit", "mrr", "page")},
                      **{f"locked_{m}": l[m] for m in ("recall", "hit", "mrr", "page")},
                      "recall_delta_pp": (l["recall"] - b["recall"]) * 100, "mrr_delta_pp": (l["mrr"] - b["mrr"]) * 100})
    with open(OUT / "test_locked_result.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(table[0]))
        w.writeheader()
        for r in table:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
    meta = {"locked_config": LOCK, "eval_sha256": EVAL_SHA, "corpus_sha256": sha256(CORPUS),
            "retrieve_js_sha256": sha256(ROOT / "hrsg_eval_set_v1/App/web-server/lib/retrieve.js"),
            "scorer_sha256": sha256(ROOT / "hrsg_eval_set_v1/App/tools/eval_retrieval.mjs"),
            "device": device, "dev_part_matches_dev_experiment": dev_same,
            "query_ms_median_embed_plus_vector": float(np.median(lat))}
    (OUT / "test_locked_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in table:
        print(f"{r['group']:22} n={r['n']:3}  기준선 R@8 {r['base_recall']:.3f} → {r['locked_recall']:.3f} ({r['recall_delta_pp']:+.1f}%p) | "
              f"MRR {r['base_mrr']:.3f} → {r['locked_mrr']:.3f} ({r['mrr_delta_pp']:+.1f}%p) | hit {r['base_hit']:.3f} → {r['locked_hit']:.3f} | "
              f"page@8 {r['base_page']:.3f} → {r['locked_page']:.3f} (n={r['page_n']})")
    print("dev 부분이 dev 실험 결과와 같음:", dev_same)


if __name__ == "__main__":
    sys.exit(main())
