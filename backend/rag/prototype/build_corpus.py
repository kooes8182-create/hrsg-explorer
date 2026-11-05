"""reference/papers/ PDF → 개인 프로토타입 코퍼스 (data/prototype/).

⚠ 이 코퍼스는 공식 협업 corpus.json(문헌 47건, 약 1,800문단)과 다른 자료입니다. 같은 기준선이라고 표현하지 않습니다.

처리 원칙
  - 원본 PDF 는 읽기만 합니다 (수정·이동·복사 없음).
  - 참고문헌 엑셀은 서지정보(제목·DOI/URL) 연결에만 쓰고 본문으로 넣지 않습니다.
  - access_status.csv 에서 open_license / free_access 인 문헌만 원문 추출합니다.
    paywalled 는 원문을 넣지 않고, data/prototype/notes/<파일이름>.json 요약 노트가 있을 때만 그 노트를 씁니다.
    unknown(사용 가능 여부 확인 불가)은 넣지 않고 보고서에 기록합니다.
  - 바이트가 같은 중복 PDF 는 하나만 씁니다.
  - 텍스트가 없는(이미지만 있는) 페이지는 OCR 하지 않고 '누락'으로 기록합니다. 읽지 못한 내용을 만들지 않습니다.
  - 페이지 번호: pdf_page = PDF 의 실제 쪽 순서(1부터). printed_page = PDF 에 페이지 라벨이 들어 있을 때만 그 값.

문단 나누기 (PyMuPDF 텍스트 블록 기준)
  - 블록(PDF 가 가진 문단 묶음)을 경계로 삼고, 블록 중간을 자르지 않습니다.
  - 짧은 블록은 같은 페이지의 다음 블록과 합쳐 MIN_CHARS 이상이 되게 합니다. 페이지를 넘어 합치지 않습니다(페이지 추적).
  - MAX_CHARS 를 넘는 블록만 문장 경계에서 나눕니다.
  - 여러 쪽에 반복되는 머리말·꼬리말과 25자 미만 조각(쪽번호 등)은 뺍니다.
"""

import csv
import hashlib
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pymupdf

MIN_CHARS = 300
MAX_CHARS = 2000
SPLIT_TARGET = 1200
MIN_FRAGMENT = 25
INCLUDED_STATUS = ("open_license", "free_access")


# ---------------------------------------------------------------- 서지정보 (엑셀)

def read_bibliography(xlsx_path):
    """엑셀 첫 시트: No | 서지정보(APA) | 파일명 → {파일명: {...}} (표준 라이브러리로 읽음)."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    z = zipfile.ZipFile(xlsx_path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    out = {}
    for row in sheet.iter(f"{{{ns['m']}}}row"):
        vals = []
        for c in row.findall("m:c", ns):
            v = c.find("m:v", ns)
            if c.get("t") == "s" and v is not None:
                vals.append(shared[int(v.text)])
            elif c.get("t") == "inlineStr":
                vals.append("".join(x.text or "" for x in c.iter(f"{{{ns['m']}}}t")))
            else:
                vals.append(v.text if v is not None else "")
        if len(vals) >= 3 and vals[2].lower().endswith(".pdf"):
            out[vals[2].strip()] = {"no": vals[0], "citation": vals[1].strip(), **parse_apa(vals[1])}
    return out


def parse_apa(cit):
    """APA 문자열에서 저자 약칭·연도·제목·DOI/URL 을 꺼냅니다 (찾지 못하면 None)."""
    m = re.search(r"\((\d{4}|n\.d\.)\)\.\s*", cit)
    authors, year, title = None, None, None
    if m:
        authors = cit[:m.start()].strip().rstrip(".")
        year = m.group(1)
        rest = cit[m.end():]
        depth = 0
        for i, ch in enumerate(rest):  # 괄호 [..] (..) 안의 마침표는 제목 끝으로 보지 않음
            if ch in "[(":
                depth += 1
            elif ch in "])":
                depth -= 1
            elif ch == "." and depth == 0 and (i + 1 == len(rest) or rest[i + 1] == " "):
                title = rest[:i].strip()
                break
    doi = re.search(r"https?://doi\.org/\S+", cit)
    url = re.search(r"https?://\S+", cit)
    first = authors.split(",")[0].strip() if authors else None
    return {"authors": authors, "first_author": first, "year": year, "title": title,
            "doi": doi.group(0).rstrip(".") if doi else None,
            "url": None if doi else (url.group(0).rstrip(".") if url else None)}


# ---------------------------------------------------------------- 문단 추출

def _clean(text):
    text = text.replace("­", "")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # 줄끝 하이픈
    return re.sub(r"\s+", " ", text).strip()


def _lang(text):
    hangul = len(re.findall(r"[가-힣]", text))
    han = len(re.findall(r"[一-鿿]", text))
    letters = len(re.findall(r"[A-Za-z]", text))
    if hangul > max(han, letters * 0.3):
        return "ko"
    if han > letters * 0.3:
        return "zh"
    return "en"


def _split_long(text):
    """MAX_CHARS 초과 블록만 문장 끝(. ? ! 다.)에서 SPLIT_TARGET 근처로 나눔."""
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
    # 문장 경계가 없어 여전히 긴 조각은 글자 수로 자름 (표·수식 덩어리)
    out = []
    for p in parts:
        while len(p) > MAX_CHARS:
            out.append(p[:SPLIT_TARGET])
            p = p[SPLIT_TARGET:]
        out.append(p)
    return out


def _header_footer_keys(doc):
    """페이지 위·아래 8% 영역에 30% 이상 페이지에서 반복되는 블록(숫자는 무시하고 비교)."""
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


def extract_pdf(path, doc_id):
    """PDF 한 개 → (문단 목록, 통계)."""
    doc = pymupdf.open(path)
    hf = _header_footer_keys(doc)
    chunks = []
    stats = {"pages": doc.page_count, "empty_pages": [], "dropped_header_footer": 0, "dropped_fragments": 0,
             "split_long_blocks": 0}
    for pno, page in enumerate(doc, 1):
        label = page.get_label() or None
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
        if buf:  # 페이지 끝의 짧은 나머지는 같은 페이지 앞 문단에 붙임 (너무 길어지지 않을 때)
            if page_chunks and len(page_chunks[-1]) + len(buf) <= MAX_CHARS:
                page_chunks[-1] = f"{page_chunks[-1]} {buf}"
            else:
                page_chunks.append(buf)
        for n, text in enumerate(page_chunks, 1):
            chunks.append({"chunk_id": f"{doc_id}:p{pno:03d}:{n:02d}", "doc_id": doc_id, "text": text,
                           "pdf_page": pno, "printed_page": label, "source_type": "pdf_text", "lang": _lang(text)})
    return chunks, stats


def load_note(path, doc_id):
    """유료 문헌 요약 노트: [{"pdf_page": 3, "printed_page": "196", "text": "..."}] (사람이 페이지를 적어 둔 것만)."""
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for n, r in enumerate(rows, 1):
        if not r.get("text", "").strip() or not isinstance(r.get("pdf_page"), int):
            continue
        out.append({"chunk_id": f"{doc_id}:note:p{r['pdf_page']:03d}:{n:02d}", "doc_id": doc_id,
                    "text": r["text"].strip(), "pdf_page": r["pdf_page"], "printed_page": r.get("printed_page"),
                    "source_type": "summary_note", "lang": _lang(r["text"])})
    return out


# ---------------------------------------------------------------- 전체 실행

def read_access(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {r["file_name"].strip(): r for r in csv.DictReader(f)}


def doc_id_for(file_name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(file_name).stem)


def build(papers_dir, bib_xlsx, out_dir):
    papers_dir, out_dir = Path(papers_dir), Path(out_dir)
    access = read_access(out_dir / "access_status.csv")
    bib = read_bibliography(bib_xlsx) if Path(bib_xlsx).exists() else {}
    notes_dir = out_dir / "notes"

    report = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "papers_dir": str(papers_dir), "label": "개인 프로토타입 코퍼스 — 공식 협업 corpus.json 과 다른 자료",
              "included": [], "excluded": [], "duplicates": [], "missing_files": [], "not_in_bibliography": [],
              "empty_pages": {}, "image_only_documents": []}
    documents, chunks, by_hash = {}, [], {}

    pdfs = sorted(p for p in papers_dir.iterdir() if p.suffix.lower() == ".pdf")
    for p in pdfs:
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        if sha in by_hash:
            report["duplicates"].append({"file_name": p.name, "same_as": by_hash[sha]})
            continue
        by_hash[sha] = p.name
        acc = access.get(p.name)
        status = acc["status"] if acc else "unknown"
        basis = acc["basis"] if acc else "access_status.csv 에 없음 (사용 가능 여부 미확인)"
        b = bib.get(p.name)
        if b is None:
            report["not_in_bibliography"].append(p.name)
        doc_id = doc_id_for(p.name)
        meta = {"doc_id": doc_id, "file_name": p.name, "sha256": sha, "access_status": status, "access_basis": basis,
                "title": (b or {}).get("title") or p.stem, "first_author": (b or {}).get("first_author"),
                "year": (b or {}).get("year"), "doi": (b or {}).get("doi"), "url": (b or {}).get("url"),
                "citation": (b or {}).get("citation")}

        if status in INCLUDED_STATUS:
            doc_chunks, st = extract_pdf(p, doc_id)
            meta.update(source_type="pdf_text", pages=st["pages"], empty_pages=st["empty_pages"])
            if st["empty_pages"]:
                report["empty_pages"][p.name] = st["empty_pages"]
            if not doc_chunks:
                report["image_only_documents"].append(p.name)
                report["excluded"].append({"file_name": p.name, "status": status,
                                           "reason": f"텍스트를 추출할 수 없음 (이미지만 있는 PDF, {st['pages']}쪽 모두). OCR 하지 않음"})
                continue
            meta["chunks"] = len(doc_chunks)
            report["included"].append({"file_name": p.name, "doc_id": doc_id, "status": status, "chunks": len(doc_chunks),
                                       **{k: st[k] for k in ("pages", "dropped_header_footer", "dropped_fragments",
                                                             "split_long_blocks")}})
        elif status == "paywalled" and (notes_dir / f"{p.stem}.json").exists():
            doc_chunks = load_note(notes_dir / f"{p.stem}.json", doc_id)
            meta.update(source_type="summary_note", chunks=len(doc_chunks))
            report["included"].append({"file_name": p.name, "doc_id": doc_id, "status": status,
                                       "chunks": len(doc_chunks), "source": "summary_note"})
        else:
            reason = {"paywalled": "유료 원문 — 협업안에 따라 원문 제외, 페이지별 요약 노트 미제공",
                      "unknown": "사용 가능 여부 확인 불가"}.get(status, f"상태 '{status}'")
            report["excluded"].append({"file_name": p.name, "status": status, "reason": reason, "basis": basis})
            continue
        documents[doc_id] = meta
        chunks.extend(doc_chunks)

    pdf_names = {p.name for p in pdfs}
    report["missing_files"] = sorted(n for n in bib if n not in pdf_names)

    # 점검: 빈 문단, 문단 ID 중복, 같은 문장 반복(다른 문헌 간 동일 문단)
    report["empty_chunks"] = sum(1 for c in chunks if not c["text"].strip())
    ids = Counter(c["chunk_id"] for c in chunks)
    report["duplicate_chunk_ids"] = [k for k, n in ids.items() if n > 1]
    texts = Counter(c["text"] for c in chunks)
    report["identical_text_chunks"] = sum(n - 1 for n in texts.values() if n > 1)
    report["totals"] = {"pdf_files": len(pdfs), "documents_included": len(documents), "chunks": len(chunks),
                        "chunks_by_lang": dict(Counter(c["lang"] for c in chunks)),
                        "chunks_by_source": dict(Counter(c["source_type"] for c in chunks)),
                        "excluded": len(report["excluded"]), "duplicates": len(report["duplicates"])}

    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "corpus.jsonl", "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    (out_dir / "documents.json").write_text(json.dumps(documents, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "build_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report
