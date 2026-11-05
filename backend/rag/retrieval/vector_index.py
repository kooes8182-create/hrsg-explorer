"""문단 벡터 저장·검색 (로컬: 전체 벡터와 코사인 유사도 비교).

index/vectors.npy  (문단 수, 1024) float32, 정규화됨 → 내적 = 코사인 유사도
index/meta.json    corpus_hash, chunk_ids(순서), 임베딩 설정, 생성 시각, 잘린 문단 수

불러올 때 코퍼스 해시·문단 ID 순서·임베딩 설정이 현재와 같은지 확인합니다. 다르면 벡터 검색을 끄고
이유를 알려 줍니다 (코퍼스가 바뀌었으면 rag_build_embeddings 를 다시 실행).
"""

import json
from pathlib import Path

import numpy as np

COMPARED_SETTINGS = ("provider", "model", "revision", "dim", "max_length", "normalize", "query_prefix")


class IndexMismatch(Exception):
    pass


def save_index(folder, vectors, chunk_ids, corpus_hash, settings, extra):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    np.save(folder / "vectors.npy", vectors.astype(np.float32))
    meta = {"corpus_hash": corpus_hash, "count": len(chunk_ids), "embedding": settings, **extra,
            "chunk_ids": list(chunk_ids)}
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


def read_meta(folder):
    p = Path(folder) / "meta.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


class VectorIndex:
    def __init__(self, folder, corpus):
        folder = Path(folder)
        meta = read_meta(folder)
        if meta is None or not (folder / "vectors.npy").exists():
            raise FileNotFoundError("문단 벡터가 없습니다. rag_build_embeddings 를 실행하세요.")
        if meta["corpus_hash"] != corpus.hash or meta["chunk_ids"] != [c.chunk_id for c in corpus.chunks]:
            raise IndexMismatch("코퍼스가 벡터를 만든 뒤 바뀌었습니다. rag_build_embeddings 를 다시 실행하세요.")
        self.vectors = np.load(folder / "vectors.npy", mmap_mode=None)
        if self.vectors.shape != (len(corpus), meta["embedding"]["dim"]):
            raise IndexMismatch("벡터 파일 크기가 코퍼스와 맞지 않습니다. rag_build_embeddings 를 다시 실행하세요.")
        self.meta = meta

    def check_embedder(self, settings):
        diff = [k for k in COMPARED_SETTINGS if self.meta["embedding"].get(k) != settings.get(k)]
        if diff:
            raise IndexMismatch(f"질문 임베딩 설정이 문단 벡터와 다릅니다 ({', '.join(diff)}). 벡터를 다시 만드세요.")

    def search(self, query_vec, k):
        """상위 k 개 (문단 번호, 코사인 유사도)."""
        sims = self.vectors @ query_vec.astype(np.float32)
        k = min(k, len(sims))
        top = np.argpartition(-sims, k - 1)[:k]
        top = top[np.argsort(-sims[top], kind="stable")]
        return [(int(i), float(sims[i])) for i in top]
