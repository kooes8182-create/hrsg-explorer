"""Claude(Anthropic API) 답변 호출 검사 — 실제 API 는 부르지 않습니다 (가짜 클라이언트, 비용 없음).

확인: 기본 모델 claude-opus-5-5, 거절 시 서버 대체 모델(fallbacks="default"), 보내는 것은 질문·문단·계산값뿐(API 키는 프롬프트에 없음),
거절·잘림·키 오류 처리, 인용·숫자 검사는 그대로.
"""

from types import SimpleNamespace as NS
from unittest import mock

import anthropic
import httpx
from django.test import SimpleTestCase

from rag import answer as A

PASSAGES = [{"title": "Doc A", "authors": ["Kim"], "year": 2020, "page": 3, "text": "Back pressure of 100 mmH2O lowers output."},
            {"title": "Doc B", "authors": [], "year": None, "page": None, "text": "Cleaning restores pressure drop."}]
FAKE_KEY = "sk-ant-test-0000"


def _resp(text, stop="end_turn"):
    return NS(content=[NS(type="thinking", thinking=""), NS(type="text", text=text)], stop_reason=stop,
              model="claude-opus-5-5", usage=NS(input_tokens=1200, output_tokens=300))


class ClaudeAnswerTests(SimpleTestCase):
    def run_gen(self, resp=None, exc=None, calc=None, env=None):
        client = mock.MagicMock()
        if exc:
            client.beta.messages.create.side_effect = exc
        else:
            client.beta.messages.create.return_value = resp
        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": FAKE_KEY, **(env or {})}), mock.patch.object(A, "get_client", return_value=client):
            out = A.generate("배압이 증가하면?", PASSAGES, "ko", calc)
        return out, client.beta.messages.create.call_args

    def test_request_shape_and_ok_answer(self):
        out, call = self.run_gen(_resp("1. 핵심 요약\n배압 100 mmH2O 증가는 출력을 낮춥니다 [1]."), calc=["output loss = 0.195 MW"])
        kw = call.kwargs
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["fallbacks"], "default")
        self.assertEqual(kw["betas"], ["server-side-fallback-2026-07-01"])
        self.assertEqual(kw["output_config"], {"effort": "medium"})
        self.assertNotIn("thinking", kw)  # Opus 5.5: thinking 은 항상 켜짐 — 끄는 설정을 보내면 400
        prompt = kw["messages"][0]["content"]
        self.assertIn("<passage n=\"1\"", prompt)
        self.assertIn("0.195 MW", prompt)
        self.assertNotIn(FAKE_KEY, prompt + kw["system"])  # 키는 인증에만, 프롬프트에는 없음
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["citations"], [1])
        self.assertNotIn("thinking", out["text"])
        self.assertEqual(out["usage"], {"input_tokens": 1200, "output_tokens": 300})

    def test_refusal_and_truncation(self):
        self.assertEqual(self.run_gen(_resp("", stop="refusal"))[0]["status"], "refused")
        out, _ = self.run_gen(_resp("1. 핵심 요약\n출력이 줄어듭니다 [1]", stop="max_tokens"))
        self.assertTrue(any(w["type"] == "truncated" for w in out["warnings"]))

    def test_unverified_number_warning_kept(self):
        out, _ = self.run_gen(_resp("1. 핵심 요약\n출력이 37 % 감소합니다 [1]"))
        self.assertTrue(any(w["type"] == "unverified_numbers" and "37" in w["values"] for w in out["warnings"]))

    def test_errors_are_short_messages(self):
        req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        auth = anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=req), body=None)
        out, _ = self.run_gen(exc=auth)
        self.assertEqual((out["status"], out["message"]), ("error", "API 키가 올바르지 않습니다."))
        out, _ = self.run_gen(exc=anthropic.APIConnectionError(request=req))
        self.assertIn("연결하지 못했습니다", out["message"])
        self.assertNotIn(FAKE_KEY, str(out))

    def test_no_key_or_no_passages_means_no_call(self):
        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}), mock.patch.object(A, "get_client") as gc:
            self.assertEqual(A.generate("q", PASSAGES, "ko")["status"], "not_configured")
            gc.assert_not_called()
        out, call = self.run_gen(_resp("x"))
        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": FAKE_KEY}), mock.patch.object(A, "get_client") as gc:
            self.assertEqual(A.generate("q", [], "ko")["status"], "no_passages")
            gc.assert_not_called()

    def test_model_env_must_be_a_claude_model(self):
        for v, want in [("", "claude-opus-5-5"), ("gemini-3.5-flash", "claude-opus-5-5"), ("claude-haiku-5-5", "claude-haiku-5-5")]:
            with mock.patch.dict("os.environ", {"RAG_LLM_MODEL": v}):
                self.assertEqual(A.model_name(), want)
