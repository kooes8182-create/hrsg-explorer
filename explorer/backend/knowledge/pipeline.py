"""문헌 갱신 파이프라인: 텍스트 추출 → 청킹 → 임베딩 → 인덱스 갱신 → Dev 평가 → 이전 결과 비교.

- 작업은 서버 안의 별도 스레드에서 하나씩 실행하고, 단계마다 상태를 EmbeddingJob.steps 에 기록합니다 (화면이 주기적으로 읽음).
- 임베딩은 공식 벡터와 같은 BGE-M3·리비전·정규화 규칙을 씁니다 (rag.official 의 모델 공유).
- Dev 평가는 공식 dev 문항으로 확정 설정을 다시 채점해 '공식 범위가 바뀌지 않았는지' 확인합니다.
  업로드 문헌에는 정답 라벨이 없으므로 그 범위의 recall 은 계산하지 않습니다 (측정되지 않은 범위로 표시).
"""

import json
import threading
import traceback

import numpy as np
from django.db import close_old_connections
from django.utils import timezone

from rag import experiments, official

from . import pdf_extract, search
from .models import EmbeddingJob, Paper, PaperChunk
from .storage import file_path

_run_lock = threading.Lock()
STEPS = ["extract", "chunk", "embed", "index", "dev_eval", "compare"]
OFFICIAL_DEV = {"all": 0.9354, "ko": 0.9073}  # 저장된 공식 dev 기록 (확정 설정) — HRSG/data/official_eval


def _step(job, key, status, detail=None):
    steps = [s for s in job.steps if s["key"] != key]
    steps.append({"key": key, "status": status, "detail": detail, "at": timezone.now().isoformat(timespec="seconds")})
    job.steps = sorted(steps, key=lambda s: STEPS.index(s["key"]))
    job.save(update_fields=["steps"])


def start(job):
    threading.Thread(target=_thread_main, args=(job.id,), daemon=True).start()


def _thread_main(job_id):
    """별도 스레드는 자기 DB 연결을 쓰므로 시작·끝에 정리합니다."""
    close_old_connections()
    try:
        _run(job_id)
    finally:
        close_old_connections()


def _run(job_id):
    with _run_lock:  # 한 번에 하나씩 (메모리 8GB)
        job = EmbeddingJob.objects.get(pk=job_id)
        job.status = "RUNNING"
        job.save(update_fields=["status"])
        try:
            papers = [job.paper] if job.paper else list(Paper.objects.filter(status__in=["READY", "FAILED"]))
            for paper in papers:
                if job.kind == "PROCESS":
                    _extract_and_chunk(job, paper)
                _embed(job, paper)
            _step(job, "index", "RUNNING")
            search.reset()
            n = search.stats()
            _step(job, "index", "DONE", {"papers": n["papers"], "chunks": n["chunks"], "embedded": n["embedded"]})
            _dev_eval(job)
            job.status = "DONE"
        except Exception as e:
            job.status = "FAILED"
            job.result = {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]}
            if job.paper:
                Paper.objects.filter(pk=job.paper_id).update(status="FAILED", error=str(e)[:500])
        finally:
            job.finished_at = timezone.now()
            job.save()


def _extract_and_chunk(job, paper):
    _step(job, "extract", "RUNNING")
    Paper.objects.filter(pk=paper.pk).update(status="PROCESSING", error="")
    chunks, stats = pdf_extract.extract(file_path(paper))
    _step(job, "extract", "DONE", {"pages": stats["pages"], "empty_pages": len(stats["empty_pages"]),
                                   "dropped_header_footer": stats["dropped_header_footer"]})
    if not chunks:
        raise ValueError("텍스트를 추출하지 못했습니다 (이미지만 있는 PDF 는 OCR 하지 않습니다).")
    _step(job, "chunk", "RUNNING")
    PaperChunk.objects.filter(paper=paper).delete()
    PaperChunk.objects.bulk_create([PaperChunk(paper=paper, idx=i, page=c["page"], text=c["text"]) for i, c in enumerate(chunks)])
    Paper.objects.filter(pk=paper.pk).update(pages=stats["pages"], stats=stats, embedding_status="STALE")
    _step(job, "chunk", "DONE", {"chunks": len(chunks)})


def _embed(job, paper):
    _step(job, "embed", "RUNNING", {"paper": paper.id})
    st = official.get()
    if st["vector"] != "ready":
        raise RuntimeError(f"임베딩 모델을 쓸 수 없습니다: {st['vector_reason']}")
    rows = list(PaperChunk.objects.filter(paper=paper).order_by("idx"))
    s = st["meta"]["settings"]
    V = st["model"].encode([s["passage_prefix"] + r.text for r in rows], batch_size=8, normalize_embeddings=True,
                           convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
    for r, v in zip(rows, V):
        r.vector = v.tobytes()
    PaperChunk.objects.bulk_update(rows, ["vector"], batch_size=200)
    Paper.objects.filter(pk=paper.pk).update(status="READY", embedding_status="EMBEDDED")
    _step(job, "embed", "DONE", {"paper": paper.id, "chunks": len(rows), "model": s["model"], "revision": s["revision"][:8]})


def _dev_eval(job):
    _step(job, "dev_eval", "RUNNING")
    prev = experiments.records()["dev_runs"].get("locked")
    r = experiments.run_dev("locked")
    s = r["summary"]
    _step(job, "dev_eval", "DONE", {"all_recall8": round(s["all"]["recall"], 4), "ko_recall8": round(s["ko"]["recall"], 4)})
    unchanged = abs(s["all"]["recall"] - OFFICIAL_DEV["all"]) < 1e-3 and abs(s["ko"]["recall"] - OFFICIAL_DEV["ko"]) < 1e-3
    detail = {
        "official_dev_record": OFFICIAL_DEV, "now": {"all": round(s["all"]["recall"], 4), "ko": round(s["ko"]["recall"], 4)},
        "previous_run": None if not prev else {"all": round(prev["summary"]["all"]["recall"], 4), "ran_at": prev["ran_at"]},
        "official_scope_unchanged": unchanged,
        "upload_scope": "NOT_MEASURED",
        "note": "업로드 문헌은 공식 corpus 와 별도 범위라 공식 dev 점수는 바뀌지 않아야 합니다. 업로드 범위는 정답 라벨이 없어 recall 을 계산하지 않습니다.",
    }
    _step(job, "compare", "DONE" if unchanged else "FAILED", detail)
    job.result = {"dev": detail}
    job.save(update_fields=["result"])
    json.dumps(detail)  # 저장 가능한 값인지 확인
