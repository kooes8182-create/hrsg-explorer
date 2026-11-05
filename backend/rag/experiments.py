"""공식 평가셋 v1 검색 실험 기록 (읽기 전용).

data/official_eval/ 에 저장된 실험 결과 파일만 읽어 화면에 넘깁니다.
여기서는 검색·임베딩·채점을 실행하지 않으며, 평가 질문·corpus 본문은 읽지도 보내지도 않습니다.
- dev:  experiments_dev.csv (모델·가중치 비교, dev 68문항 중 답이 있는 64문항)
- test: test_locked_result.csv + test_locked_meta.json (확정 설정으로 1회 실행)
"""

import csv
import json
from datetime import datetime, timezone

from .paths import PROJECT_ROOT

OFFICIAL_DIR = PROJECT_ROOT / "data" / "official_eval"
MODEL_LABEL = {"BAAI/bge-m3": "BGE-M3", "intfloat/multilingual-e5-base": "multilingual-E5-base"}
# test 결과 표의 그룹 이름(파일에 한국어로 저장됨) → 화면용 키
GROUP_KEY = {"test 전체": "test_all", "test 한국어": "test_ko", "test 영어": "test_en",
             "전체 (dev+test)": "all_all", "한국어 전체 (dev+test)": "all_ko", "영어 전체 (dev+test)": "all_en",
             "dev 전체": "dev_all", "dev 한국어": "dev_ko", "dev 영어": "dev_en"}


def _rows(name):
    with open(OFFICIAL_DIR / name, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _dev():
    rows = _rows("experiments_dev.csv")
    metrics = ("ko_recall8", "ko_mrr", "en_recall8", "en_mrr", "all_recall8", "all_mrr")
    pick = lambda r: {k: _f(r[k]) for k in metrics}
    baseline = next(({**pick(r), "ko_n": int(r["ko_n"]), "en_n": int(r["en_n"])} for r in rows if r["stage"] == "baseline"), None)
    curves = {}
    for r in rows:
        if r["stage"] != "stage1":
            continue
        curves.setdefault(r["model"], []).append({"vector_weight": _f(r["vector_weight"]), **pick(r)})
    stage2 = [{"model": MODEL_LABEL.get(r["model"], r["model"]), "vector_weight": _f(r["vector_weight"]),
               "bm25_k": int(r["bm25_k"]), "vector_k": int(r["vector_k"]), "rrf_k": int(r["rrf_k"]), **pick(r)}
              for r in rows if r["stage"] == "stage2"]
    return {
        "baseline": baseline,
        "models": [{"key": m, "label": MODEL_LABEL.get(m, m),
                    "points": sorted(p, key=lambda x: x["vector_weight"])} for m, p in curves.items()],
        "stage2": stage2,
        "stage1_setting": {"bm25_k": 50, "vector_k": 50, "rrf_k": 60},
    }


def _test():
    meta_file = OFFICIAL_DIR / "test_locked_meta.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    groups = {}
    for r in _rows("test_locked_result.csv"):
        key = GROUP_KEY.get(r["group"])
        if key:
            groups[key] = {"n": int(r["n"]), **{k: _f(r[k]) for k in r if k not in ("group", "n", "page_n")},
                           "page_n": int(r["page_n"])}
    lc = meta["locked_config"]
    return {
        "groups": groups,
        "locked": {k: lc[k] for k in ("model", "fusion", "vector_weight", "bm25_weight", "bm25_k", "vector_k",
                                      "rrf_k", "final_k", "per_ref_cap", "locked_at")},
        "locked_label": MODEL_LABEL.get(lc["model"], lc["model"]),
        "dev_part_matches": meta.get("dev_part_matches_dev_experiment"),
        "saved_at": datetime.fromtimestamp(meta_file.stat().st_mtime, tz=timezone.utc).isoformat(),
    }


def records():
    """화면용 기록. 파일이 없으면 해당 부분을 null 과 이유로 돌려줍니다."""
    out = {"eval_set": "hrsg_eval_set_v1", "dev": None, "test": None, "missing": []}
    for part, fn in (("dev", _dev), ("test", _test)):
        try:
            out[part] = fn()
        except FileNotFoundError as e:
            out["missing"].append(f"{part}: {e.filename}")
    return out
