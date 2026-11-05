"""임베딩 인터페이스.

문단과 질문은 반드시 같은 Embedder(같은 모델·같은 설정)로 만듭니다. settings() 의 값이
벡터 파일(meta.json)에 기록되고, 서버 시작 시 현재 Embedder 의 값과 비교됩니다.

- LocalBgeM3Embedder: 이 PC 에서 BAAI/bge-m3 dense 벡터 (sentence-transformers, 정규화된 1,024차원)
- CloudflareEmbedder: Workers AI @cf/baai/bge-m3 로 교체할 자리. 이번에는 연결하지 않습니다.
  교체 전에 같은 문장에 대해 로컬 벡터와의 코사인 유사도가 1 에 가까운지 먼저 확인해야 합니다(협업안 p.5).
"""

import os
from pathlib import Path

import numpy as np

MODEL_ID = "BAAI/bge-m3"
DIM = 1024
MAX_LENGTH = 1024  # 문단 최대 토큰 수 (bge-m3 한계는 8,192 — 메모리 8GB 를 고려해 1,024 로 제한, 잘림 여부를 기록)


class Embedder:
    name = ""

    def settings(self):
        raise NotImplementedError

    def embed(self, texts, batch_size=8, show_progress=False):
        """정규화된 float32 배열 (len(texts), DIM)."""
        raise NotImplementedError

    def count_tokens(self, texts):
        raise NotImplementedError


def _device():
    forced = os.environ.get("RAG_EMBED_DEVICE")
    if forced:
        return forced
    import torch

    return "mps" if torch.backends.mps.is_available() else "cpu"


class LocalBgeM3Embedder(Embedder):
    name = "local-bge-m3"

    def __init__(self, max_length=MAX_LENGTH):
        from sentence_transformers import SentenceTransformer

        self.device = _device()
        self.model = SentenceTransformer(MODEL_ID, device=self.device)
        self.model.max_seq_length = max_length
        self.max_length = max_length
        self.revision = _snapshot_revision(MODEL_ID)

    def settings(self):
        # device 는 결과 수치가 미세하게 다를 수 있어 기록만 하고 일치 검사에는 쓰지 않습니다.
        return {"provider": self.name, "model": MODEL_ID, "revision": self.revision, "dim": DIM,
                "max_length": self.max_length, "normalize": True, "pooling": "cls (sentence-transformers 설정)",
                "query_prefix": ""}

    def embed(self, texts, batch_size=8, show_progress=False):
        v = self.model.encode(list(texts), batch_size=batch_size, normalize_embeddings=True,
                              convert_to_numpy=True, show_progress_bar=show_progress)
        return v.astype(np.float32)

    def count_tokens(self, texts):
        tok = self.model.tokenizer
        return [len(tok(t, add_special_tokens=True, truncation=False)["input_ids"]) for t in texts]


class CloudflareEmbedder(Embedder):
    """향후 Cloudflare Workers AI(@cf/baai/bge-m3) 연동 자리 — 이번 범위에서는 구현하지 않습니다."""

    name = "cloudflare-workers-ai"

    def __init__(self, *args, **kwargs):
        raise NotImplementedError("Cloudflare Workers AI 임베딩은 아직 연결하지 않았습니다 (로컬 BGE-M3 사용).")


def _snapshot_revision(model_id):
    """Hugging Face 캐시에 받은 모델의 커밋 해시 (없으면 'unknown')."""
    try:
        from huggingface_hub import try_to_load_from_cache

        p = try_to_load_from_cache(model_id, "config.json")  # .../snapshots/<커밋 해시>/config.json
        return Path(p).parent.name if isinstance(p, str) else "unknown"
    except Exception:
        return "unknown"


def get_embedder():
    provider = os.environ.get("RAG_EMBEDDER", "local")
    if provider == "local":
        return LocalBgeM3Embedder()
    if provider == "cloudflare":
        return CloudflareEmbedder()
    raise ValueError(f"알 수 없는 RAG_EMBEDDER: {provider}")
