"""공식 평가셋 v1 · dev: BM25(공식) × 벡터(로컬 임베딩) 가중 RRF 실험.

채점은 공식 지표를 그대로 쓴다: 결합 순위를 파일로 저장 → eval_retrieval_dev.mjs(공식 채점 복사본)가
lookup_retrieve.js(원본과 같은 cap)로 읽어 recall@8·hit@8·MRR·page@8 을 계산 → 그 JSON 을 읽어 표로 만든다.
test 문항은 읽지 않는다. 설정·선택 기준은 experiment_config.json (결과 보기 전에 고정).

가중 RRF: score = (1-a)/(k + rank_bm25) + a/(k + rank_vector)
  - 순위는 1부터, 후보 목록(상위 bm25_k / vector_k)에 없으면 그 항은 0, 가중치 0 인 검색의 후보는 쓰지 않음
  - 동점: 점수 내림차순 → (가중치 > 0 인 검색의) 순위 중 작은 값 오름차순 → 배열 인덱스 오름차순
  - 결합 후 cap 한 번 (lookup_retrieve.js)

질의 시간(실측, 예열 후 질문 1개씩): BM25 = 원본 search() 시간(Node), 벡터 = 질문 임베딩 + 코사인 검색(Python),
결합 = 가중 RRF 계산(Python). 사용한 구성 요소의 합을 질의당 시간으로 보고한다(서로 다른 프로세스에서 잰 값의 합).
순위 캐시로 채점한 시간은 질의 시간으로 쓰지 않는다.

실행 (HRSG 폴더에서):  backend/.venv/bin/python tools/official_eval/run_experiments.py
"""

import csv
import hashlib
import json
import os
import statistics
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / ".cache/official"
OUT = ROOT / "data/official_eval"
DEV = CACHE / "eval_questions.dev.json"
CORPUS = ROOT / "hrsg_eval_set_v1/App/web-server/data/corpus.json"
CONFIG = json.loads((HERE / "experiment_config.json").read_text(encoding="utf-8"))
FUSION_VERSION = "wrrf-v1"
MODEL_LABEL = {"bge-m3": "BAAI/bge-m3", "e5-base": "intfloat/multilingual-e5-base"}
COLORS = {"bge-m3": "#2a78d6", "e5-base": "#eb6834"}  # 프로젝트 검증 2색 팔레트 (styles.css --series-1/2)


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def median(xs):
    return statistics.median(xs) if xs else None


# ------------------------------------------------------------------ 입력 읽기와 대조
corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
CORPUS_SHA = sha256(CORPUS)
KEYS = [{"ref": p["ref"], "page": p.get("page"), "kind": p["kind"]} for p in corpus["passages"]]
questions = json.loads(DEV.read_text(encoding="utf-8"))
assert all(q["split"] == "dev" for q in questions)
bm25 = json.loads((CACHE / "bm25_candidates.dev.json").read_text(encoding="utf-8"))
assert bm25["corpus_sha256"] == CORPUS_SHA and bm25["dev_sha256"] == sha256(DEV)
BM = {r["question"]: r for r in bm25["questions"]}

models = {}
for m in MODEL_LABEL:
    f = CACHE / m / "vector_candidates.dev.json"
    if not f.exists():
        continue
    v = json.loads(f.read_text(encoding="utf-8"))
    pm = json.loads((CACHE / m / "passages_meta.json").read_text(encoding="utf-8"))
    rows = [{"ref": r["ref"], "page": r["page"], "kind": r["kind"]} for r in pm["rows"]]
    assert v["corpus_sha256"] == CORPUS_SHA == pm["corpus_sha256"] and rows == KEYS, f"{m}: corpus 대조 실패"
    assert v["dev_copy_sha256"] == sha256(DEV), f"{m}: dev 질문 파일이 바뀜 — 다시 임베딩 필요"
    models[m] = {"cand": {r["question"]: r for r in v["questions"]}, "meta": pm, "fingerprint":
                 hashlib.sha256((sha256(f) + sha256(CACHE / "bm25_candidates.dev.json") + FUSION_VERSION).encode()).hexdigest()[:12]}


# ------------------------------------------------------------------ 결합과 공식 채점
def fuse(bm_rank, vec_rank, alpha, kb, kv, kr):
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
    return sorted((i for i in score if score[i] > 0),
                  key=lambda i: (-score[i], min(rb.get(i, inf), rv.get(i, inf)), i)), rb, rv


def score_official(rankings, out_json):
    """공식 채점 복사본 + lookup 검색으로 채점 → 공식 --json 출력."""
    rank_file = out_json.with_suffix(".ranking.json")
    rank_file.write_text(json.dumps({"corpus_sha256": CORPUS_SHA, "passages": KEYS, "rankings": rankings}))
    env = {**os.environ, "RAG_RANKING": str(rank_file)}
    subprocess.run(["node", str(HERE / "eval_retrieval_dev.mjs"), "--questions", str(DEV), "--retriever",
                    str(HERE / "lookup_retrieve.js"), "--json", str(out_json)],
                   cwd=ROOT, env=env, check=True, capture_output=True)
    return json.loads(out_json.read_text(encoding="utf-8"))


def page_n(result, lang=None):
    return sum(1 for q in result["questions"] if q["answerable"] and q["page"] is not None
               and (lang is None or q["lang"] == lang))


def run_config(model, mode, alpha, kb, kv, kr, stage):
    """mode: hybrid(가중 RRF; alpha 0·1 포함) | vector_full(벡터 전체 순위) | bm25_official(원본 search)."""
    key = f"{mode}_a{alpha:.1f}_b{kb}_v{kv}_k{kr}"
    fp = models[model]["fingerprint"] if model else "bm25"
    d = CACHE / "runs" / (model or "bm25") / fp
    d.mkdir(parents=True, exist_ok=True)
    out_json = d / f"{key}.json"
    lat, fuse_ms = [], {}
    rankings = {}
    for q in questions:
        b = [x["i"] for x in BM[q["question"]]["ranking"]]
        if mode == "hybrid":
            vq = models[model]["cand"][q["question"]]
            v = [x["i"] for x in vq["ranking"]]
            t0 = time.perf_counter()
            order, _, _ = fuse(b, v, alpha, kb, kv, kr)
            fuse_ms[q["id"]] = (time.perf_counter() - t0) * 1000
            rankings[q["question"]] = order
            t = 0.0
            if alpha < 1:
                t += BM[q["question"]]["query_ms"]
            if alpha > 0:
                t += vq["embed_ms"] + vq["search_ms"]
            if 0 < alpha < 1:
                t += fuse_ms[q["id"]]
            lat.append(t)
        elif mode == "vector_full":
            vq = models[model]["cand"][q["question"]]
            rankings[q["question"]] = [x["i"] for x in vq["ranking"]]
            lat.append(vq["embed_ms"] + vq["search_ms"])
        else:
            lat.append(BM[q["question"]]["query_ms"])
    if mode == "bm25_official":
        res = json.loads((CACHE / "runs/bm25_official_dev.json").read_text(encoding="utf-8"))
    elif out_json.exists():
        res = json.loads(out_json.read_text(encoding="utf-8"))  # 같은 입력·설정이면 캐시 재사용
    else:
        res = score_official(rankings, out_json)
    s = res["summary"]
    row = {"stage": stage, "model": MODEL_LABEL.get(model, "—"), "model_key": model or "", "mode": mode,
           "vector_weight": alpha, "bm25_weight": round(1 - alpha, 1), "bm25_k": kb, "vector_k": kv, "rrf_k": kr,
           "ko_recall8": s["ko"]["recall"], "ko_hit8": s["ko"]["hit"], "ko_mrr": s["ko"]["mrr"], "ko_page8": s["ko"]["page"],
           "ko_n": s["ko"]["n"], "ko_page_n": page_n(res, "ko"),
           "en_recall8": s["en"]["recall"], "en_mrr": s["en"]["mrr"], "en_n": s["en"]["n"],
           "all_recall8": s["all"]["recall"], "all_mrr": s["all"]["mrr"], "all_n": s["all"]["n"],
           "all_page8": s["all"]["page"], "all_page_n": page_n(res),
           "query_ms_mean": statistics.fmean(lat), "query_ms_median": median(lat),
           "_result": res, "_rankings": rankings}
    return row


# ------------------------------------------------------------------ 실험
TIES = []


def criteria_key(r):
    return (-r["ko_recall8"], -r["ko_mrr"], -r["en_recall8"], r["query_ms_median"])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    s1 = CONFIG["stage1"]
    base = run_config(None, "bm25_official", 0.0, 0, 0, 0, "baseline")
    BASE_KO = base["ko_recall8"]
    rows = [base]
    checks = []
    for m in models:
        st1 = [run_config(m, "hybrid", a, s1["bm25_k"], s1["vector_k"], s1["rrf_k"], "stage1") for a in s1["alpha"]]
        vfull = run_config(m, "vector_full", 1.0, 0, 200, 0, "single")
        # 검증: alpha 0 = BM25 단독(원본 search), alpha 1 = 벡터 단독(전체 순위 + cap)
        top8 = lambda r: {q["id"]: [(p["ref"], p["page"], p["kind"]) for p in q["ranked"]] for q in r["_result"]["questions"]}
        for name, a, b in (("alpha=0.0 vs 공식 BM25 단독", st1[0], base), ("alpha=1.0 vs 벡터 단독(전체 순위)", st1[-1], vfull)):
            ta, tb = top8(a), top8(b)
            diff = [k for k in ta if ta[k] != tb[k]]
            checks.append({"model": MODEL_LABEL[m], "check": name, "questions": len(ta), "different_top8": len(diff),
                           "different_ids": diff})
        # 1단계 최적 비중: 기준 1~3순위가 같은 비중은 모두 최적으로 보고 2단계를 각각 실행한다.
        # (4순위 지연 차이가 결합 계산의 측정 잡음(µs 단위)뿐이라, 잡음으로 하나만 고르지 않기 위함 — 결과를 본 뒤 추가한 처리)
        top = criteria_key(min(st1, key=criteria_key))[:3]
        tied = [r["vector_weight"] for r in st1 if criteria_key(r)[:3] == top]
        TIES.append({"model": MODEL_LABEL[m], "stage1_best_alphas": tied})
        st2 = []
        for best_a in tied:
            for kb in CONFIG["stage2"]["bm25_k"]:
                for kv in CONFIG["stage2"]["vector_k"]:
                    for kr in CONFIG["stage2"]["rrf_k"]:
                        st2.append(run_config(m, "hybrid", best_a, kb, kv, kr, "stage2"))
        rows += st1 + [vfull] + st2
    for r in rows:
        r["ko_recall_delta_pp_vs_bm25"] = (r["ko_recall8"] - BASE_KO) * 100
    return rows, base, checks


FIELDS = ["stage", "model", "mode", "bm25_weight", "vector_weight", "bm25_k", "vector_k", "rrf_k",
          "ko_recall8", "ko_hit8", "ko_mrr", "ko_page8", "ko_n", "ko_page_n", "ko_recall_delta_pp_vs_bm25",
          "en_recall8", "en_mrr", "en_n", "all_recall8", "all_mrr", "all_n", "all_page8", "all_page_n",
          "query_ms_mean", "query_ms_median"]


def fmt(v):
    return f"{v:.3f}" if isinstance(v, float) else ("" if v is None else str(v))


def write_outputs(rows, base, checks):
    # stage2 의 (50,50,60) 은 stage1 과 같은 설정 → 표에는 한 번만 (캐시 재사용 확인용으로 표시)
    seen, uniq = set(), []
    for r in rows:
        k = (r["model_key"], r["mode"], r["vector_weight"], r["bm25_k"], r["vector_k"], r["rrf_k"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    with open(OUT / "experiments_dev.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in uniq:
            w.writerow({k: (round(r[k], 4) if isinstance(r[k], float) else r[k]) for k in FIELDS})

    best = {}
    for m in models:
        cand = [r for r in uniq if r["model_key"] == m and r["mode"] == "hybrid"]
        best[m] = min(cand, key=criteria_key)
    eq = {m: next(r for r in uniq if r["model_key"] == m and r["mode"] == "hybrid" and r["stage"] == "stage1"
                  and r["vector_weight"] == 0.5) for m in models}
    vf = {m: next(r for r in uniq if r["model_key"] == m and r["mode"] == "vector_full") for m in models}

    L = ["# 공식 평가셋 v1 · dev — 모델별 최적 설정 요약", "",
         f"선택 기준(실험 전 고정): {' → '.join(c.split('. ', 1)[1] for c in CONFIG['selection_criteria'])}", "",
         f"한국어 dev BM25 기준선(공식 retrieve.js): recall@8 {base['ko_recall8']:.3f}, MRR {base['ko_mrr']:.3f} (n={base['ko_n']})", "",
         "| 모델 | 설정 | 벡터 비중 | 후보 BM25/벡터 | RRF k | 한국어 R@8 | 한국어 hit@8 | 한국어 MRR | 한국어 page@8 | 영어 R@8 | 영어 MRR | 전체 R@8 | 전체 MRR | 한국어 R@8 개선(%p) | 질의 시간 중앙값(ms) |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]

    def line(r, label):
        return (f"| {r['model']} | {label} | {r['vector_weight'] * 100:.0f}% | {r['bm25_k'] or '-'}/{r['vector_k'] or '-'} | "
                f"{r['rrf_k'] or '-'} | {r['ko_recall8']:.3f} | {r['ko_hit8']:.3f} | {r['ko_mrr']:.3f} | {fmt(r['ko_page8'])} | "
                f"{r['en_recall8']:.3f} | {r['en_mrr']:.3f} | {r['all_recall8']:.3f} | {r['all_mrr']:.3f} | "
                f"{r['ko_recall_delta_pp_vs_bm25']:+.1f} | {r['query_ms_median']:.1f} |")

    L.append(line(base, "BM25 단독 (공식 기준선)").replace("| 0% |", "| 0% |"))
    for m in models:
        L.append(line(vf[m], "벡터 단독 (전체 순위)"))
        L.append(line(eq[m], "동등 가중 RRF (50:50)"))
        L.append(line(best[m], "**기준상 최적 (가중 RRF)**"))
    L += ["", "※ 비교한 모델·설정 범위 안에서의 dev 최고값이며, 모든 조건에서의 최적 모델이라는 뜻이 아님. test 미실행.",
          f"※ 문항 수: 한국어 {base['ko_n']}·영어 {base['en_n']} (답 있는 dev). page@8 은 근거 페이지가 있는 한국어 {base['ko_page_n']}문항만.",
          "※ 질의 시간 = 예열 후 질문 1개씩 실측한 구성 요소 합(BM25 Node + 질문 임베딩·벡터 검색 Python + 결합). 모델 로딩·코퍼스 임베딩 제외.",
          "", "## 1단계 최적 비중 (기준 1~3순위 동률은 모두 2단계 실행)", ""]
    for t in TIES:
        L.append(f"- {t['model']}: 벡터 비중 {', '.join(f'{a * 100:.0f}%' for a in t['stage1_best_alphas'])}")
    L += ["", "## 검증", ""]
    for c in checks:
        L.append(f"- {c['model']} — {c['check']}: dev {c['questions']}문항 중 상위 8개가 다른 문항 {c['different_top8']}개"
                 + (f" ({', '.join(c['different_ids'])})" if c["different_ids"] else ""))
    L += ["", "alpha 0·1 이 단독 검색과 다른 문항은 후보 50개 안에서 참고문헌당 2개 제한을 적용하면 8개를 다 채우지 못하는 경우다",
          "(단독 검색은 51위 이하로 채움, 결합은 후보 밖 passage 로 채우지 않음). 한국어 지표는 같고 영어 recall 만 작게 다르다 — CSV 참고."]
    (OUT / "best_settings_dev.md").write_text("\n".join(L) + "\n", encoding="utf-8")

    # 추가 실험 비교표
    T = ["# 공식 평가셋 v1 · dev — 후보 수·RRF 상수 추가 실험", "",
         "각 모델의 1단계 최적 벡터 비중(기준 1~3순위 동률이면 모두)에서 BM25·벡터 후보 수(30/50)와 RRF k(20/60)만 바꿈. (50,50,60)은 1단계 결과를 캐시로 재사용.", "",
         "| 모델 | 벡터 비중 | BM25 후보 | 벡터 후보 | RRF k | 한국어 R@8 | 한국어 MRR | 영어 R@8 | 영어 MRR | 전체 R@8 | 전체 MRR | 질의 시간 중앙값(ms) |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r["stage"] == "stage2":
            T.append(f"| {r['model']} | {r['vector_weight'] * 100:.0f}% | {r['bm25_k']} | {r['vector_k']} | {r['rrf_k']} | "
                     f"{r['ko_recall8']:.3f} | {r['ko_mrr']:.3f} | {r['en_recall8']:.3f} | {r['en_mrr']:.3f} | "
                     f"{r['all_recall8']:.3f} | {r['all_mrr']:.3f} | {r['query_ms_median']:.1f} |")
    (OUT / "stage2_candidates_rrf_dev.md").write_text("\n".join(T) + "\n", encoding="utf-8")
    return uniq, best


def plots(rows, base):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "AppleGothic", "axes.unicode_minus": False, "svg.fonttype": "none"})
    specs = [("ko_recall8", "한국어 dev Recall@8", "ko_recall_alpha", base["ko_recall8"], "BM25 단독 (공식 기준선)"),
             ("ko_mrr", "한국어 dev MRR", "ko_mrr_alpha", base["ko_mrr"], "BM25 단독 (공식 기준선)"),
             ("en_recall8", "영어 dev Recall@8", "en_recall_alpha", base["en_recall8"], "BM25 단독 (공식 기준선)")]
    for metric, ylabel, fname, bl, bl_label in specs:
        fig, ax = plt.subplots(figsize=(8.5, 5.2), dpi=150)
        fig.patch.set_facecolor("#fcfcfb")
        ax.set_facecolor("#fcfcfb")
        ax.axhline(bl, color="#6b6b6b", linestyle=(0, (5, 4)), linewidth=1.5, label=f"{bl_label} {bl:.3f}", zorder=1)
        for m in models:
            pts = sorted((r for r in rows if r["model_key"] == m and r["stage"] == "stage1"), key=lambda r: r["vector_weight"])
            xs = [r["vector_weight"] * 100 for r in pts]
            ys = [r[metric] for r in pts]
            ax.plot(xs, ys, color=COLORS[m], linewidth=2, marker="o", markersize=7, markeredgecolor="#fcfcfb",
                    markeredgewidth=1.5, label=MODEL_LABEL[m], zorder=3)
            top = max(ys)
            tied = [x for x, y in zip(xs, ys) if y == top]  # 같은 최고값이 여러 비중이면 모두 표시
            bi = ys.index(top)
            ax.annotate(f"최고 {top:.3f}\n벡터 {'·'.join(f'{x:.0f}%' for x in tied)}", (sum(tied) / len(tied), top),
                        textcoords="offset points",
                        xytext=(0, 12), ha="center", fontsize=9, color="#2b2b2b",
                        bbox=dict(boxstyle="round,pad=0.25", fc="#fcfcfb", ec=COLORS[m], lw=1))
        ax.set_xlim(-4, 104)
        ax.set_xticks(range(0, 101, 10))
        ax.set_xlabel("벡터 검색 비중 (%)  — 0% = BM25만, 100% = 벡터만 (BM25 비중 = 100% - 벡터 비중)", color="#4a4a4a")
        ax.set_ylabel(f"{ylabel} (0~1)", color="#4a4a4a")
        ax.set_title(f"{ylabel} — 벡터 검색 비중별 (공식 평가셋 v1 · dev)", color="#1f1f1f", fontsize=12, pad=12)
        lo = min(min(r[metric] for r in rows if r["stage"] == "stage1"), bl)
        hi = max(max(r[metric] for r in rows if r["stage"] == "stage1"), bl)
        ax.set_ylim(max(0, lo - 0.08), min(1.02, hi + 0.1))
        ax.grid(axis="y", color="#e4e4e2", linewidth=0.8)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color("#bdbdbb")
        ax.tick_params(colors="#4a4a4a")
        ax.legend(loc="upper left", frameon=False, fontsize=9)
        fig.text(0.01, 0.01, "점 = 실제 평가한 비중(0%, 10%, … 100%). 점 사이 선은 연결일 뿐 측정값이 아님. "
                             "후보 BM25 50 · 벡터 50, RRF k = 60, 상위 8개·참고문헌당 2개.\n"
                             "0% 점이 기준선과 다르면: 후보 50개 안에서 참고문헌당 2개 제한으로 8개를 다 채우지 못한 문항 때문 "
                             "(공식 BM25 단독은 51위 이하로 채움).", fontsize=7.5, color="#6b6b6b")
        fig.tight_layout(rect=(0, 0.05, 1, 1))
        for ext in ("png", "svg"):
            fig.savefig(OUT / f"{fname}.{ext}", facecolor=fig.get_facecolor())
        plt.close(fig)


def failures(rows, best, base):
    """dev 한국어: 기준상 최적 설정 vs BM25 단독 vs 벡터 단독 — 새로 찾은 질문, 놓친 질문, 원인."""
    out = ["# 공식 평가셋 v1 · dev — 한국어 문항 변화와 실패 원인", "",
           "정답 판정은 '정답 참고문헌의 passage 가 상위 8개에 들어왔는가'이며, 답변 내용이 맞는지는 평가하지 않는다.", ""]
    bq = {q["id"]: q for q in base["_result"]["questions"]}
    dev = {q["id"]: q for q in questions}
    for m, br in best.items():
        vf = next(r for r in rows if r["model_key"] == m and r["mode"] == "vector_full")
        hq = {q["id"]: q for q in br["_result"]["questions"]}
        vq = {q["id"]: q for q in vf["_result"]["questions"]}
        out += [f"## {br['model']} — 벡터 {br['vector_weight'] * 100:.0f}%, 후보 {br['bm25_k']}/{br['vector_k']}, RRF k {br['rrf_k']}", ""]
        gained, lost, partial = [], [], []
        for qid, h in hq.items():
            if not h["answerable"] or h["lang"] != "ko":
                continue
            b = bq[qid]
            if h["recall"] > b["recall"]:
                gained.append(qid)
            elif h["recall"] < b["recall"]:
                lost.append(qid)
            if h["recall"] < 1:
                partial.append(qid)
        out.append(f"- BM25 단독보다 recall 이 오른 한국어 문항 {len(gained)}개: {', '.join(gained) or '없음'}")
        out.append(f"- BM25 단독보다 recall 이 내려간 한국어 문항 {len(lost)}개: {', '.join(lost) or '없음'}")
        vb = [qid for qid, h in hq.items() if h["answerable"] and h["lang"] == "ko" and vq[qid]["recall"] > h["recall"]]
        out.append(f"- 벡터 단독이 더 많이 찾은 한국어 문항 {len(vb)}개: {', '.join(vb) or '없음'}")
        out += ["", "| 문항 | recall (BM25 → 최적) | 놓친 정답 참고문헌 | BM25 후보 순위 | 벡터 후보 순위 | 결합 순위 | 원인 |",
                "|---|---|---|---|---|---|---|"]
        for qid in partial:
            q = dev[qid]
            b_rank = [x["i"] for x in BM[q["question"]]["ranking"]]
            v_rank = [x["i"] for x in models[m]["cand"][q["question"]]["ranking"]]
            order, rb, rv = fuse(b_rank, v_rank, br["vector_weight"], br["bm25_k"], br["vector_k"], br["rrf_k"])
            # cap 재현: 선택된 것, cap 으로 건너뛴 것, 8개 이후
            per, sel, skipped = {}, [], set()
            for i in order:
                r = corpus["passages"][i]["ref"]
                if len(sel) >= 8:
                    break
                if per.get(r, 0) >= 2:
                    skipped.add(i)
                    continue
                per[r] = per.get(r, 0) + 1
                sel.append(i)
            for ref in q["expected"]:
                if ref in hq[qid]["found"]:
                    continue
                idx = [i for i, p in enumerate(corpus["passages"]) if p["ref"] == ref]
                br_ = min((rb[i] for i in idx if i in rb), default=None)
                vr_ = min((rv[i] for i in idx if i in rv), default=None)
                pos = [n for n, i in enumerate(order, 1) if i in idx]
                if br_ is None and vr_ is None:
                    cause = "두 검색 후보(상위 50)에 없음"
                elif any(i in skipped for i in idx):
                    cause = "cap(참고문헌당 2개) 적용에서 제외"
                else:
                    cause = "후보에는 있었지만 RRF 결합 후 상위 8개 밖으로 밀림"
                out.append(f"| {qid} | {bq[qid]['recall']:.2f} → {hq[qid]['recall']:.2f} | {ref} | {br_ or '없음'} | "
                           f"{vr_ or '없음'} | {pos[0] if pos else '-'} | {cause} |")
        out.append("")
    (OUT / "failures_ko_dev.md").write_text("\n".join(out) + "\n", encoding="utf-8")


def versions():
    v = {"eval_set": "v1", "corpus_sha256": CORPUS_SHA, "eval_questions_sha256": sha256(ROOT / "hrsg_eval_set_v1/App/tools/eval_questions.json"),
         "dev_copy_sha256": sha256(DEV), "retrieve_js_sha256": sha256(ROOT / "hrsg_eval_set_v1/App/web-server/lib/retrieve.js"),
         "official_scorer_sha256": sha256(ROOT / "hrsg_eval_set_v1/App/tools/eval_retrieval.mjs"),
         "scorer_copy_sha256": sha256(HERE / "eval_retrieval_dev.mjs"), "lookup_retrieve_sha256": sha256(HERE / "lookup_retrieve.js"),
         "fusion_version": FUSION_VERSION, "node": subprocess.run(["node", "-v"], capture_output=True, text=True).stdout.strip(),
         "experiment_config": CONFIG, "models": {}}
    for m, d in models.items():
        pm = d["meta"]
        v["models"][m] = {**pm["settings"], "corpus_embed_seconds": pm["corpus_embed_seconds"],
                          "model_load_seconds": pm["model_load_seconds"], "batch_size": pm["batch_size"],
                          "tokens": {k: pm["tokens"][k] for k in ("max", "median", "truncated_count", "truncated_ratio")},
                          "corpus_sha256": pm["corpus_sha256"]}
    (OUT / "versions.json").write_text(json.dumps(v, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    rows, base, checks = main()
    uniq, best = write_outputs(rows, base, checks)
    plots(uniq, base)
    failures(uniq, best, base)
    versions()
    print((OUT / "best_settings_dev.md").read_text(encoding="utf-8"))
    print(f"결과: {OUT}")
