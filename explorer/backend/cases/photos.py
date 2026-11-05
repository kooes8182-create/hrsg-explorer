"""체크리스트 사진 저장. 크기·형식을 파일 내용(앞부분 바이트)으로 확인합니다 — 확장자·브라우저가 알려 준 형식은 믿지 않음."""

import uuid

from django.conf import settings
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import ChecklistAttachment

PHOTO_DIR = settings.BASE_DIR.parent / "data/checklist_photos"
MAX_BYTES = 10 * 1024 * 1024
MAX_PER_ITEM = 10


def sniff(head: bytes):
    """→ (content_type, 확장자) 또는 None. JPEG·PNG·WEBP·HEIC/HEIF(아이폰 기본)만 허용."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", "webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"heif", b"hevc"):
        return "image/heic", "heic"
    return None


def save(case, item_id, upload):
    data = upload.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return None, ("10 MB 이하 사진만 올릴 수 있습니다.", "Photos must be 10 MB or smaller.")
    kind = sniff(data[:16])
    if not kind:
        return None, ("JPEG·PNG·WEBP·HEIC 사진만 올릴 수 있습니다.", "Only JPEG, PNG, WEBP or HEIC photos.")
    if ChecklistAttachment.objects.filter(case=case, item_id=item_id).count() >= MAX_PER_ITEM:
        return None, (f"항목당 사진은 {MAX_PER_ITEM}장까지입니다.", f"Up to {MAX_PER_ITEM} photos per item.")
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.{kind[1]}"
    (PHOTO_DIR / stored).write_bytes(data)
    name = (getattr(upload, "name", "") or "photo")[:200]
    return ChecklistAttachment.objects.create(case=case, item_id=item_id, stored_name=stored, original_name=name,
                                              content_type=kind[0], size=len(data)), None


def path(att):
    return PHOTO_DIR / att.stored_name


@receiver(post_delete, sender=ChecklistAttachment)
def _remove_file(sender, instance, **kwargs):
    """사진 기록이 지워지면(사진 삭제·케이스 삭제) 파일도 함께 지웁니다."""
    try:
        path(instance).unlink(missing_ok=True)
    except OSError:
        pass
