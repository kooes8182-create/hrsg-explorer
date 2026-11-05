import time
from datetime import datetime, timezone

import numpy as np
from django.core.management.base import BaseCommand

from rag import paths
from rag.retrieval.corpus import load_corpus
from rag.retrieval.embedder import get_embedder
from rag.retrieval.vector_index import read_meta, save_index


class Command(BaseCommand):
    help = "코퍼스 문단 전체를 BGE-M3 로 임베딩해 data/prototype/index/ 에 저장합니다 (코퍼스가 바뀌었을 때만 다시 실행)."

    def add_arguments(self, parser):
        # 메모리 8GB(M2) 기준 8. 메모리가 부족하면 4 로 낮추세요.
        parser.add_argument("--batch-size", type=int, default=8)
        parser.add_argument("--force", action="store_true", help="코퍼스가 같아도 다시 만듭니다.")

    def handle(self, *args, **opts):
        w = self.stdout.write
        corpus = load_corpus(paths.CORPUS_DIR)
        old = read_meta(paths.INDEX_DIR)
        if old and old.get("corpus_hash") == corpus.hash and not opts["force"]:
            w("코퍼스가 바뀌지 않았습니다 (해시 동일). 다시 만들려면 --force")
            return
        w(f"코퍼스 {len(corpus)}문단, 해시 {corpus.hash[:12]} — 모델을 불러오는 중…")
        emb = get_embedder()
        texts = [c.text for c in corpus.chunks]

        tokens = emb.count_tokens(texts)
        truncated = [corpus.chunks[i].chunk_id for i, n in enumerate(tokens) if n > emb.max_length]
        w(f"토큰 수: 최대 {max(tokens)}, 중앙값 {int(np.median(tokens))}. "
          f"max_length {emb.max_length} 를 넘어 뒷부분이 잘리는 문단: {len(truncated)}개")

        t0 = time.perf_counter()
        vectors = emb.embed(texts, batch_size=opts["batch_size"], show_progress=True)
        elapsed = time.perf_counter() - t0
        norms = np.linalg.norm(vectors, axis=1)
        save_index(paths.INDEX_DIR, vectors, [c.chunk_id for c in corpus.chunks], corpus.hash, emb.settings(), {
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "device": emb.device, "batch_size": opts["batch_size"], "seconds": round(elapsed, 1),
            "max_tokens": max(tokens), "truncated_count": len(truncated), "truncated_chunk_ids": truncated,
        })
        w(f"벡터 {vectors.shape}, 길이(정규화 확인) {norms.min():.4f}~{norms.max():.4f}, {elapsed:.0f}초 ({emb.device})")
        w(self.style.SUCCESS(f"저장: {paths.INDEX_DIR}/vectors.npy, meta.json"))
