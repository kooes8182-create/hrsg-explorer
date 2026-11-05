"""공식 BM25 기준선 vs 선택한 검색 설정 비교표·그래프 (공식 평가셋 v1 · dev).

모든 수치는 run_experiments.py 가 공식 채점 복사본으로 만든 결과(.cache/official/runs/)와
공식 BM25 dev 실행 결과(.cache/official/runs/bm25_official_dev.json)에서 읽는다. 새로 계산하지 않는다.
README v1 의 공식 기준선 표(all·dev·test)와 한국어 전체 값(dev+test)은 참고로만 함께 적는다.

실행 (HRSG 폴더에서): backend/.venv/bin/python tools/official_eval/compare_baseline.py
"""

import csv
import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / ".cache/official/runs"
OUT = ROOT / "data/official_eval"

SETTINGS = [  # (표시 이름, 결과 파일 패턴, 그래프에 넣을지)
    ("공식 BM25 (기준선)", "bm25_official_dev.json", True),
    ("BGE-M3 벡터 단독", "bge-m3/*/vector_full_a1.0_b0_v200_k0.json", False),
    ("E5 가중 RRF 최적 (벡터 70%, 30/50, k60)", "e5-base/*/hybrid_a0.7_b30_v50_k60.json", False),
    ("BGE-M3 가중 RRF 최적 (벡터 70%, 30/50, k60)", "bge-m3/*/hybrid_a0.7_b30_v50_k60.json", True),
]
README_V1 = {  # README v1 공식 기준선 (BM25, k=8) — 참고용
    "all (94)": (0.728, 0.787, 0.632, 0.514), "dev (64)": (0.742, 0.797, 0.659, 0.560),
    "test (30)": (0.699, 0.767, 0.576, 0.417)}
KO_ALL_V1 = (0.574, 0.660, 0.462, 0.378)  # 공식 스크립트 전체 실행의 ko 행 (dev+test, n=47)

ROWS = [("ko", "recall", "한국어 dev Recall@8"), ("ko", "hit", "한국어 dev hit@8"), ("ko", "mrr", "한국어 dev MRR"),
        ("ko", "page", "한국어 dev page@8"), ("en", "recall", "영어 dev Recall@8"), ("en", "mrr", "영어 dev MRR"),
        ("all", "recall", "전체 dev Recall@8"), ("all", "hit", "전체 dev hit@8"), ("all", "mrr", "전체 dev MRR"),
        ("all", "page", "전체 dev page@8")]


def load(pattern):
    f = sorted(glob.glob(str(RUNS / pattern)))
    if len(f) != 1:
        raise SystemExit(f"결과 파일을 하나로 특정할 수 없습니다: {pattern} → {f}")
    return json.loads(Path(f[0]).read_text(encoding="utf-8"))


def page_n(res, lang):
    return sum(1 for q in res["questions"] if q["answerable"] and q["page"] is not None and (lang == "all" or q["lang"] == lang))


def main():
    data = {name: load(p) for name, p, _ in SETTINGS}
    base = data[SETTINGS[0][0]]
    best = data[SETTINGS[-1][0]]

    # ---------------- 표 (CSV + Markdown)
    header = ["지표", "문항 수"] + [n for n, _, _ in SETTINGS] + ["최적 − 기준선 (%p)"]
    table = []
    for g, k, label in ROWS:
        n = page_n(base, g) if k == "page" else base["summary"][g]["n"]
        vals = [data[name]["summary"][g][k] for name, _, _ in SETTINGS]
        table.append([label, n] + vals + [(vals[-1] - vals[0]) * 100])
    with open(OUT / "baseline_comparison_dev.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in table:
            w.writerow([r[0], r[1]] + [round(v, 4) for v in r[2:]])

    md = ["# 공식 BM25 기준선 대비 비교 (공식 평가셋 v1 · dev)", "",
          "모든 값은 공식 채점 지표(recall@8·hit@8·MRR·page@8, 상위 8개·참고문헌당 2개)로 계산. test 미실행.", "",
          "| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for r in table:
        md.append(f"| {r[0]} | {r[1]} | " + " | ".join(f"{v:.3f}" for v in r[2:-1]) + f" | **{r[-1]:+.1f}** |")
    md += ["", "## 참고: README v1 에 적힌 공식 기준선 (BM25)", "",
           "| 구분 | recall@8 | hit@8 | MRR | page@8 | 이번 dev 결과와 직접 비교 |", "|---|---|---|---|---|---|"]
    for k, v in README_V1.items():
        ok = {"dev": "가능 (이 환경에서 똑같이 재현됨)", "all": "불가 — test 포함", "test": "불가 — test 문항 (미실행)"}[k.split()[0]]
        md.append(f"| {k} | " + " | ".join(f"{x:.3f}" for x in v) + f" | {ok} |")
    md.append("| 한국어 전체 (47, dev+test) | " + " | ".join(f"{x:.3f}" for x in KO_ALL_V1)
              + " | 불가 — test 포함. 한국어 dev 기준선(0.604 / 0.496)과 비교 |")
    md += ["", "※ '최적'은 비교한 2개 모델·설정 범위 안에서 한국어 dev Recall@8 기준으로 고른 값이며, dev 로 고른 설정이라 test 에서는 낮아질 수 있다.",
           "※ 문항 수가 적다(한국어 32). 한국어 recall 에서 한 문항의 정답을 모두 찾으면 약 3.1%p 가 움직인다.",
           "※ 정답 문헌을 찾았는지만 평가하며, 그 문단으로 만든 답변 내용이 맞는지는 평가하지 않는다."]
    (OUT / "baseline_comparison_dev.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    # ---------------- 그래프: 지표별 기준선 → 최적 (점과 막대 길이 = 값)
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "AppleGothic", "axes.unicode_minus": False, "svg.fonttype": "none"})
    SURF, INK, MUTED, GRID = "#fcfcfb", "#1f1f1f", "#6b6b6b", "#e4e4e2"
    BASE_C, BEST_C = "#8a8a88", "#2a78d6"
    labels = [r[0] for r in table][::-1]
    bvals = [r[2] for r in table][::-1]
    xvals = [r[-2] for r in table][::-1]
    fig, ax = plt.subplots(figsize=(9, 6.2), dpi=150)
    fig.patch.set_facecolor(SURF)
    ax.set_facecolor(SURF)
    y = range(len(labels))
    for i, (b, x) in enumerate(zip(bvals, xvals)):
        ax.plot([b, x], [i, i], color="#c9c9c7", linewidth=2, zorder=1, solid_capstyle="round")
    ax.scatter(bvals, y, s=70, color=BASE_C, zorder=3, edgecolor=SURF, linewidth=1.5, label="공식 BM25 (기준선)")
    ax.scatter(xvals, y, s=80, color=BEST_C, zorder=4, edgecolor=SURF, linewidth=1.5,
               label="BGE-M3 가중 RRF 최적 (벡터 70%, 후보 30/50, k=60)")
    for i, (b, x) in enumerate(zip(bvals, xvals)):
        left, right = (b, x) if b <= x else (x, b)
        ax.text(left - 0.012, i, f"{(b):.3f}", ha="right", va="center", fontsize=8.5, color=MUTED)
        ax.text(right + 0.012, i, f"{x:.3f}  ({(x - b) * 100:+.1f}%p)", ha="left", va="center", fontsize=8.5, color=INK)
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, color=INK)
    ax.set_xlim(0.3, 1.12)
    ax.set_xticks([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    ax.set_xlabel("점수 (0~1, 높을수록 좋음)", color="#4a4a4a")
    ax.set_title("공식 BM25 기준선 대비 개선 (공식 평가셋 v1 · dev)", color=INK, fontsize=12, pad=34)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color("#bdbdbb")
    ax.tick_params(colors="#4a4a4a", length=0)
    ax.legend(loc="lower center", bbox_to_anchor=(0.45, 1.0), ncol=2, frameon=False, fontsize=9, bbox_transform=ax.transAxes,
              borderaxespad=0.3)
    fig.text(0.01, 0.01, "dev 문항: 한국어 32·영어 32·전체 64 (page@8 은 근거 페이지가 있는 문항만: 한국어 25·전체 50). test 미실행. "
                         "한국어 전체 기준선 0.574(dev+test)와는 직접 비교하지 않음.", fontsize=7.5, color=MUTED)
    fig.tight_layout(rect=(0, 0.03, 1, 0.97))
    for ext in ("png", "svg"):
        fig.savefig(OUT / f"baseline_comparison_dev.{ext}", facecolor=SURF)
    plt.close(fig)
    print((OUT / "baseline_comparison_dev.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
