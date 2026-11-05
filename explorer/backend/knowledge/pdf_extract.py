"""PDF → 문단(청크). 기존 HRSG 앱 rag/prototype/build_corpus.py 의 추출·문단 규칙을 그대로 옮겼습니다.

- PyMuPDF 텍스트 블록을 경계로 삼고, 짧은 블록은 같은 페이지 안에서 MIN_CHARS 이상이 되게 합칩니다.
- MAX_CHARS 를 넘는 블록만 문장 경계에서 나눕니다. 반복되는 머리말·꼬리말과 25자 미만 조각은 뺍니다.
- 텍스트가 없는(이미지만 있는) 페이지는 OCR 하지 않고 빈 페이지로 기록합니다. 읽지 못한 내용을 만들지 않습니다.
"""

import re
from collections import Counter

import pymupdf

MIN_CHARS = 300
MAX_CHARS = 2000
SPLIT_TARGET = 1200
MIN_FRAGMENT = 25


def _clean(text):
    text = text.replace("­", "")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # 줄끝 하이픈
    return re.sub(r"\s+", " ", text).strip()


def _split_long(text):
    sentences = re.split(r"(?<=[.?!다])\s+", text)
    parts, cur = [], ""
    for s in sentences:
        if cur and len(cur) + len(s) + 1 > SPLIT_TARGET:
            parts.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        parts.append(cur)
    out = []
    for p in parts:
        while len(p) > MAX_CHARS:
            out.append(p[:SPLIT_TARGET])
            p = p[SPLIT_TARGET:]
        out.append(p)
    return out


def _header_footer_keys(doc):
    if doc.page_count < 4:
        return set()
    seen = Counter()
    for page in doc:
        h = page.rect.height
        keys = set()
        for b in page.get_text("blocks"):
            if b[6] != 0:
                continue
            if b[1] < h * 0.08 or b[3] > h * 0.92:
                keys.add(re.sub(r"\d+", "#", _clean(b[4]))[:120])
        seen.update(keys)
    return {k for k, n in seen.items() if n >= max(3, doc.page_count * 0.3)}


def metadata(path):
    """PDF 안의 제목·저자 (있을 때만 — 없으면 빈 값, 추측하지 않음)."""
    with pymupdf.open(path) as doc:
        m = doc.metadata or {}
        return {"title": (m.get("title") or "").strip(), "author": (m.get("author") or "").strip(), "pages": doc.page_count}


def extract(path):
    """→ (청크 [{page, text}], 통계)"""
    doc = pymupdf.open(path)
    try:
        hf = _header_footer_keys(doc)
        chunks = []
        stats = {"pages": doc.page_count, "empty_pages": [], "dropped_header_footer": 0, "dropped_fragments": 0, "split_long_blocks": 0}
        for pno, page in enumerate(doc, 1):
            blocks = []
            h = page.rect.height
            for b in page.get_text("blocks", flags=pymupdf.TEXTFLAGS_BLOCKS | pymupdf.TEXT_DEHYPHENATE):
                if b[6] != 0:
                    continue
                text = _clean(b[4])
                if not text:
                    continue
                edge = b[1] < h * 0.08 or b[3] > h * 0.92
                if edge and re.sub(r"\d+", "#", text)[:120] in hf:
                    stats["dropped_header_footer"] += 1
                    continue
                if len(text) < MIN_FRAGMENT:
                    stats["dropped_fragments"] += 1
                    continue
                if len(text) > MAX_CHARS:
                    stats["split_long_blocks"] += 1
                    blocks.extend(_split_long(text))
                else:
                    blocks.append(text)
            if not blocks:
                stats["empty_pages"].append(pno)
                continue
            page_chunks, buf = [], ""
            for text in blocks:
                buf = f"{buf} {text}".strip() if buf else text
                if len(buf) >= MIN_CHARS:
                    page_chunks.append(buf)
                    buf = ""
            if buf:
                if page_chunks and len(page_chunks[-1]) + len(buf) <= MAX_CHARS:
                    page_chunks[-1] = f"{page_chunks[-1]} {buf}"
                else:
                    page_chunks.append(buf)
            chunks += [{"page": pno, "text": t} for t in page_chunks]
        return chunks, stats
    finally:
        doc.close()
