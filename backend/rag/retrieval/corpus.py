"""코퍼스 읽기.

파일 형식 (코퍼스 폴더 안)
  corpus.jsonl    한 줄에 문단 하나: chunk_id, doc_id, text, pdf_page, printed_page, source_type, lang
  documents.json  문헌 정보: {doc_id: {title, file_name, citation, doi, url, access_status, ...}}

문단 텍스트와 ID 는 읽기만 하고 고치지 않습니다. 코퍼스 해시는 (chunk_id, text) 순서 목록으로 계산하므로
문단이 하나라도 바뀌면 해시가 달라지고, 저장된 벡터와의 불일치를 감지할 수 있습니다.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    text: str
    pdf_page: int
    printed_page: str | None
    source_type: str  # "pdf_text"(원문 추출) | "summary_note"(요약 노트)
    lang: str


class Corpus:
    def __init__(self, chunks, documents, path):
        self.chunks = chunks
        self.documents = documents
        self.path = Path(path)
        self.by_id = {c.chunk_id: i for i, c in enumerate(chunks)}
        self.hash = corpus_hash(chunks)

    def __len__(self):
        return len(self.chunks)

    def doc(self, doc_id):
        return self.documents.get(doc_id, {})


def corpus_hash(chunks):
    h = hashlib.sha256()
    for c in chunks:
        h.update(c.chunk_id.encode())
        h.update(b"\t")
        h.update(c.text.encode())
        h.update(b"\n")
    return h.hexdigest()


def load_corpus(folder):
    folder = Path(folder)
    chunks = []
    seen = set()
    with open(folder / "corpus.jsonl", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            if not line.strip():
                continue
            r = json.loads(line)
            if r["chunk_id"] in seen:
                raise ValueError(f"corpus.jsonl {line_no}행: 문단 ID 중복 {r['chunk_id']}")
            seen.add(r["chunk_id"])
            chunks.append(Chunk(r["chunk_id"], r["doc_id"], r["text"], r["pdf_page"], r.get("printed_page"),
                                r.get("source_type", "pdf_text"), r.get("lang", "")))
    documents = json.loads((folder / "documents.json").read_text(encoding="utf-8"))
    missing = {c.doc_id for c in chunks} - set(documents)
    if missing:
        raise ValueError(f"documents.json 에 없는 문헌 ID: {sorted(missing)[:5]}")
    return Corpus(chunks, documents, folder)
