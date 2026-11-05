"""test_locked_result.csv(확정 설정 1회 실행 결과)로 표·그래프를 만든다. test 를 다시 실행하지 않는다.

실행 (HRSG 폴더에서): backend/.venv/bin/python tools/official_eval/report_test_locked.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/official_eval"
# 저장된 공식 채점 출력(JSON)에서 바로 집계한다 (CSV 반올림 값을 다시 반올림하지 않도록). test 재실행 없음.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_test_locked import WORK, groups  # noqa: E402

meta = json.loads((OUT / "test_locked_meta.json").read_text(encoding="utf-8"))
gl = groups(json.loads((WORK / "locked_all.json").read_text()))
gb = groups(json.loads((WORK / "bm25_official_all.json").read_text()))
LABELS = {"test/all": "test 전체", "test/ko": "test 한국어", "test/en": "test 영어", "all/all": "전체 (dev+test)",
          "all/ko": "한국어 전체 (dev+test)", "all/en": "영어 전체 (dev+test)", "dev/all": "dev 전체", "dev/ko": "dev 한국어",
          "dev/en": "dev 영어"}
rows = []
for k, label in LABELS.items():
    r = {"group": label, "n": gb[k]["n"], "page_n": gb[k]["page_n"]}
    for m in ("recall", "hit", "mrr", "page"):
        r[f"base_{m}"], r[f"locked_{m}"] = gb[k][m], gl[k][m]
    r["recall_delta_pp"] = (gl[k]["recall"] - gb[k]["recall"]) * 100
    r["mrr_delta_pp"] = (gl[k]["mrr"] - gb[k]["mrr"]) * 100
    rows.append(r)
with open(OUT / "test_locked_result.csv", "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0]))
    w.writeheader()
    for r in rows:
        w.writerow({k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items()})
L = meta["locked_config"]
f = lambda r, k: float(r[k])

md = ["# 확정 설정 test 결과 (공식 평가셋 v1)", "",
      f"확정 설정: {L['model']} 가중 RRF — 벡터 {L['vector_weight'] * 100:.0f}% / BM25 {L['bm25_weight'] * 100:.0f}%, "
      f"후보 BM25 {L['bm25_k']}·벡터 {L['vector_k']}, RRF k {L['rrf_k']}, 상위 {L['final_k']}개·참고문헌당 {L['per_ref_cap']}개. "
      f"확정 시각 {L['locked_at']} (test 실행 전). test 는 이 설정으로 한 번만 실행.", "",
      "기준선 = 공식 retrieve.js BM25 (원본 채점 스크립트로 같은 실행에서 다시 계산, README v1 값과 일치).", "",
      "| 구분 | 문항 수 | Recall@8 기준선 → 확정 | 개선 | hit@8 기준선 → 확정 | MRR 기준선 → 확정 | 개선 | page@8 기준선 → 확정 (문항 수) |",
      "|---|---|---|---|---|---|---|---|"]
for r in rows:
    md.append(f"| {r['group']} | {r['n']} | {f(r, 'base_recall'):.3f} → **{f(r, 'locked_recall'):.3f}** | {f(r, 'recall_delta_pp'):+.1f}%p | "
              f"{f(r, 'base_hit'):.3f} → {f(r, 'locked_hit'):.3f} | {f(r, 'base_mrr'):.3f} → **{f(r, 'locked_mrr'):.3f}** | "
              f"{f(r, 'mrr_delta_pp'):+.1f}%p | {f(r, 'base_page'):.3f} → {f(r, 'locked_page'):.3f} ({r['page_n']}) |")
md += ["", f"- dev 부분이 dev 실험 결과와 같은지: {'같음' if meta['dev_part_matches_dev_experiment'] else '다름'}",
       "- test 문항 수가 적다(한국어 15·영어 15). 한국어 test recall 에서 한 문항의 정답을 모두 찾으면 약 6.7%p 가 움직인다.",
       "- 정답 참고문헌의 passage 를 찾았는지만 평가하며, 답변 내용의 정확성은 평가하지 않는다.",
       "- 비교한 2개 모델·설정 범위 안에서 dev 로 고른 설정의 결과이며, 모든 조건에서의 최적이라는 뜻은 아니다."]
(OUT / "test_locked_result.md").write_text("\n".join(md) + "\n", encoding="utf-8")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update({"font.family": "AppleGothic", "axes.unicode_minus": False, "svg.fonttype": "none"})
SURF, INK, MUTED = "#fcfcfb", "#1f1f1f", "#6b6b6b"
show = ["test 한국어", "test 영어", "test 전체", "한국어 전체 (dev+test)", "영어 전체 (dev+test)", "전체 (dev+test)"]
sel = [next(r for r in rows if r["group"] == g) for g in show]
fig, axes = plt.subplots(1, 2, figsize=(11, 5.2), dpi=150, sharey=True)
fig.patch.set_facecolor(SURF)
for ax, (metric, title) in zip(axes, (("recall", "Recall@8"), ("mrr", "MRR"))):
    ax.set_facecolor(SURF)
    labels = [r["group"] for r in sel][::-1]
    b = [f(r, f"base_{metric}") for r in sel][::-1]
    x = [f(r, f"locked_{metric}") for r in sel][::-1]
    y = range(len(labels))
    for i in y:
        ax.plot([b[i], x[i]], [i, i], color="#c9c9c7", linewidth=2, zorder=1)
    ax.scatter(b, y, s=70, color="#8a8a88", edgecolor=SURF, linewidth=1.5, zorder=3, label="공식 BM25 (기준선)")
    ax.scatter(x, y, s=80, color="#2a78d6", edgecolor=SURF, linewidth=1.5, zorder=4, label="확정 설정 (BGE-M3 가중 RRF)")
    for i in y:
        ax.text(b[i] - 0.015, i, f"{b[i]:.3f}", ha="right", va="center", fontsize=8.5, color=MUTED)
        ax.text(x[i] + 0.015, i, f"{x[i]:.3f} ({(x[i] - b[i]) * 100:+.1f}%p)", ha="left", va="center", fontsize=8.5, color=INK)
    ax.axhline(2.5, color="#e4e4e2", linewidth=1)
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, color=INK)
    ax.set_xlim(0.25, 1.15)
    ax.set_xlabel(f"{title} (0~1, 높을수록 좋음)", color="#4a4a4a")
    ax.set_title(title, color=INK, fontsize=11)
    ax.grid(axis="x", color="#e4e4e2", linewidth=0.8)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color("#bdbdbb")
    ax.tick_params(colors="#4a4a4a", length=0)
h, l = axes[0].get_legend_handles_labels()
fig.legend(h, l, loc="upper center", bbox_to_anchor=(0.5, 0.93), ncol=2, frameon=False, fontsize=9)
fig.suptitle("확정 설정의 test 결과 — 공식 BM25 기준선 대비 (공식 평가셋 v1 · test 1회 실행)", color=INK, fontsize=12, y=0.99)
fig.text(0.01, 0.01, f"확정 설정: BGE-M3, 벡터 {L['vector_weight'] * 100:.0f}% / BM25 {L['bm25_weight'] * 100:.0f}%, 후보 {L['bm25_k']}/{L['vector_k']}, "
                     f"RRF k={L['rrf_k']}. 문항 수: test 한국어 15·영어 15·전체 30, 전체(dev+test) 한국어 47·영어 47·94.",
         fontsize=7.5, color=MUTED)
fig.tight_layout(rect=(0, 0.03, 1, 0.88))
for ext in ("png", "svg"):
    fig.savefig(OUT / f"test_locked_comparison.{ext}", facecolor=SURF)
print((OUT / "test_locked_result.md").read_text(encoding="utf-8"))
