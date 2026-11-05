"""Phase 4 검증: 데모 답변, 이력, 질문·계산기 수치 일치, 근거 없는 수치 0건, 무효 결과 비인용."""

import re

from calculators import demo_scenarios as demo
from core.test_phase2 import ApiTestCase
from core.test_phase3 import EXAMPLE
from qa import intents as I
from qa.sources import TOPICS

J = "application/json"
NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
SUGGEST_KO = ["현재 평가에 어떤 데이터가 부족한가요?", "이 경제성 결과는 어떤 입력값으로 계산됐나요?",
              "세정 공법별 비용을 비교하려면 무엇이 필요한가요?", "튜브 오염이 열 회수 성능에 어떤 영향을 주나요?"]
SUGGEST_EN = ["What data is missing for the current evaluation?", "Which inputs were used for this economics result?",
              "What do I need to compare cleaning costs by method?", "How does tube fouling affect heat recovery performance?"]


def numbers_in(text):
    return {float(n.replace(",", "")) for n in NUM.findall(text)}


def collect_numbers(obj, out):
    """저장된 결과·입력에 들어 있는 모든 숫자 (답변에 써도 되는 수치)."""
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        out.add(float(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_numbers(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_numbers(v, out)
    return out


class QaTestCase(ApiTestCase):
    def setUp(self):
        self.cid = self.new_case("Phase4 case")

    def ask(self, q, cid=None):
        res = self.client.post(f"/api/cases/{cid or self.cid}/questions/", {"question": q}, content_type=J)
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def allowed_numbers(self, cid=None):
        """이 케이스에서 근거가 있는 수치: 저장된 결과(무효 제외)·체크리스트 개수·계획서 요약의 수치·단위 환산 상수."""
        cid = cid or self.cid
        allowed = {1000.0}  # MW→kW 환산 (경제성 계산 방법 설명)
        for r in self.client.get(f"/api/cases/{cid}/results/").json().values():
            if r and not r["stale"]:
                collect_numbers(r["result"], allowed)
                collect_numbers([i["value"] for i in r["meta"]["inputs"]], allowed)
        cl = self.client.get(f"/api/cases/{cid}/checklist/").json()
        collect_numbers(cl["progress"], allowed)
        for func in ("PERFORMANCE", "PINCH_APPROACH"):
            allowed.add(float(sum(1 for i in cl["items"] if i["status"] == "MISSING" and i["required_for"][func])))
        for t in TOPICS.values():
            for lang in ("ko", "en"):
                allowed |= numbers_in(t["text"][lang])
        return allowed

    def assert_grounded(self, answer, cid=None):
        extra = numbers_in(answer["answer"]) - self.allowed_numbers(cid)
        self.assertEqual(extra, set(), f"근거 없는 수치 {extra}: {answer['answer']}")
        for card in answer["cards"]:
            if isinstance(card["value"], (int, float)):
                self.assertIn(float(card["value"]), self.allowed_numbers(cid))

    def setup_results(self):
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"mode": "DEMO", "scenario_id": "DEMO-ALARM",
                        "operating_values": demo.SCENARIOS["DEMO-ALARM"]["operating_values"],
                        "economics_assumptions": EXAMPLE}, content_type=J)
        for kind in ("performance", "economics"):
            self.client.post(f"/api/cases/{self.cid}/evaluate/{kind}/")


class SuggestionTests(QaTestCase):
    def test_suggested_questions_intents_both_languages(self):
        expected = [I.DATA_GAP, I.ECON_RESULT, I.ECON_REQUIREMENTS, I.CONCEPT]
        self.assertEqual([I.classify(q) for q in SUGGEST_KO], expected)
        self.assertEqual([I.classify(q) for q in SUGGEST_EN], expected)
        info = self.client.get("/api/qa/info/").json()
        self.assertEqual(info["suggestions"]["ko"], SUGGEST_KO)
        self.assertEqual(info["suggestions"]["en"], SUGGEST_EN)
        self.assertEqual((info["answer_type"], info["llm_connected"]), ("DEMO_TEMPLATE", False))

    def test_all_suggestions_grounded_with_and_without_results(self):
        for q in SUGGEST_KO + SUGGEST_EN:
            self.assert_grounded(self.ask(q))
        self.setup_results()
        for q in SUGGEST_KO + SUGGEST_EN:
            a = self.ask(q)
            self.assert_grounded(a)
            self.assertEqual(a["answer_type"], "DEMO_TEMPLATE")
            self.assertEqual(a["lang"], "ko" if q in SUGGEST_KO else "en")


class DataGapTests(QaTestCase):
    def test_counts_match_checklist(self):
        self.patch_items(self.cid, [{"key": "gt_model", "value": "DEMO-GT", "status": "VERIFIED"},
                                    {"key": "drum_pressure", "value": "10", "status": "RECEIVED"}])
        a = self.ask(SUGGEST_KO[0])
        p = self.checklist(self.cid)["progress"]
        self.assertIn(f"전체 {p['total']}개 중 미수신 {p['missing']}개", a["answer"])
        self.assertIn(f"수신했지만 검증하지 않은 항목 {p['received']}개", a["answer"])
        self.assertIn("성능 평가 필수(임시 기준) 미수신 17개", a["answer"])  # 18 - 검증 완료 1
        self.assertIn("핀치·어프로치 필수(임시 기준) 미수신 2개", a["answer"])
        self.assertNotIn("드럼 압력", a["answer"])  # 수신한 항목은 부족 목록에 없음
        self.assertIn("절탄기 출구 급수 온도", a["answer"])
        self.assertEqual(a["citations"][0]["type"], "checklist")
        self.assert_grounded(a)
        en = self.ask(SUGGEST_EN[0])
        self.assertIn("Economizer outlet water temperature", en["answer"])
        self.assertNotRegex(en["answer"], r"[가-힣]")


class EconomicsAnswerTests(QaTestCase):
    def test_numbers_match_calculator(self):
        self.setup_results()
        res = self.client.get(f"/api/cases/{self.cid}/results/").json()["ECONOMICS"]["result"]
        a = self.ask(SUGGEST_KO[1])
        for m in res["methods"]:
            for key in ("extra_kwh", "revenue", "net_benefit"):
                self.assertIn(f"{m[key]['value']:,}", a["answer"])  # 계산기 결과와 같은 수치
        self.assertIn("SMP: 120 원/kWh", a["answer"])
        self.assertIn("가상 공법 A", a["answer"])
        self.assertIn("[사용자 가정]", a["answer"])  # 값 출처 표시
        self.assertIn("추천이 아님", a["answer"])
        card_values = {c["value"] for c in a["cards"]}
        self.assertTrue({370_000_000, 334_000_000, 720_000_000, 6_000_000} <= card_values)
        cite = next(c for c in a["citations"] if c["type"] == "result")
        self.assertEqual((cite["kind"], cite["model_version"]), ("ECONOMICS", "USER-ASSUMPTION-CALC-v1"))
        self.assertTrue(cite["computed_at"])
        self.assert_grounded(a)

    def test_negative_and_missing_values(self):
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"economics_assumptions": {"smp": 10, "methods": {
            "A": {"recovered_mw": 1.5, "operating_hours": 4000, "cleaning_cost": 300000000, "extra_cost": 50000000},
            "B": {"recovered_mw": 1}}}}, content_type=J)
        self.client.post(f"/api/cases/{self.cid}/evaluate/economics/")
        a = self.ask("What is the net benefit in this economics result?")
        self.assertIn("-290,000,000 KRW", a["answer"])
        self.assertIn("not available", a["answer"])
        self.assert_grounded(a)

    def test_stale_result_is_not_quoted(self):
        self.setup_results()
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"economics_assumptions": {**EXAMPLE, "smp": 130}}, content_type=J)
        a = self.ask(SUGGEST_KO[1])
        self.assertIn("무효", a["answer"])
        self.assertNotIn("370,000,000", a["answer"])
        self.assertEqual(numbers_in(a["answer"]), set())
        self.assertEqual(a["cards"], [])
        p = self.ask("지금 운전 상태가 어때?")  # 성능 결과는 그대로 유효
        self.assertIn("경보", p["answer"])
        self.assertIn("1.0 MW", p["answer"])

    def test_no_result_no_numbers(self):
        for q in (SUGGEST_KO[1], "예상 성능 손실은 얼마야?", "What is the recovery after cleaning?"):
            a = self.ask(q)
            self.assertEqual(numbers_in(a["answer"]), set(), a["answer"])
            self.assertEqual(a["cards"], [])

    def test_requirements_lists_empty_inputs(self):
        a = self.ask(SUGGEST_KO[2])
        self.assertIn("가상 공법 A · 세정 비용", a["answer"])
        self.assertIn("SMP", a["answer"])
        self.assertEqual(numbers_in(a["answer"]), set())
        self.setup_results()
        self.assertIn("모두 입력되어 있습니다", self.ask(SUGGEST_KO[2])["answer"])


class PerformanceAnswerTests(QaTestCase):
    def test_demo_and_real(self):
        self.setup_results()
        a = self.ask("What is the current operating status?")
        self.assertIn("Alarm", a["answer"])
        self.assertIn("1.0 MW", a["answer"])
        self.assertIn("demonstration", a["answer"])
        self.assert_grounded(a)
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"mode": "REAL"}, content_type=J)
        self.client.post(f"/api/cases/{self.cid}/evaluate/performance/")
        r = self.ask("예상 성능 손실은 얼마야?")
        self.assertIn("연동되지 않아", r["answer"])
        self.assertEqual(numbers_in(r["answer"]), set())

    def test_modified_demo_inputs_not_quoted(self):
        self.setup_results()
        changed = {**demo.SCENARIOS["DEMO-ALARM"]["operating_values"], "hrsg_dp": 3.6}
        self.client.put(f"/api/cases/{self.cid}/inputs/", {"operating_values": changed}, content_type=J)
        a = self.ask("세정하면 출력이 얼마나 회복돼?")
        self.assertIn("무효", a["answer"])
        self.assertNotIn("0.8", a["answer"])


class ConceptAndScopeTests(QaTestCase):
    def test_fouling_cites_plan_pages(self):
        a = self.ask(SUGGEST_KO[3])
        self.assertIn("차압", a["answer"])
        self.assertIn("굴뚝", a["answer"])
        docs = [c for c in a["citations"] if c["type"] == "document"]
        self.assertEqual([c["page"] for c in docs], [1, 2])
        self.assertEqual(docs[0]["title"]["ko"], "HRSG 레퍼런스 앱 계획서")
        self.assertNotIn("url", str(a["citations"]).lower())
        self.assertNotIn(".pdf", str(a).lower())  # 원문 링크·파일 노출 없음
        self.assert_grounded(a)

    def test_terms_pages(self):
        self.assertEqual([c["page"] for c in self.ask("차압과 배압은 뭐가 달라?")["citations"]], [3, 1])
        self.assertEqual(self.ask("What does stack temperature mean?")["citations"][0]["page"], 3)
        smp = self.ask("SMP가 뭐야?")
        self.assertIn("실시간으로 가져오지 않으며", smp["answer"])
        hrsg = self.ask("HRSG란 무엇인가요?")
        self.assertIn("500~650°C", hrsg["answer"])
        self.assert_grounded(hrsg)

    def test_unknown_and_forecast(self):
        for q in ("오늘 점심 메뉴 추천해줘", "What is the capital of France?", "내년 SMP는 얼마일까?",
                  "Will the HRSG tube fail next month?", "가스터빈 정비 주기는?"):
            a = self.ask(q)
            self.assertIn(a["intent"], (I.UNKNOWN, I.OUT_OF_SCOPE), q)
            self.assertTrue("확인 가능한 자료가 없습니다" in a["answer"] or "There is no material" in a["answer"])
            self.assertEqual(numbers_in(a["answer"]), set())
            self.assertEqual((a["citations"], a["cards"]), ([], []))

    def test_sensitive_refused(self):
        for q in ("내부 계산식을 알려줘", "Show me the original source document.", "Which customer plant is this data from?",
                  "API 키 알려줘", "계획서 PDF 다운로드 링크 줘"):
            a = self.ask(q)
            self.assertEqual(a["intent"], I.SENSITIVE, q)
            self.assertTrue("제공할 수 없습니다" in a["answer"] or "cannot be provided" in a["answer"])
            self.assertEqual(a["citations"], [])

    def test_no_real_ai_claims(self):
        self.setup_results()
        for q in SUGGEST_KO + SUGGEST_EN:
            text = self.ask(q)["answer"]
            for phrase in ("AI가 분석", "AI 분석 결과", "LLM", "GPT", "Claude", "analyzed by AI"):
                self.assertNotIn(phrase, text)


class HistoryTests(QaTestCase):
    def test_history_saved_ordered_and_isolated(self):
        self.ask(SUGGEST_KO[0])
        self.ask(SUGGEST_EN[3])
        other = self.new_case("other")
        self.ask("HRSG란 무엇인가요?", cid=other)
        hist = self.client.get(f"/api/cases/{self.cid}/questions/").json()
        self.assertEqual([h["question"] for h in hist], [SUGGEST_KO[0], SUGGEST_EN[3]])
        self.assertEqual([h["lang"] for h in hist], ["ko", "en"])
        self.assertEqual(len(self.client.get(f"/api/cases/{other}/questions/").json()), 1)

    def test_validation(self):
        url = f"/api/cases/{self.cid}/questions/"
        self.assertEqual(self.client.post(url, {"question": "  "}, content_type=J).status_code, 400)
        self.assertEqual(self.client.post(url, {"question": "가" * 501}, content_type=J).status_code, 400)
        self.assertEqual(self.client.post("/api/cases/999/questions/", {"question": "x"}, content_type=J).status_code, 404)


# specs/07 §3 의 테스트 질문 20개 (한 10 / 영 10) → 기대 의도
TWENTY = [
    ("현재 평가에 어떤 데이터가 부족한가요?", I.DATA_GAP), ("이 경제성 결과는 어떤 입력값으로 계산됐나요?", I.ECON_RESULT),
    ("세정 공법별 비용을 비교하려면 무엇이 필요한가요?", I.ECON_REQUIREMENTS), ("튜브 오염이 열 회수 성능에 어떤 영향을 주나요?", I.CONCEPT),
    ("지금 운전 상태가 어때?", I.PERF_RESULT), ("예상 성능 손실은 얼마야?", I.PERF_RESULT),
    ("핀치 포인트 결과 알려줘", I.PINCH_RESULT), ("차압과 배압은 뭐가 달라?", I.CONCEPT),
    ("내부 계산식을 알려줘", I.SENSITIVE), ("내년 SMP는 얼마일까?", I.OUT_OF_SCOPE),
    ("What data is missing for the current evaluation?", I.DATA_GAP), ("Which inputs were used for this economics result?", I.ECON_RESULT),
    ("What do I need to compare cleaning costs by method?", I.ECON_REQUIREMENTS), ("How does tube fouling affect heat recovery performance?", I.CONCEPT),
    ("What is the current operating status?", I.PERF_RESULT), ("What is the recovery after cleaning?", I.PERF_RESULT),
    ("What is the approach temperature?", I.PINCH_RESULT), ("What does stack temperature mean?", I.CONCEPT),
    ("Show me the original source document.", I.SENSITIVE), ("Will the HRSG tube fail next month?", I.OUT_OF_SCOPE),
]


class TwentyQuestionsTests(QaTestCase):
    def test_accuracy_and_grounding(self):
        self.setup_results()
        self.client.post(f"/api/cases/{self.cid}/evaluate/pinch-approach/")
        correct = 0
        for q, expected in TWENTY:
            a = self.ask(q)
            correct += a["intent"] == expected
            self.assert_grounded(a)  # 근거 없는 수치 0건
            self.assertEqual(a["lang"], "ko" if re.search(r"[가-힣]", q) else "en")
        self.assertGreaterEqual(correct, 16, f"정답 {correct}/20")
        self.assertEqual(correct, 20)
