"""Phase 5 테스트. 무거운 BGE-M3 는 여기서 불러오지 않습니다 (벡터 '사용 불가' 상태로 BM25 대체 경로를 시험).
공식 순위 100문항 재현은 `manage.py rag_verify` 로 따로 확인합니다 (모델 로딩 필요)."""

from unittest import mock

from django.test import SimpleTestCase, TestCase
from accounts.testing import admin_client, plant_client, unlock
from rag.models import SystemConfiguration

from . import masking
from . import official as O
from .answer import check_citations, unverified_numbers


class MaskingTests(SimpleTestCase):
    def test_t15_regex_and_custom_terms(self):
        text, found = masking.mask("가상발전소 담당 010-1234-5678, kim@example.com 에게 HRSG 차압 문의", ["가상발전소"])
        self.assertNotIn("010-1234-5678", text)
        self.assertNotIn("kim@example.com", text)
        self.assertNotIn("가상발전소", text)
        self.assertIn("HRSG 차압", text)
        self.assertEqual({f["type"] for f in found}, {"PHONE", "EMAIL", "TERM"})

    def test_numbers_that_are_not_phones_survive(self):
        text, found = masking.mask("배압 350 mmH2O, 2025년 SMP 112.73", [])
        self.assertEqual(found, [])
        self.assertIn("350", text)


class Bm25PortTests(SimpleTestCase):
    def test_tokens_match_js_rules(self):
        self.assertEqual(O.tokens("The HRSG pinch-point is 10°C, and ΔP!"), ["hrsg", "pinch-point", "10°c"])  # "is" 는 원본 불용어
        self.assertIn("economizer", O.expand_ko("절탄기 출구 온도"))
        self.assertEqual(O.expand_ko("economizer"), "economizer")

    def test_fuse_and_cap(self):
        order, score, rb, rv = O.fuse([1, 2, 3], [3, 1], 0.7, 30, 50, 60)
        self.assertEqual(order[0], 3)  # 벡터 1위(0.7 가중) + BM25 3위
        passages = [{"ref": "a"}, {"ref": "a"}, {"ref": "a"}, {"ref": "b"}]
        self.assertEqual(O.cap([0, 1, 2, 3], passages, 3, 2), ([0, 1, 3], [2]))


def _no_vectors():
    st = O.get(load_model=False)
    return mock.patch.dict(st, {"vector": "unavailable", "vector_reason": "테스트: 임베딩 끔"})


def set_settings(d):
    for k, v in d.items():
        SystemConfiguration.write(k, v if k != "sensitive_terms" else sorted(set(v)))


class ApiTests(TestCase):
    def setUp(self):
        self.api = plant_client()   # AI 엔지니어링 도우미 = 플랜트 엔지니어
        self.admin = admin_client()  # RAG 조회 = AI 관리자
        self.cid = self.api.post("/api/cases/", {"name": "P5"}, format="json").json()["id"]
        self.conv = self.api.post(f"/api/cases/{self.cid}/conversations/", {}, format="json").json()["id"]

    def ask(self, q, **extra):
        r = self.api.post(f"/api/conversations/{self.conv}/messages/", {"question": q, **extra}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_t14_no_fake_answer_when_ai_disabled_and_bm25_fallback(self):
        # 키는 있지만 외부 전송이 꺼진 상태 (실제 .env 의 키 유무와 상관없이 같은 결과가 나오게 고정)
        with _no_vectors(), mock.patch("rag.answer.api_key", return_value="test"), mock.patch("rag.answer.generate") as gen:
            out = self.ask("절탄기 핀치 포인트는 무엇인가요?")
        gen.assert_not_called()  # 꺼져 있으면 외부 AI 를 부르지 않음
        a = out["assistant"]
        self.assertEqual(a["text"], "")  # 가짜 답변 없음
        self.assertEqual(a["payload"]["generation"]["status"], "disabled")
        self.assertEqual(a["payload"]["mode"], "bm25")  # 임베딩 없음 → BM25 대체
        self.assertEqual(a["payload"]["requested_mode"], "hybrid")
        self.assertTrue(a["payload"]["fallback_reason"])
        self.assertTrue(1 <= len(a["payload"]["evidence"]) <= 8)
        refs = [e["ref"] for e in a["payload"]["evidence"]]
        self.assertTrue(all(refs.count(r) <= 2 for r in refs))  # 참고문헌당 2개

    def test_t15_masked_before_external_call_and_storage(self):
        set_settings({"ai_external_enabled": True, "sensitive_terms": ["가상고객사"]})
        sent = {}

        def fake_generate(q, passages, lang, calc_lines=None):
            sent["q"] = q
            return {"status": "ok", "text": "테스트 답변 [1]", "citations": [1], "warnings": []}

        with _no_vectors(), mock.patch("rag.answer.api_key", return_value="test"), mock.patch("rag.answer.generate", side_effect=fake_generate):
            out = self.ask("가상고객사 010-2222-3333 HRSG fouling 영향은?")
        self.assertNotIn("가상고객사", sent["q"])
        self.assertNotIn("010-2222-3333", sent["q"])
        self.assertNotIn("가상고객사", out["user"]["text"])  # DB 에도 가린 문장만
        self.assertTrue(out["assistant"]["payload"]["evidence"][0]["cited"])

    def test_snapshot_attached_question_is_saved(self):
        """스냅샷을 첨부한 질문도 저장되어야 함 (날짜 값 JSON 저장 오류 회귀 방지)."""
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        sid = self.api.post(f"/api/cases/{self.cid}/snapshots/", {"label": "t"}, format="json").json()["id"]
        set_settings({"ai_external_enabled": True})
        sent = {}

        def fake_generate(q, passages, lang, calc_lines=None):
            sent["calc"] = calc_lines
            return {"status": "ok", "text": "1. 핵심 요약\n1.89 MW [1]", "citations": [1], "warnings": []}

        with _no_vectors(), mock.patch("rag.answer.api_key", return_value="test"), mock.patch("rag.answer.generate", side_effect=fake_generate):
            out = self.ask("출력 손실 설명", snapshot_id=sid)
        self.assertEqual(out["assistant"]["payload"]["snapshot"]["id"], sid)
        self.assertTrue(any("1.89" in line for line in sent["calc"]))  # 서버 계산값 그대로 전달

    def test_page_context_uses_server_values_only(self):
        """Floating AI '화면 맥락': 서버 DB 값만, 재평가 필요한 값은 빼고, 케이스 이름·브라우저 숫자는 넣지 않음."""
        self.assertFalse(self.api.get(f"/api/cases/{self.cid}/ai-context/?page=calculator").json()["available"]["performance"])
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        before = self.api.get(f"/api/cases/{self.cid}/ai-context/?page=before-after").json()["available"]
        self.assertFalse(before["comparison_kpi"])
        self.assertEqual(before["measurements"], 0)
        c = self.api.get(f"/api/cases/{self.cid}/ai-context/?page=calculator").json()
        self.assertTrue(c["available"]["performance"] and c["available"]["economics"])
        self.assertTrue(any("1.89" in x for x in c["lines"]))
        self.assertFalse(any("P5" in x for x in c["lines"]))  # 케이스 이름 미포함
        self.assertEqual(self.api.get(f"/api/cases/{self.cid}/ai-context/?page=nope").status_code, 400)
        ck = self.api.get(f"/api/cases/{self.cid}/ai-context/?page=checklist").json()
        self.assertTrue(any(x.startswith("missing required:") for x in ck["lines"]))
        # 입력을 바꾸면 이전 결과는 현재 값으로 넘기지 않음
        values = {**self.api.get(f"/api/cases/{self.cid}/inputs/").json()["values"], "currentBP": 360}
        self.api.put(f"/api/cases/{self.cid}/inputs/", {"mode": "DEMO", "scenario": "CUSTOM", "values": values}, format="json")
        c = self.api.get(f"/api/cases/{self.cid}/ai-context/?page=dashboard").json()
        self.assertIn("performance", c["stale"])
        self.assertFalse(any("1.89" in x for x in c["lines"]))

    def test_page_context_attached_to_question(self):
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        set_settings({"ai_external_enabled": True})
        sent = {}

        def fake_generate(q, passages, lang, calc_lines=None):
            sent["calc"] = calc_lines
            return {"status": "ok", "text": "1. 핵심 요약\n1.89 MW [1]", "citations": [1], "warnings": []}

        with _no_vectors(), mock.patch("rag.answer.api_key", return_value="test"), mock.patch("rag.answer.generate", side_effect=fake_generate):
            out = self.ask("출력 손실 설명", context="dashboard", lossMW=999)  # 브라우저 숫자는 무시
        self.assertEqual(out["assistant"]["payload"]["context"]["page"], "dashboard")
        self.assertTrue(any("1.89" in x for x in sent["calc"]))
        self.assertFalse(any("999" in x for x in sent["calc"]))
        self.assertEqual(out["user"]["payload"]["context"], "dashboard")
        r = self.api.post(f"/api/conversations/{self.conv}/messages/", {"question": "x", "context": "nope"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_snapshot_must_belong_to_case(self):
        r = self.api.post(f"/api/conversations/{self.conv}/messages/", {"question": "x", "snapshot_id": 999999}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_template_answer_uses_saved_values(self):
        self.api.post(f"/api/cases/{self.cid}/evaluate/all/")
        out = self.api.post(f"/api/cases/{self.cid}/questions/", {"question": "출력 손실은 얼마인가요?"}, format="json").json()
        self.assertEqual(out["type"], "TEMPLATE_DEMO")
        self.assertIn("1.89", out["text"])

    def test_feedback_and_export(self):
        with _no_vectors():
            mid = self.ask("pinch point definition")["assistant"]["id"]
        self.assertEqual(self.api.post(f"/api/messages/{mid}/feedback/", {"rating": "down", "comment": "근거 부족"}, format="json").status_code, 201)
        items = self.admin.get("/api/rag/feedback/export/").json()["items"]
        self.assertEqual(items[0]["rating"], "down")

    def test_labels_validate_refs(self):
        # 정답 추가는 서비스에서 차단(BLOCKED) — 여기서는 검증 로직만 잠깐 열어 시험
        with unlock("rag-labels"):
            self._labels()
        self.assertEqual(self.admin.post("/api/rag/labels/", {"question": "q", "expected_refs": []}, format="json").status_code, 403)

    def _labels(self):
        bad = self.admin.post("/api/rag/labels/", {"question": "q", "expected_refs": ["없는문헌.pdf"]}, format="json")
        self.assertEqual(bad.status_code, 400)
        ref = next(iter(O.get(load_model=False)["corpus"]["refs"]))
        ok = self.admin.post("/api/rag/labels/", {"question": "q", "expected_refs": [ref]}, format="json")
        self.assertEqual(ok.status_code, 201)

    def test_knowledge_base_is_official_readonly(self):
        body = self.admin.get("/api/knowledge/papers/").json()
        self.assertEqual(body["index"]["documents"], 47)
        self.assertEqual(body["index"]["chunks"], 1797)
        self.assertEqual(self.admin.post("/api/knowledge/reindex/").status_code, 403)  # 재색인은 차단
        with unlock("kb-reindex"):
            self.assertEqual(self.admin.post("/api/knowledge/reindex/").status_code, 400)  # 업로드 문헌 없음 — 공식 corpus 는 읽기 전용


class AnswerCheckTests(SimpleTestCase):
    def test_citations_and_numbers(self):
        text, used, invalid = check_citations("A [1] B [9]", 3)
        self.assertEqual((used, invalid), ([1], [9]))
        self.assertEqual(unverified_numbers("1. 핵심 요약\n핀치는 15 이고 42 입니다 [1]", ["pinch 15 C"]), ["42"])
