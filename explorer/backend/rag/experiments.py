"""검색 성능 기록 (읽기 전용) + dev 실험 실행.

- 공식 기록: HRSG/data/official_eval/*.csv, test_locked_meta.json (HRSG 앱의 실험 결과 — 고치지 않음)
- 재현 확인: explorer/data/rag/verify_locked.json (rag_verify 명령)
- dev 실험: 설정별 dev 순위를 만들어 공식 채점 복사본(eval_retrieval_dev.mjs + lookup_retrieve.js)으로 채점합니다.
  지표를 새로 구현하지 않고, test 문항은 쓰지 않습니다. 결과는 explorer/data/rag/dev_runs/<설정>.json
"""

import csv
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone

from django.conf import settings

from . import official as O

OFFICIAL_DIR = O.HRSG / "data/official_eval"
DATA = settings.BASE_DIR.parent / "data/rag"
DEV_Q = O.HRSG / ".cache/official/eval_questions.dev.json"
SCORER = O.HRSG / "tools/official_eval/eval_retrieval_dev.mjs"
LOOKUP = O.HRSG / "tools/official_eval/lookup_retrieve.js"


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _csv(name):
    p = OFFICIAL_DIR / name
    if not p.exists():
        return None
    with p.open(encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _json(p):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def records():
    dev = _csv("experiments_dev.csv") or []
    test = _csv("test_locked_result.csv") or []
    meta = _json(OFFICIAL_DIR / "test_locked_meta.json")
    runs = {p.stem: _json(p) for p in sorted((DATA / "dev_runs").glob("*.json"))} if (DATA / "dev_runs").exists() else {}
    return {
        "source": "HRSG/data/official_eval (공식 평가셋 v1, 2026-10-29 실행 — 수정하지 않음)",
        "eval_set": "hrsg_eval_set_v1", "split_note": {"dev": 68, "test": 32, "scored_dev": 64, "scored_test": 30},
        "dev_experiments": [{"stage": r["stage"], "model": r["model"], "mode": r["mode"], "vector_weight": _f(r["vector_weight"]),
                             "bm25_k": int(_f(r["bm25_k"]) or 0), "vector_k": int(_f(r["vector_k"]) or 0), "rrf_k": int(_f(r["rrf_k"]) or 0),
                             "ko_recall8": _f(r["ko_recall8"]), "ko_mrr": _f(r["ko_mrr"]), "en_recall8": _f(r["en_recall8"]),
                             "all_recall8": _f(r["all_recall8"]), "all_mrr": _f(r["all_mrr"])} for r in dev],
        "test_locked": [{"group": r["group"], "n": int(r["n"]), "base_recall": _f(r["base_recall"]), "locked_recall": _f(r["locked_recall"]),
                         "base_mrr": _f(r["base_mrr"]), "locked_mrr": _f(r["locked_mrr"]), "recall_delta_pp": _f(r["recall_delta_pp"])} for r in test],
        "locked_meta": meta, "verify": _json(DATA / "verify_locked.json"), "dev_runs": runs,
        "unverified_claims": [
            {"claim": "개선된 test Recall@8 0.813", "status": "파일 없음 — 이 PC 의 확정 결과는 0.864"},
            {"claim": "한국어 실패 16 → 4개", "status": "파일 없음"},
            {"claim": "검색 API 재현성 100/100", "status": "이 앱에서 직접 확인 (아래 재현 확인 참고)"},
        ],
    }


def run_dev(config):
    """dev 68문항 순위 → 공식 채점 복사본으로 채점. 같은 설정이면 결과를 다시 계산합니다."""
    st = O.get()
    if st["vector"] != "ready":
        raise RuntimeError(st["vector_reason"] or "임베딩 서비스를 사용할 수 없습니다.")
    questions = json.loads(DEV_Q.read_text(encoding="utf-8"))
    assert all(q["split"] == "dev" for q in questions), "dev 가 아닌 문항이 섞였습니다"
    rankings = {q["question"]: O.run(q["question"], config, modes=("hybrid",))["hybrid_order"] for q in questions}
    out_dir = DATA / "dev_runs"
    out_dir.mkdir(parents=True, exist_ok=True)
    keys = [{"ref": p["ref"], "page": p.get("page"), "kind": p["kind"]} for p in st["corpus"]["passages"]]
    rank_file = out_dir / f"{config}.ranking.tmp.json"
    score_file = out_dir / f"{config}.score.tmp.json"
    rank_file.write_text(json.dumps({"corpus_sha256": st["corpus_sha"], "passages": keys, "rankings": rankings}))
    try:
        node = shutil.which("node") or "node"
        subprocess.run([node, str(SCORER), "--retriever", str(LOOKUP), "--questions", str(DEV_Q), "--json", str(score_file)],
                       cwd=O.HRSG, check=True, capture_output=True, env={**os.environ, "RAG_RANKING": str(rank_file)},
                       timeout=300)
        scored = json.loads(score_file.read_text())
    finally:
        rank_file.unlink(missing_ok=True)
        score_file.unlink(missing_ok=True)
    result = {"config": config, "settings": O.CONFIGS[config], "split": "dev", "summary": scored["summary"],
              "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "scorer": "eval_retrieval_dev.mjs (공식 채점 복사본) + lookup_retrieve.js"}
    (out_dir / f"{config}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result
