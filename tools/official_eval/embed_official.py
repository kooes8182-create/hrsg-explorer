"""공식 corpus passage 와 dev 질문을 로컬 임베딩 모델로 벡터화해 .cache/official/<모델>/ 에 저장한다.

- corpus.json, eval_questions.json 은 읽기만 한다. passage 는 배열 순서 그대로(분할·중복 제거 없음).
- 연결 키 = corpus SHA256 + 배열 인덱스. 각 인덱스의 ref·page·kind·본문 SHA1 을 함께 저장해 불러올 때 대조한다.
- 모델 권장 입력 형식: BGE-M3 는 접두사 없음(질문 지시문 불필요), E5 는 "query: " / "passage: ".
- 잘림은 숨기지 않는다: 접두사·특수 토큰을 포함한 토큰 수가 max_length 를 넘는 passage 수를 기록한다.
- 질의 시간: 모델을 불러오고 예열한 뒤, dev 질문을 한 개씩 임베딩하고(embed_ms) 전체 passage 와 코사인 비교·상위 정렬(search_ms)한 실제 시간.
  순위에도 이때 만든 질문 벡터를 쓴다(묶음 처리 벡터와 섞지 않음).
- test 질문은 읽지 않는다.

실행 (HRSG 폴더에서):  backend/.venv/bin/python tools/official_eval/embed_official.py --model bge-m3
"""

import argparse
import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from huggingface_hub import try_to_load_from_cache
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "hrsg_eval_set_v1/App/web-server/data/corpus.json"
DEV = ROOT / ".cache/official/eval_questions.dev.json"
DEV_META = ROOT / ".cache/official/eval_questions.dev.meta.json"
CACHE = ROOT / ".cache/official"
TOP = 200

MODELS = {
    "bge-m3": {"id": "BAAI/bge-m3", "query_prefix": "", "passage_prefix": "", "max_length": 8192},
    "e5-base": {"id": "intfloat/multilingual-e5-base", "query_prefix": "query: ", "passage_prefix": "passage: ",
                "max_length": 512},
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def revision(model_id):
    p = try_to_load_from_cache(model_id, "config.json")
    return Path(p).parent.name if isinstance(p, str) else "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=MODELS, required=True)
    ap.add_argument("--batch-size", type=int, default=8)
    a = ap.parse_args()
    spec = MODELS[a.model]
    out = CACHE / a.model
    out.mkdir(parents=True, exist_ok=True)

    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    passages = corpus["passages"]
    corpus_sha = sha256(CORPUS)
    rows = [{"i": i, "ref": p["ref"], "page": p.get("page"), "kind": p["kind"],
             "text_sha1": hashlib.sha1(p["text"].encode()).hexdigest()} for i, p in enumerate(passages)]
    dev_meta = json.loads(DEV_META.read_text(encoding="utf-8"))
    questions = json.loads(DEV.read_text(encoding="utf-8"))
    assert all(q["split"] == "dev" for q in questions), "dev 사본에 dev 가 아닌 문항이 있습니다"

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    t0 = time.perf_counter()
    model = SentenceTransformer(spec["id"], device=device)
    model.max_seq_length = spec["max_length"]
    load_s = time.perf_counter() - t0
    rev = revision(spec["id"])
    dim = model.get_sentence_embedding_dimension()
    settings = {"model": spec["id"], "revision": rev, "dim": dim, "max_length": spec["max_length"],
                "query_prefix": spec["query_prefix"], "passage_prefix": spec["passage_prefix"],
                "pooling": str(model[1]), "normalize": "L2 (normalize_embeddings=True)",
                "device": device, "dtype": str(next(model.parameters()).dtype), "torch": torch.__version__,
                "platform": platform.platform()}

    # ---------------- passage 벡터 (캐시 재사용: 모델·리비전·corpus·max_length·접두사가 같을 때만)
    pmeta_path, pvec_path = out / "passages_meta.json", out / "passages.npy"
    pmeta = json.loads(pmeta_path.read_text()) if pmeta_path.exists() else None
    same = pmeta and pvec_path.exists() and pmeta["corpus_sha256"] == corpus_sha and pmeta["rows"] == rows and all(
        pmeta["settings"][k] == settings[k] for k in ("model", "revision", "max_length", "passage_prefix", "dim"))
    texts = [spec["passage_prefix"] + p["text"] for p in passages]
    if same:
        P = np.load(pvec_path)
        print(f"[{a.model}] passage 벡터 캐시 재사용 ({P.shape})")
    else:
        tok = model.tokenizer
        n_tok = [len(tok(t, add_special_tokens=True, truncation=False)["input_ids"]) for t in texts]
        trunc = [i for i, n in enumerate(n_tok) if n > spec["max_length"]]
        t1 = time.perf_counter()
        P = model.encode(texts, batch_size=a.batch_size, normalize_embeddings=True, convert_to_numpy=True,
                         show_progress_bar=False).astype(np.float32)
        enc_s = time.perf_counter() - t1
        np.save(pvec_path, P)
        pmeta = {"created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "settings": settings,
                 "corpus_sha256": corpus_sha, "count": len(passages), "batch_size": a.batch_size,
                 "model_load_seconds": round(load_s, 1), "corpus_embed_seconds": round(enc_s, 1),
                 "tokens": {"max": max(n_tok), "median": int(np.median(n_tok)), "truncated_count": len(trunc),
                            "truncated_ratio": len(trunc) / len(passages), "truncated_indices": trunc},
                 "rows": rows}
        pmeta_path.write_text(json.dumps(pmeta, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[{a.model}] passage {P.shape} 임베딩 {enc_s:.0f}초, 모델 로딩 {load_s:.0f}초, "
              f"잘림 {len(trunc)}개 ({len(trunc) / len(passages):.1%}), 최대 토큰 {max(n_tok)}")
    assert P.shape == (len(passages), dim)
    assert np.allclose(np.linalg.norm(P, axis=1), 1, atol=1e-3)

    # ---------------- dev 질문: 한 개씩 실제 질의 처리 (예열 후)
    model.encode([spec["query_prefix"] + "warm up"], normalize_embeddings=True)
    res = []
    for q in questions:
        t1 = time.perf_counter()
        v = model.encode([spec["query_prefix"] + q["question"]], normalize_embeddings=True,
                         convert_to_numpy=True)[0].astype(np.float32)
        t2 = time.perf_counter()
        sims = P @ v
        top = np.argpartition(-sims, TOP - 1)[:TOP]
        top = top[np.lexsort((top, -sims[top]))]  # 유사도 내림차순, 같으면 인덱스 오름차순
        t3 = time.perf_counter()
        res.append({"id": q["id"], "question": q["question"], "embed_ms": (t2 - t1) * 1000,
                    "search_ms": (t3 - t2) * 1000,
                    "ranking": [{"i": int(i), "s": round(float(sims[i]), 6)} for i in top]})
    cand = {"settings": settings, "corpus_sha256": corpus_sha, "dev_source_sha256": dev_meta["source_sha256"],
            "dev_copy_sha256": sha256(DEV), "model_load_seconds": round(load_s, 1),
            "note": f"ranking = 코사인 유사도 상위 {TOP}개(배열 인덱스 i). embed_ms·search_ms = 예열 후 질문 1개씩 실제 처리 시간",
            "questions": res}
    (out / "vector_candidates.dev.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")
    e = sorted(r["embed_ms"] for r in res)
    s = sorted(r["search_ms"] for r in res)
    print(f"[{a.model}] dev {len(res)}문항: 질문 임베딩 중앙값 {e[len(e) // 2]:.1f} ms, 벡터 검색 중앙값 {s[len(s) // 2]:.2f} ms "
          f"({device}, {settings['dtype']}, rev {rev[:8]}, dim {dim})")


if __name__ == "__main__":
    main()
