"""Phase 6: Excel 가져오기·내보내기, 문헌 갱신 파이프라인.
임베딩(BGE-M3)·dev 재채점은 무거워 여기서는 대체하고, 실제 모델로는 화면 점검에서 한 번 실행합니다."""

import io
import tempfile
from pathlib import Path
from unittest import mock

import numpy as np
import pymupdf
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient

from rag import official

from . import pipeline, search
from accounts.testing import admin_client, plant_client, unlock
from .models import Paper


def make_pdf(text_pages):
    doc = pymupdf.open()
    for t in text_pages:
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 80, 550, 780), t, fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


class ExcelTests(TestCase):
    def setUp(self):
        self.api = plant_client()
        self.cid = self.api.post("/api/cases/", {"name": "XL"}, format="json").json()["id"]

    def workbook(self):
        r = self.api.get(f"/api/cases/{self.cid}/checklist/export/")
        self.assertEqual(r.status_code, 200)
        return load_workbook(io.BytesIO(r.content))

    def upload(self, wb, apply=False):
        buf = io.BytesIO()
        wb.save(buf)
        f = SimpleUploadedFile("reply.xlsx", buf.getvalue())
        return self.api.post(f"/api/cases/{self.cid}/checklist/import/{'?apply=1' if apply else ''}", {"file": f}, format="multipart")

    def set(self, wb, iid, **vals):
        ws = wb["체크리스트"]
        head = [c.value for c in ws[1]]
        for row in ws.iter_rows(min_row=2):
            if row[0].value == iid:
                for k, v in vals.items():
                    row[head.index(k)].value = v

    def test_export_and_template(self):
        wb = self.workbook()
        ws = wb["체크리스트"]
        self.assertEqual([c.value for c in ws[1]], ["ID", "카테고리", "항목", "단위", "이유", "필수", "우선순위", "측정값", "수급 상태", "검증 상태", "검토", "메모"])
        self.assertEqual(ws.max_row, 50)  # 머리글 + 키트 49개
        self.assertIn("안내", wb.sheetnames)
        t = self.api.get("/api/checklist/template/")
        self.assertEqual(t["Content-Type"].split(";")[0], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        tw = load_workbook(io.BytesIO(t.content))["체크리스트"]
        self.assertIsNone(tw.cell(2, 9).value)  # 표준 양식은 상태 칸이 비어 있음 (키트 export_rows template)

    def test_template_reply_marks_verify_needed(self):
        """README 기대값: 표준 양식에 A-02 측정값을 채워 가져오면 A-02 가 「검증 필요」."""
        t = self.api.get("/api/checklist/template/")
        wb = load_workbook(io.BytesIO(t.content))
        self.set(wb, "A-02", **{"측정값": 350})
        r = self.upload(wb).json()
        rows = {x["id"]: x for x in r["rows"]}
        self.assertEqual(rows["A-02"]["changes"]["supply_status"], ["NOT_ENTERED", "NEEDS_CHECK"])
        self.assertFalse(r["applied"])
        self.assertEqual(self.upload(wb, apply=True).status_code, 200)
        items = {i["id"]: i for i in self.api.get(f"/api/cases/{self.cid}/checklist/").json()["items"]}
        self.assertEqual((items["A-02"]["state"]["value"], items["A-02"]["state"]["supply_status"]), ("350", "NEEDS_CHECK"))

    def test_preview_blocks_non_numeric_and_unknown_id(self):
        wb = self.workbook()
        self.set(wb, "A-01", **{"측정값": "abc"})
        wb["체크리스트"].append(["Z-99", "", "", "", "", "", "", 1])
        r = self.upload(wb).json()
        rows = {x["id"]: x for x in r["rows"]}
        self.assertIn("숫자가 아닙니다", " ".join(i["message"] for i in rows["A-01"]["issues"]))
        self.assertIn("알 수 없는 항목 ID", " ".join(i["message"] for i in rows["Z-99"]["issues"]))
        self.assertEqual(self.upload(wb, apply=True).status_code, 400)
        items = {i["id"]: i for i in self.api.get(f"/api/cases/{self.cid}/checklist/").json()["items"]}
        self.assertIsNone(items["A-01"]["state"]["value"])

    def test_rejects_non_template(self):
        from openpyxl import Workbook
        wb = Workbook()
        wb.active.append(["아무", "열"])
        self.assertEqual(self.upload(wb).status_code, 400)


def fake_embed(job, paper):
    """BGE-M3 대신 결정적 단위 벡터 (테스트용)."""
    rows = list(paper.chunks.order_by("idx"))
    rng = np.random.default_rng(0)
    for r in rows:
        v = rng.normal(size=1024).astype(np.float32)
        r.vector = (v / np.linalg.norm(v)).tobytes()
    type(rows[0]).objects.bulk_update(rows, ["vector"])
    Paper.objects.filter(pk=paper.pk).update(status="READY", embedding_status="EMBEDDED")
    pipeline._step(job, "embed", "DONE", {"chunks": len(rows)})


class PipelineTests(TestCase):
    def setUp(self):
        self.api = admin_client()
        self._unlock = unlock("kb-uploads", "kb-upload-detail", "kb-upload-reprocess", "kb-upload-reembed", "kb-reindex")
        self._unlock.__enter__()
        self.addCleanup(self._unlock.__exit__, None, None, None)
        search.reset()
        tmp = Path(tempfile.mkdtemp())  # 실제 업로드 폴더를 쓰지 않음
        self.patches = [mock.patch("knowledge.storage.UPLOAD_DIR", tmp), mock.patch("knowledge.views.UPLOAD_DIR", tmp),mock.patch.object(pipeline, "start", lambda job: pipeline._run(job.id)),
                        mock.patch.object(pipeline, "_embed", fake_embed),
                        mock.patch.object(pipeline, "_dev_eval", lambda job: pipeline._step(job, "dev_eval", "DONE", {"stub": True})),
                        mock.patch.dict(official.get(load_model=False), {"vector": "unavailable", "vector_reason": "테스트: 임베딩 끔"})]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def upload(self, data, name="test.pdf", **meta):
        with self.captureOnCommitCallbacks(execute=True):
            return self.api.post("/api/knowledge/uploads/", {"file": SimpleUploadedFile(name, data), **meta}, format="multipart")

    def test_upload_extract_chunk_index_search_delete(self):
        text = ("Heat recovery steam generator fouling increases the gas side pressure drop and the gas turbine back pressure. " * 6)
        pdf = make_pdf([text, "Economizer steaming happens when the approach temperature is too small. " * 6])
        r = self.upload(pdf, title="가상 업로드 문헌", authors="Kim; Lee", year="2024")
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()["paper"]["id"]
        p = self.api.get(f"/api/knowledge/uploads/{pid}/").json()
        self.assertEqual(p["status"], "READY")
        self.assertEqual(p["pages"], 2)
        self.assertGreaterEqual(p["chunks"], 2)
        self.assertEqual(p["authors"], ["Kim", "Lee"])
        steps = {s["key"]: s["status"] for s in p["last_job"]["steps"]}
        self.assertEqual(steps["extract"], "DONE")
        self.assertEqual(steps["index"], "DONE")
        hits = self.api.post("/api/knowledge/upload-search/", {"question": "economizer steaming approach"}, format="json").json()
        self.assertFalse(hits["measured"])
        self.assertEqual(hits["results"][0]["scope"], "UPLOAD")
        self.assertIn("steaming", hits["results"][0]["text"])
        # 같은 파일 다시 올리면 409, 원본 PDF 를 내려받는 주소는 없음
        self.assertEqual(self.upload(pdf).status_code, 409)
        self.assertEqual(self.api.patch(f"/api/knowledge/uploads/{pid}/", {"year": "abc"}, format="json").status_code, 400)
        self.assertEqual(self.api.delete(f"/api/knowledge/uploads/{pid}/").status_code, 204)
        self.assertEqual(self.api.get("/api/knowledge/uploads/").json()["index"]["chunks"], 0)

    def test_rejects_non_pdf_and_image_only(self):
        self.assertEqual(self.upload(b"hello", name="x.pdf").status_code, 400)
        doc = pymupdf.open()
        doc.new_page()  # 글자 없는 페이지 → 추출 실패로 기록 (OCR 안 함)
        r = self.upload(doc.tobytes(), name="blank.pdf")
        self.assertEqual(r.status_code, 201)
        p = Paper.objects.get(pk=r.json()["paper"]["id"])
        self.assertEqual(p.status, "FAILED")
        self.assertIn("OCR", p.error)

    def test_official_corpus_never_changes(self):
        self.assertEqual(self.api.get("/api/knowledge/papers/").json()["index"]["chunks"], 1797)
