from django.db import models


class Paper(models.Model):
    """사용자가 올린 문헌 (업로드 범위). 공식 평가셋 corpus 와는 별도이며 recall 측정 범위에 들어가지 않습니다."""

    title = models.CharField(max_length=300)
    authors = models.JSONField(default=list)
    year = models.IntegerField(null=True, blank=True)
    doi = models.CharField(max_length=200, blank=True, default="")
    file_name = models.CharField(max_length=255)
    file_sha256 = models.CharField(max_length=64, unique=True)  # 같은 파일 중복 업로드 방지
    file_size = models.IntegerField(default=0)
    pages = models.IntegerField(default=0)
    status = models.CharField(max_length=20, default="QUEUED")  # QUEUED | PROCESSING | READY | FAILED
    embedding_status = models.CharField(max_length=20, default="MISSING")  # MISSING | EMBEDDED | STALE
    version = models.IntegerField(default=1)  # 재처리할 때마다 +1
    error = models.TextField(blank=True, default="")
    stats = models.JSONField(default=dict)  # 빈 페이지·머리말 제거 수 등
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-id"]


class PaperChunk(models.Model):
    paper = models.ForeignKey(Paper, on_delete=models.CASCADE, related_name="chunks")
    idx = models.IntegerField()
    page = models.IntegerField()
    text = models.TextField()
    vector = models.BinaryField(null=True)  # BGE-M3 1024차원 float32 (공식 벡터와 같은 모델·리비전)

    class Meta:
        ordering = ["paper_id", "idx"]


class EmbeddingJob(models.Model):
    """처리 작업: 텍스트 추출 → 청킹 → 임베딩 → 인덱스 갱신 → dev 평가 → 이전 결과 비교. 단계별 상태를 기록합니다."""

    paper = models.ForeignKey(Paper, null=True, on_delete=models.SET_NULL, related_name="jobs")
    kind = models.CharField(max_length=20)  # PROCESS | REEMBED | REINDEX
    status = models.CharField(max_length=20, default="QUEUED")  # QUEUED | RUNNING | DONE | FAILED
    steps = models.JSONField(default=list)  # [{key, status, detail, at}]
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
