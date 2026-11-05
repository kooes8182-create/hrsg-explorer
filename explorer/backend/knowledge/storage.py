"""업로드 원본 PDF 보관 위치. 앱은 이 파일을 내려받는 주소를 제공하지 않습니다 (텍스트 추출·임베딩에만 사용)."""

from django.conf import settings

UPLOAD_DIR = settings.BASE_DIR.parent / "data/kb/uploads"
MAX_BYTES = 30 * 1024 * 1024


def file_path(paper):
    return UPLOAD_DIR / f"{paper.file_sha256}.pdf"
