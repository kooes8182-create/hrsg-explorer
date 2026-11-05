import hashlib

from django.db import transaction
from rest_framework.decorators import api_view, parser_classes
from rest_framework.exceptions import NotFound
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response

from system.errors import api_error

from . import pdf_extract, pipeline, search
from .models import EmbeddingJob, Paper
from .storage import MAX_BYTES, UPLOAD_DIR, file_path


def _paper(pid):
    try:
        return Paper.objects.get(pk=pid)
    except Paper.DoesNotExist:
        raise NotFound()


def paper_payload(p):
    job = p.jobs.order_by("-id").first()
    return {"id": p.id, "title": p.title, "authors": p.authors, "year": p.year, "doi": p.doi, "file_name": p.file_name,
            "file_size": p.file_size, "pages": p.pages, "chunks": p.chunks.count(), "status": p.status,
            "embedding_status": p.embedding_status, "version": p.version, "error": p.error, "stats": p.stats,
            "scope": "UPLOAD", "created_at": p.created_at, "updated_at": p.updated_at, "last_job": job and job_payload(job)}


def job_payload(j):
    return {"id": j.id, "paper": j.paper_id, "kind": j.kind, "status": j.status, "steps": j.steps, "result": j.result,
            "created_at": j.created_at, "finished_at": j.finished_at}


def _run(kind, paper=None):
    if EmbeddingJob.objects.filter(status__in=["QUEUED", "RUNNING"]).exists():
        return None
    job = EmbeddingJob.objects.create(paper=paper, kind=kind)
    transaction.on_commit(lambda: pipeline.start(job))
    return job


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, JSONParser])
def uploads(request):
    if request.method == "GET":
        return Response({"papers": [paper_payload(p) for p in Paper.objects.all()], "index": search.stats()})
    f = request.FILES.get("file")
    if not f:
        return api_error("VALIDATION_ERROR", 400, "PDF 파일을 고르세요.", "Choose a PDF file.")
    if f.size > MAX_BYTES:
        return api_error("VALIDATION_ERROR", 400, "30 MB 이하 PDF 만 올릴 수 있습니다.", "PDF must be 30 MB or less.")
    data = f.read()
    if not data.startswith(b"%PDF"):
        return api_error("VALIDATION_ERROR", 400, "PDF 파일이 아닙니다.", "Not a PDF file.")
    sha = hashlib.sha256(data).hexdigest()
    if Paper.objects.filter(file_sha256=sha).exists():
        return api_error("DUPLICATE", 409, "같은 파일이 이미 올라와 있습니다.", "This file was already uploaded.")
    if EmbeddingJob.objects.filter(status__in=["QUEUED", "RUNNING"]).exists():
        return api_error("BUSY", 409, "다른 문헌을 처리하는 중입니다. 끝난 뒤 다시 올려 주세요.", "Another document is processing. Try again after it finishes.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / f"{sha}.pdf").write_bytes(data)
    try:
        meta = pdf_extract.metadata(UPLOAD_DIR / f"{sha}.pdf")
    except Exception:
        (UPLOAD_DIR / f"{sha}.pdf").unlink(missing_ok=True)
        return api_error("VALIDATION_ERROR", 400, "PDF 를 열 수 없습니다 (손상·암호).", "Cannot open the PDF (damaged or encrypted).")
    year = request.data.get("year")
    with transaction.atomic():
        p = Paper.objects.create(
            title=(request.data.get("title") or meta["title"] or f.name)[:300],
            authors=[a.strip() for a in (request.data.get("authors") or meta["author"] or "").split(";") if a.strip()],
            year=int(year) if str(year or "").isdigit() else None, doi=(request.data.get("doi") or "")[:200],
            file_name=f.name[:255], file_sha256=sha, file_size=f.size, pages=meta["pages"])
        job = _run("PROCESS", p)
    return Response({"paper": paper_payload(p), "job": job and job_payload(job)}, status=201)


@api_view(["GET", "PATCH", "DELETE"])
def upload_detail(request, pid):
    p = _paper(pid)
    if request.method == "DELETE":
        if p.jobs.filter(status__in=["QUEUED", "RUNNING"]).exists():
            return api_error("BUSY", 409, "처리 중인 문헌은 삭제할 수 없습니다.", "Cannot delete while processing.")
        path = file_path(p)
        p.delete()
        path.unlink(missing_ok=True)
        search.reset()
        return Response(status=204)
    if request.method == "PATCH":
        d = request.data
        if "title" in d:
            if not str(d["title"]).strip():
                return api_error("VALIDATION_ERROR", 400, "제목을 입력하세요.", "Enter a title.")
            p.title = str(d["title"]).strip()[:300]
        if "authors" in d:
            p.authors = [str(a).strip() for a in (d["authors"] if isinstance(d["authors"], list) else str(d["authors"]).split(";")) if str(a).strip()]
        if "year" in d:
            y = str(d["year"] or "").strip()
            if y and not (y.isdigit() and 1800 <= int(y) <= 2100):
                return api_error("VALIDATION_ERROR", 400, "연도는 1800~2100 숫자입니다.", "Year must be 1800–2100.")
            p.year = int(y) if y else None
        if "doi" in d:
            p.doi = str(d["doi"] or "").strip()[:200]
        p.save()
        search.reset()
    return Response(paper_payload(p))


@api_view(["GET"])
def upload_chunks(request, pid):
    p = _paper(pid)
    return Response([{"idx": c.idx, "page": c.page, "text": c.text, "embedded": c.vector is not None} for c in p.chunks.all()])


@api_view(["POST"])
def upload_reprocess(request, pid):
    p = _paper(pid)
    p.version += 1
    p.save(update_fields=["version"])
    job = _run("PROCESS", p)
    if not job:
        return api_error("BUSY", 409, "다른 작업이 진행 중입니다.", "Another job is running.")
    return Response(job_payload(job), status=202)


@api_view(["POST"])
def upload_reembed(request, pid):
    p = _paper(pid)
    if not p.chunks.exists():
        return api_error("VALIDATION_ERROR", 400, "청크가 없습니다. 먼저 재처리하세요.", "No chunks — reprocess first.")
    job = _run("REEMBED", p)
    if not job:
        return api_error("BUSY", 409, "다른 작업이 진행 중입니다.", "Another job is running.")
    return Response(job_payload(job), status=202)


@api_view(["POST"])
def reindex(request):
    """업로드 문헌 전체 재임베딩 + 인덱스 갱신 + dev 확인. 공식 corpus 는 바꾸지 않습니다."""
    if not Paper.objects.filter(status="READY").exists():
        return api_error("VALIDATION_ERROR", 400, "재색인할 업로드 문헌이 없습니다. 공식 corpus 는 읽기 전용입니다.",
                         "No uploaded documents to reindex. The official corpus is read-only.")
    job = _run("REINDEX")
    if not job:
        return api_error("BUSY", 409, "다른 작업이 진행 중입니다.", "Another job is running.")
    return Response(job_payload(job), status=202)


@api_view(["GET"])
def jobs(request):
    return Response([job_payload(j) for j in EmbeddingJob.objects.all()[:20]])


@api_view(["POST"])
def upload_search(request):
    q = str((request.data or {}).get("question") or "").strip()
    if not q:
        return api_error("VALIDATION_ERROR", 400, "질문을 입력하세요.", "Enter a question.")
    return Response({"scope": "UPLOAD", "measured": False, "results": search.search(q, 8)})
