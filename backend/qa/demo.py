"""템플릿 기반 데모 답변 (실제 LLM 아님).

규칙 (specs/06):
- 수치는 AnswerContext 의 저장된 계산 결과·체크리스트에서만 가져옵니다. 템플릿에 수치를 직접 쓰지 않습니다.
- 입력 변경으로 무효(stale)가 된 결과는 수치를 인용하지 않습니다.
- 일반 설명은 qa/sources.py (HRSG 계획서 요약, 페이지 표시) 범위만 사용합니다.
- 범위 밖 질문에는 "확인 가능한 자료가 없습니다" 로 답하고, 설명이나 수치를 만들지 않습니다.
"""

from calculators import public_refs as R

from . import intents as I
from .base import Answer, AnswerContext, AnswerProvider
from .sources import TOPICS

KIND_NAME = {
    "PERFORMANCE": {"ko": "성능 평가", "en": "performance evaluation"},
    "ECONOMICS": {"ko": "경제성 비교", "en": "economics comparison"},
    "PINCH_APPROACH": {"ko": "핀치·어프로치", "en": "pinch/approach"},
    "REFERENCE": {"ko": "문헌 기반 참고 추정", "en": "literature-based reference estimate"},
}
POSITION = {
    "BELOW": {"ko": "참고 기준보다 낮음", "en": "below the reference band"},
    "WITHIN": {"ko": "참고 기준 범위 안", "en": "within the reference band"},
    "ABOVE": {"ko": "참고 기준보다 높음", "en": "above the reference band"},
}
BASIS = {
    "DEMO_FIXED": {"ko": "데모 예시값", "en": "demo example"},
    "USER_ASSUMPTION": {"ko": "사용자 가정 기반 계산", "en": "based on user assumptions"},
    "UNAVAILABLE": {"ko": "산출 불가", "en": "not available"},
    "REEVALUATION_REQUIRED": {"ko": "재평가 필요", "en": "re-evaluation required"},
    "REFERENCE_ESTIMATE": {"ko": "공개 문헌 기반 참고 추정", "en": "public-literature reference estimate"},
}
STATUS = {"NORMAL": {"ko": "정상", "en": "Normal"}, "ALARM": {"ko": "경보", "en": "Alarm"}, "TRIP": {"ko": "트립", "en": "Trip"}}
SOURCE = {"USER": {"ko": "사용자 가정", "en": "user assumption"}, "DEMO": {"ko": "데모 값", "en": "demo value"},
          "PUBLIC": {"ko": "공개 통계", "en": "public statistics"}, "REFERENCE": {"ko": "문헌 참고 추정", "en": "literature reference"}}
UNIT_EN = {"원": "KRW", "원/kWh": "KRW/kWh"}
FUNC = {"PERFORMANCE": {"ko": "성능 평가", "en": "performance"}, "PINCH_APPROACH": {"ko": "핀치·어프로치", "en": "pinch/approach"}}
ECON_FIELDS = [
    ("recovered_mw", {"ko": "회수 출력", "en": "recovered output"}),
    ("operating_hours", {"ko": "세정 후 예상 운전 시간", "en": "expected operating hours after cleaning"}),
    ("cleaning_cost", {"ko": "세정 비용", "en": "cleaning cost"}),
    ("extra_cost", {"ko": "정지 손실 및 추가 비용", "en": "outage loss & additional cost"}),
]
METHOD = {"A": {"ko": "가상 공법 A", "en": "Virtual method A"}, "B": {"ko": "가상 공법 B", "en": "Virtual method B"}}

CHECKLIST_CITE = {"type": "checklist", "label": {"ko": "체크리스트 (현재 저장 상태, 계획서 기반 초안)",
                                                 "en": "Checklist (current saved state, plan-based draft)"}}
ECON_RULE_CITE = {"type": "app_rule", "label": {"ko": "앱 경제성 계산 규칙 (사용자 가정 기반 단순 계산)",
                                                "en": "App economics rule (simple calculation from user assumptions)"}}

MAX_NAMES = 10


def fmt(v):
    """저장된 값을 그대로 표시 (반올림·가공 없이 천 단위 구분만)."""
    if isinstance(v, bool) or v is None:
        return "—"
    if isinstance(v, int) or (isinstance(v, float) and v.is_integer() and abs(v) >= 1000):
        return f"{int(v):,}"
    return f"{v:,}" if isinstance(v, (int, float)) else str(v)


class TemplateDemoProvider(AnswerProvider):
    answer_type = "DEMO_TEMPLATE"

    def answer(self, question, ctx: AnswerContext):
        intent = I.classify(question)
        handler = {
            I.SENSITIVE: self._sensitive,
            I.OUT_OF_SCOPE: self._out_of_scope,
            I.ECON_REQUIREMENTS: self._econ_requirements,
            I.ECON_RESULT: self._econ_result,
            I.DATA_GAP: self._data_gap,
            I.PINCH_RESULT: self._pinch_result,
            I.PERF_RESULT: self._perf_result,
            I.REFERENCE_RESULT: self._reference_result,
            I.SMP_DATA: self._smp_data,
            I.CONCEPT: lambda c: self._concept(c, question),
            I.UNKNOWN: self._unknown,
        }[intent]
        text, citations, cards = handler(ctx)
        return Answer(text=text, intent=intent, answer_type=self.answer_type, citations=citations, cards=cards)

    # ------------------------------------------------------------ 도우미
    @staticmethod
    def _l(ctx, d):
        return d[ctx.lang]

    def _unit(self, ctx, u):
        return UNIT_EN.get(u, u) if ctx.lang == "en" and u else (u or "")

    def _result_cite(self, kind, r):
        m = r["meta"]
        return {"type": "result", "kind": kind, "basis": m["basis"], "model_version": m["model_version"],
                "computed_at": m["computed_at"], "label": {lang: KIND_NAME[kind][lang] for lang in ("ko", "en")}}

    def _stale_or_missing(self, ctx, kind):
        """결과가 없거나 무효면 (안내문, 근거) 를, 쓸 수 있으면 None 을 돌려줍니다."""
        r = ctx.results.get(kind)
        name = KIND_NAME[kind][ctx.lang]
        if r is None:
            return ({"ko": f"저장된 {name} 결과가 없습니다. '성능·경제성 평가' 화면에서 먼저 평가를 실행하세요. 결과가 없으므로 수치는 답할 수 없습니다.",
                     "en": f"There is no saved {name} result. Run the evaluation first on the 'Performance & economics' screen. No numbers can be given without a result."}[ctx.lang], [])
        if r["stale"]:
            return ({"ko": f"저장된 {name} 결과는 입력이 바뀌어 무효(재평가 필요)입니다. 현재 결과로 인용하지 않습니다. 다시 평가한 뒤 질문하세요.",
                     "en": f"The saved {name} result is invalid because inputs changed (re-evaluation required). It is not quoted as a current result. Evaluate again, then ask."}[ctx.lang],
                    [self._result_cite(kind, r)])
        return None

    def _reason(self, ctx, item):
        reason = item.get("reason") or {}
        return reason.get(ctx.lang) or reason.get("ko") or ""

    # ------------------------------------------------------------ 의도별 답변
    def _sensitive(self, ctx):
        return ({"ko": "내부 계산 방식, 원문 문서·파일, 고객사·발전소·개인 정보, 비밀값은 제공할 수 없습니다. 앱에서는 입력과 결과만 확인하실 수 있습니다.",
                 "en": "Internal calculation methods, source documents/files, customer/plant/personal information and secrets cannot be provided. You can only see inputs and results in the app."}[ctx.lang], [], [])

    def _out_of_scope(self, ctx):
        return ({"ko": "확인 가능한 자료가 없습니다. 이 데모에는 예측·전망이나 고장 시점을 판단할 근거 자료와 모델이 없어 답하지 않습니다.",
                 "en": "There is no material to confirm this. This demo has no data or model for forecasts or failure timing, so it does not answer."}[ctx.lang], [], [])

    def _unknown(self, ctx):
        return ({"ko": "확인 가능한 자료가 없습니다. 이 데모 답변은 다음 범위만 다룹니다: 부족한 데이터(체크리스트), 저장된 성능·경제성·핀치·문헌 참고 추정 결과와 입력 조건, "
                       "경제성 비교에 필요한 입력, 공개 SMP 실적, HRSG 계획서에 있는 일반 설명(오염 영향, 배압·차압, 굴뚝 온도, 핀치·어프로치, SMP).",
                 "en": "There is no material to confirm this. These demo answers only cover: missing data (checklist), saved performance/economics/pinch/literature-reference results and their inputs, "
                       "inputs needed for the economics comparison, historical public SMP, and general explanations found in the HRSG plan (fouling effects, back pressure/ΔP, stack temperature, pinch/approach, SMP)."}[ctx.lang], [], [])

    def _data_gap(self, ctx):
        cl = ctx.checklist
        p = cl["progress"]
        lang = ctx.lang
        lines = [{"ko": f"체크리스트 기준 전체 {p['total']}개 중 미수신 {p['missing']}개, 수신했지만 검증하지 않은 항목 {p['received']}개, 검증 완료 {p['verified']}개입니다.",
                  "en": f"By the checklist: {p['missing']} of {p['total']} items not received, {p['received']} received but not verified, {p['verified']} verified."}[lang]]
        for func, names in cl["required_missing"].items():
            if not names:
                continue
            shown = ", ".join(n[lang] for n in names[:MAX_NAMES])
            more = {"ko": " 등 (나머지는 데이터 준비 화면에서 확인)", "en": ", etc. (see Data preparation for the rest)"}[lang] if len(names) > MAX_NAMES else ""
            lines.append({"ko": f"• {FUNC[func]['ko']} 필수(임시 기준) 미수신 {len(names)}개: {shown}{more}",
                          "en": f"• Required for {FUNC[func]['en']} (provisional), not received: {len(names)} — {shown}{more}"}[lang])
        if p["missing"] == 0:
            lines.append({"ko": "미수신 항목은 없습니다.", "en": "There are no items left to receive."}[lang])
        lines.append({"ko": "체크리스트는 계획서 기반 초안이며 필수 기준은 확정되지 않은 임시 기준입니다. '데이터 준비'에서 요청문을 복사할 수 있습니다.",
                      "en": "The checklist is a plan-based draft and the required marks are provisional. You can copy a request text in 'Data preparation'."}[lang])
        return "\n".join(lines), [CHECKLIST_CITE], []

    def _econ_requirements(self, ctx):
        lang = ctx.lang
        a = ctx.economics_inputs
        lines = [{"ko": "가상 공법 A/B 비용·편익을 비교하려면 공법마다 다음 가정값이 필요합니다: 회수 출력(MW), 세정 후 예상 운전 시간(h, 세정 정지 시간 제외), 세정 비용(원), 정지 손실 및 추가 비용(원 — 세정 비용에 이미 포함됐다면 '포함됨' 표시). 공통으로 SMP(원/kWh)가 필요합니다.",
                  "en": "To compare cost/benefit of virtual methods A/B, each method needs: recovered output (MW), expected operating hours after cleaning (h, excluding the cleaning outage), cleaning cost (KRW), and outage loss & additional cost (KRW — or mark it as included in the cleaning cost). SMP (KRW/kWh) is needed for both."}[lang]]
        missing = []
        if a.get("smp") is None:
            missing.append({"ko": "SMP", "en": "SMP"}[lang])
        for k, m in a.get("methods", {}).items():
            for field, label in ECON_FIELDS:
                if field == "extra_cost" and m.get("extra_cost_included"):
                    continue
                if m.get(field) is None:
                    missing.append(f"{METHOD[k][lang]} · {label[lang]}")
        if missing:
            lines.append({"ko": "현재 저장된 입력 중 비어 있는 값: ", "en": "Currently empty saved inputs: "}[lang] + ", ".join(missing))
        else:
            lines.append({"ko": "현재 필요한 가정값이 모두 입력되어 있습니다.", "en": "All required assumptions are currently entered."}[lang])
        lines.append({"ko": "실제 세정 공법 목록과 비용 기준은 제공되지 않아, 이 앱은 가상 공법 A/B와 사용자 가정값으로만 비교합니다. 비어 있는 비용 칸은 '값 없음'으로 다루며 해당 순편익은 산출하지 않습니다.",
                      "en": "The real list of cleaning methods and cost references were not provided, so the app only compares virtual methods A/B with user assumptions. Empty cost fields are treated as 'no value' and the related net benefit is not calculated."}[lang])
        return "\n".join(lines), [ECON_RULE_CITE], []

    def _econ_result(self, ctx):
        lang = ctx.lang
        blocked = self._stale_or_missing(ctx, "ECONOMICS")
        if blocked:
            return blocked[0], blocked[1], []
        r = ctx.results["ECONOMICS"]
        res = r["result"]
        u = lambda x: self._unit(ctx, x)  # noqa: E731
        src = lambda item: f" [{SOURCE[item['source']][lang]}]" if item.get("source") else ""  # noqa: E731
        lines = [{"ko": "저장된 경제성 결과(사용자 가정 기반 단순 계산)의 입력 조건과 결과입니다.",
                  "en": "Inputs and results of the saved economics result (simple calculation from user assumptions)."}[lang]]
        smp = res["smp"]
        lines.append(f"• SMP: {fmt(smp['value'])} {u(smp['unit'])}{src(smp)}" if smp["value"] is not None
                     else f"• SMP: {self._na(ctx)}")
        cards = []
        for m in res["methods"]:
            name = m["name"][lang]
            ins = m["inputs"]
            parts = []
            for field, label in ECON_FIELDS:
                item = ins[field]
                if field == "extra_cost" and ins["extra_cost_included"]:
                    parts.append(f"{label[lang]} " + {"ko": "세정 비용에 포함", "en": "included in cleaning cost"}[lang])
                elif item["value"] is None:
                    parts.append(f"{label[lang]} {self._na(ctx)}")
                else:
                    parts.append(f"{label[lang]} {fmt(item['value'])} {u(item['unit'])}{src(item)}")
            lines.append(f"• {name} — " + {"ko": "입력: ", "en": "inputs: "}[lang] + ", ".join(parts))
            outs = []
            for key, label in (("extra_kwh", {"ko": "추가 발전량", "en": "additional generation"}),
                               ("revenue", {"ko": "추가 발전 매출", "en": "additional revenue"}),
                               ("net_benefit", {"ko": "입력 비용 반영 순편익", "en": "net benefit after entered costs"})):
                item = m[key]
                if item["value"] is None:
                    outs.append(f"{label[lang]} " + {"ko": "산출 불가", "en": "not available"}[lang] + f" ({self._reason(ctx, item)})")
                else:
                    outs.append(f"{label[lang]} {fmt(item['value'])} {u(item['unit'])}")
                    cards.append({"label": {"ko": f"{m['name']['ko']} · {label['ko']}", "en": f"{m['name']['en']} · {label['en']}"},
                                  "value": item["value"], "unit": item["unit"], "basis": r["meta"]["basis"]})
            lines.append("  " + {"ko": "결과: ", "en": "results: "}[lang] + ", ".join(outs))
        best = res.get("max_net_benefit_method")
        if best:
            lines.append({"ko": f"가정 기준 순편익이 가장 큰 것은 {METHOD[best]['ko']}입니다(추천이 아님).",
                          "en": f"{METHOD[best]['en']} has the highest net benefit under these assumptions (not a recommendation)."}[lang])
        lines.append({"ko": "계산 방법: 회수 출력(MW)을 kW로 바꿔(×1,000) 운전 시간을 곱한 추가 발전량에 SMP를 곱해 매출을 구하고, 세정 비용과 정지 손실·추가 비용을 뺐습니다.",
                      "en": "Method: additional generation = recovered output (MW, ×1,000 to kW) × operating hours; revenue = generation × SMP; then cleaning cost and outage/additional cost are subtracted."}[lang])
        lines.append(res["notice"][lang])
        return "\n".join(lines), [self._result_cite("ECONOMICS", r), ECON_RULE_CITE], cards

    def _na(self, ctx):
        return {"ko": "미입력", "en": "not entered"}[ctx.lang]

    def _perf_result(self, ctx):
        lang = ctx.lang
        blocked = self._stale_or_missing(ctx, "PERFORMANCE")
        if blocked:
            return blocked[0], blocked[1], []
        r = ctx.results["PERFORMANCE"]
        res, meta = r["result"], r["meta"]
        basis = BASIS[meta["basis"]][lang]
        cards, lines = [], []
        status = res["status"]["value"]
        if meta["mode"] == "DEMO" and status:
            sc = meta.get("scenario_id") or ""
            lines.append({"ko": f"저장된 성능 평가 결과({basis}, 시나리오 {sc})의 운전 상태는 '{STATUS[status]['ko']}'입니다. {res['status_basis']['ko']}",
                          "en": f"The saved performance result ({basis}, scenario {sc}) shows status '{STATUS[status]['en']}'. {res['status_basis']['en']}"}[lang])
            cards.append({"label": {"ko": "운전 상태", "en": "Operating status"}, "value": STATUS[status][lang], "unit": None, "basis": meta["basis"]})
        else:
            lines.append({"ko": f"저장된 성능 평가 결과는 '{basis}'입니다. 운전 상태는 판정 보류입니다: {self._reason(ctx, res['status'])}",
                          "en": f"The saved performance result is '{basis}'. Status is pending: {self._reason(ctx, res['status'])}"}[lang])
        for key, label in (("performance_loss", {"ko": "예상 성능 손실", "en": "Expected performance loss"}),
                           ("cleaning_recovery", {"ko": "세정 후 회수 효과", "en": "Recovery after cleaning"})):
            item = res[key]
            if item["value"] is None:
                lines.append(f"• {label[lang]}: " + {"ko": "산출 불가", "en": "not available"}[lang] + f" — {self._reason(ctx, item)}")
            else:
                lines.append(f"• {label[lang]}: {fmt(item['value'])} {item['unit']}")
                cards.append({"label": label, "value": item["value"], "unit": item["unit"], "basis": meta["basis"]})
        if meta.get("notice"):
            lines.append(meta["notice"][lang])
        return "\n".join(lines), [self._result_cite("PERFORMANCE", r)], cards

    def _pinch_result(self, ctx):
        lang = ctx.lang
        topic = TOPICS["PINCH_DEF"]
        blocked = self._stale_or_missing(ctx, "PINCH_APPROACH")
        if blocked:
            return blocked[0] + "\n" + topic["text"][lang], blocked[1] + topic["cite"], []
        r = ctx.results["PINCH_APPROACH"]
        res = r["result"]
        cite = [self._result_cite("PINCH_APPROACH", r), *res.get("sources", [])]
        if res["pinch"]["value"] is None and res["approach"]["value"] is None:
            text = {"ko": f"핀치·어프로치 값은 계산되지 않았습니다. 사유: {self._reason(ctx, res['pinch'])}",
                    "en": f"Pinch/approach values were not calculated. Reason: {self._reason(ctx, res['pinch'])}"}[lang]
            return text + "\n" + topic["text"][lang], cite, []
        lines, cards = [], []
        sat = res["saturation_temp"]
        lines.append({"ko": f"저장된 핀치·어프로치 참고 계산입니다. 드럼 포화온도 {fmt(sat['value'])} °C (IAPWS-IF97 포화온도 식).",
                      "en": f"Saved pinch/approach reference calculation. Drum saturation temperature {fmt(sat['value'])} °C (IAPWS-IF97 saturation equation)."}[lang])
        for key, label in (("pinch", {"ko": "핀치", "en": "Pinch"}), ("approach", {"ko": "어프로치", "en": "Approach"})):
            item = res[key]
            if item["value"] is None:
                lines.append(f"• {label[lang]}: " + {"ko": "계산 불가", "en": "not calculated"}[lang] + f" — {self._reason(ctx, item)}")
            else:
                lines.append(f"• {label[lang]}: {fmt(item['value'])} °C")
                cards.append({"label": label, "value": item["value"], "unit": "°C", "basis": r["meta"]["basis"]})
        rng = res["reference_ranges"]
        lines.append({"ko": f"IST 자료의 일반 설계 범위(무연소 HRSG 최적 핀치 {fmt(rng['pinch_c'][0])}~{fmt(rng['pinch_c'][1])} °C, 일반적 어프로치 약 {fmt(rng['approach_typical_c'])} °C)와 비교하는 참고값이며, 이 설비의 판정 기준이 아닙니다.",
                      "en": f"For reference only against general design ranges in the IST source (optimum pinch for unfired HRSGs {fmt(rng['pinch_c'][0])}–{fmt(rng['pinch_c'][1])} °C, typical approach about {fmt(rng['approach_typical_c'])} °C); not criteria for this plant."}[lang])
        if res.get("approach_steaming_note"):
            lines.append(res["approach_steaming_note"][lang])
        return "\n".join(lines), cite, cards

    def _reference_result(self, ctx):
        lang = ctx.lang
        coef = {"ko": "공개 문헌 계수: GE GER-3567H(Frame 7EA 한 기종) 배기 압력손실 4 in H2O(10 mbar)당 출력 0.42% 감소·열소비율 0.42% 증가, "
                      "IST 2000 자료 4 in WG당 출력 약 1% 감소. 세정 참고 기준: 신규·청정 대비 3~4 in H2O 증가(POWER 2015).",
                "en": "Public coefficients: GE GER-3567H (Frame 7EA only) 0.42% output loss and 0.42% heat-rate increase per 4 in H2O (10 mbar) exhaust ΔP; "
                      "IST 2000 about 1% output loss per 4 in WG. Cleaning reference: 3–4 in H2O above new-and-clean (POWER 2015)."}[lang]
        sources = [R.cite("GE_GER3567H"), R.cite("IST_2000"), R.cite("POWER_2015")]
        blocked = self._stale_or_missing(ctx, "REFERENCE")
        if blocked:
            return blocked[0] + "\n" + coef, blocked[1] + sources, []
        r = ctx.results["REFERENCE"]
        res = r["result"]
        cite = [self._result_cite("REFERENCE", r), *sources]
        if res["effects"] is None:
            return ({"ko": f"참고 추정을 계산하지 못했습니다: {res['effects_reason']['ko']}",
                     "en": f"The reference estimate could not be calculated: {res['effects_reason']['en']}"}[lang] + "\n" + coef, cite, [])
        inc, eff = res["dp_increase"], res["effects"]
        lines = [{"ko": f"저장된 문헌 기반 참고 추정입니다(승인 모델 아님). 현재 차압은 청정 기준보다 {fmt(inc['kpa']['value'])} kPa ({fmt(inc['in_h2o']['value'])} in H2O) 높습니다 — {POSITION[res['trigger_position']]['ko']}(3~4 in H2O).",
                  "en": f"Saved literature-based reference estimate (not an approved model). Current ΔP is {fmt(inc['kpa']['value'])} kPa ({fmt(inc['in_h2o']['value'])} in H2O) above the clean baseline — {POSITION[res['trigger_position']]['en']} (3–4 in H2O)."}[lang]]
        lo, hi = eff["output_loss_pct"]["low"]["value"], eff["output_loss_pct"]["high"]["value"]
        lines.append({"ko": f"• 가스터빈 출력 손실 참고 범위: {fmt(lo)}~{fmt(hi)}%", "en": f"• GT output loss reference range: {fmt(lo)}–{fmt(hi)}%"}[lang])
        cards = [{"label": {"ko": "출력 손실 (낮은 쪽, GE)", "en": "Output loss (low, GE)"}, "value": lo, "unit": "%", "basis": r["meta"]["basis"]},
                 {"label": {"ko": "출력 손실 (높은 쪽, IST)", "en": "Output loss (high, IST)"}, "value": hi, "unit": "%", "basis": r["meta"]["basis"]}]
        mlo, mhi = eff["output_loss_mw"]["low"]["value"], eff["output_loss_mw"]["high"]["value"]
        if mlo is not None:
            lines.append({"ko": f"• 같은 범위를 MW로: {fmt(mlo)}~{fmt(mhi)} MW", "en": f"• In MW: {fmt(mlo)}–{fmt(mhi)} MW"}[lang])
        lines.append({"ko": f"• 열소비율 증가 {fmt(eff['heat_rate_increase_pct']['value'])}%, 배기온도 상승 {fmt(eff['exhaust_temp_increase_c']['value'])} °C (GE 계수만 있음)",
                      "en": f"• Heat-rate increase {fmt(eff['heat_rate_increase_pct']['value'])}%, exhaust temperature rise {fmt(eff['exhaust_temp_increase_c']['value'])} °C (GE coefficients only)"}[lang])
        rec = res.get("recovery")
        if rec and rec["output_loss_mw"]["low"]["value"] is not None:
            lines.append({"ko": f"• 세정 후 기대 차압까지 낮아질 때 회복 참고 범위: {fmt(rec['output_loss_mw']['low']['value'])}~{fmt(rec['output_loss_mw']['high']['value'])} MW",
                          "en": f"• Recovery reference range if ΔP drops to the expected post-cleaning value: {fmt(rec['output_loss_mw']['low']['value'])}–{fmt(rec['output_loss_mw']['high']['value'])} MW"}[lang])
        lines.append({"ko": "스팀터빈 출력과 굴뚝 온도 영향은 공개 근거가 없어 계산하지 않았습니다.",
                      "en": "Steam-turbine output and stack-temperature effects are not calculated (no public basis)."}[lang])
        lines.append(res["notice"][lang])
        return "\n".join(lines), cite, cards

    def _smp_data(self, ctx):
        lang = ctx.lang
        monthly = list(R.SMP_MONTHLY.items())
        last_m, last_v = monthly[-1]
        recent = monthly[-12:]
        lo_m, lo_v = min(recent, key=lambda x: x[1])
        hi_m, hi_v = max(recent, key=lambda x: x[1])
        annual = R.SMP_ANNUAL
        years = sorted(annual)[-3:]
        ann_text = ", ".join(f"{y}: {fmt(annual[y])}" for y in years)
        lines = [{"ko": f"공개 통계(한국전력거래소 KPX·EPSIS, 육지, 시간대별 수요예측량 가중평균) 기준 SMP 실적입니다 (단위 원/kWh, {R.CHECKED_ON} 확인).",
                  "en": f"Historical SMP from public statistics (KPX/EPSIS, mainland, weighted by hourly demand forecast), in KRW/kWh, checked {R.CHECKED_ON}."}[lang],
                 {"ko": f"• 연평균 — {ann_text}", "en": f"• Annual averages — {ann_text}"}[lang],
                 {"ko": f"• 가장 최근 확인 월 {last_m}: {fmt(last_v)}", "en": f"• Latest verified month {last_m}: {fmt(last_v)}"}[lang],
                 {"ko": f"• 최근 12개월 범위: 최저 {fmt(lo_v)}({lo_m}) ~ 최고 {fmt(hi_v)}({hi_m})",
                  "en": f"• Last 12 months: low {fmt(lo_v)} ({lo_m}) to high {fmt(hi_v)} ({hi_m})"}[lang],
                 {"ko": "과거 실적이며 앞으로의 SMP를 예측하지 않습니다. 경제성 화면에서 이 값을 SMP 참고값으로 넣을 수 있습니다.",
                  "en": "These are past values, not a forecast. You can use them as the SMP reference on the economics screen."}[lang]]
        cards = [{"label": {"ko": f"{years[-1]} 연평균 SMP", "en": f"{years[-1]} annual SMP"}, "value": annual[years[-1]], "unit": "원/kWh", "basis": "PUBLIC"},
                 {"label": {"ko": f"{last_m} 월평균 SMP", "en": f"{last_m} monthly SMP"}, "value": last_v, "unit": "원/kWh", "basis": "PUBLIC"}]
        return "\n".join(lines), [R.cite("KPX_SMP")], cards

    def _concept(self, ctx, question):
        topics = I.concept_topics(question)
        texts, cites = [], []
        for t in topics:
            texts.append(TOPICS[t]["text"][ctx.lang])
            for c in TOPICS[t]["cite"]:
                if c not in cites:
                    cites.append(c)
        return "\n\n".join(texts), cites, []
