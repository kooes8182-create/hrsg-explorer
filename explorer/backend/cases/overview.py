"""대시보드 집계 (GET /api/cases/{id}/overview/).

대시보드는 별도 계산 엔진을 갖지 않습니다. 저장된 입력값·계산 결과·체크리스트·실측값을 모아 보여 줍니다.
- 재평가가 필요한 결과는 현재 값으로 내보내지 않고 previous 로만 줍니다 (화면에서 흐리게 + '재평가 필요').
- 세정 전후 비교 결과가 없거나 오래되었으면 같은 공통 엔진(services.evaluate)으로 다시 계산해 저장합니다.
"""

from engine import fields
from engine.base import msg

from . import services

STALE = msg("입력이 바뀌어 재평가가 필요합니다.", "Inputs changed — re-evaluation required.")
NOT_RUN = msg("아직 계산하지 않았습니다.", "Not calculated yet.")


def _kpi(key, label, value, unit, *, rel, baseline=None, delta=None, rate=None, status=None, computed_at=None,
         reason=None, previous=None, note=None):
    return {"key": key, "label": label, "value": value, "unit": unit, "rel": rel, "baseline": baseline, "delta": delta,
            "changeRate": rate, "status": status, "computedAt": computed_at, "reason": reason, "previous": previous, "note": note}


def _round(x, n=1):
    return None if x is None else round(x, n)


def _ai_step(case):
    """AI 검토 단계: 이 케이스에서 근거 질문을 했는지 + 외부 AI 사용 여부 (가짜 완료 없음)."""
    from rag.models import ConversationMessage, SystemConfiguration

    asked = ConversationMessage.objects.filter(conversation__case=case, role="assistant").count()
    ai_on = bool(SystemConfiguration.read("ai_external_enabled"))
    mode = msg("Claude 답변 사용", "Claude answers on") if ai_on else msg("근거 검색만 (외부 AI 꺼짐)", "Evidence only (external AI off)")
    detail = msg(f"질문 {asked}건 · {mode['ko']}", f"{asked} questions · {mode['en']}") if asked else msg(f"아직 질문 없음 · {mode['ko']}", f"No questions yet · {mode['en']}")
    return {"key": "ai", "state": "done" if asked else "todo", "detail": detail, "link": "/ai-assistant"}


def overview(case):
    services.ensure_case_data(case)
    ci = services.get_input(case)
    v, src = ci.values, fields.value_sources(ci.mode, ci.scenario, ci.values)
    res = services.results(case)["results"]
    if "comparison" not in res or res["comparison"]["stale"]:
        services.evaluate(case, ["comparison"])
        res = services.results(case)["results"]

    def fresh(kind):
        r = res.get(kind)
        return (r["payload"], r["computed_at"]) if r and not r["stale"] else (None, r["computed_at"] if r else None)

    def stale_payload(kind):
        r = res.get(kind)
        return r["payload"] if r and r["stale"] else None

    perf, perf_at = fresh("performance")
    econ, econ_at = fresh("economics")
    ref, _ = fresh("reference")
    comp, _ = fresh("comparison")
    old_perf = stale_payload("performance")
    rows = list(case.checklist.all())
    cl = services.checklist_summary(rows)

    status = perf["status"] if perf else {
        "code": "UNKNOWN", "label": fields.STATUS["UNKNOWN"], "rel": "REEVALUATION_REQUIRED" if old_perf else "UNAVAILABLE",
        "reason": STALE if old_perf else NOT_RUN}
    cur, base = v["currentBP"], v["baselineBP"]
    stack, base_stack = v["stackTempC"], v.get("baselineStackTempC")
    no_base_stack = msg("기준 스택 온도가 없어 비교하지 않습니다.", "No baseline stack temperature.")

    def from_perf(key, unit, pick):
        if perf:
            return dict(value=pick(perf), rel=perf[key]["rel"] if isinstance(perf.get(key), dict) and perf[key].get("rel") else "DEMO",
                        computed_at=perf_at, reason=perf[key].get("reason") if isinstance(perf.get(key), dict) else None)
        return dict(value=None, rel="REEVALUATION_REQUIRED" if old_perf else "UNAVAILABLE", computed_at=perf_at,
                    reason=STALE if old_perf else NOT_RUN, previous=pick(old_perf) if old_perf else None)

    recovery = ref and ref.get("recovery")
    rec_pct = None if not recovery else [recovery["output_loss_pct"]["low"]["value"], recovery["output_loss_pct"]["high"]["value"]]
    kpis = [
        _kpi("backPressure", msg("가스터빈 배압", "GT back pressure"), cur, "mmH2O", rel=src["currentBP"], baseline=base,
             delta=_round(cur - base), rate=_round((cur - base) / base * 100) if base else None, status=status["code"],
             computed_at=ci.updated_at, note=msg("입력값 (저장 기준)", "Saved input")),
        _kpi("stackTemp", msg("스택 배기가스 온도", "Stack temperature"), stack, "°C", rel=src["stackTempC"], baseline=base_stack,
             delta=_round(stack - base_stack) if base_stack is not None else None,
             rate=_round((stack - base_stack) / base_stack * 100) if base_stack else None,
             reason=None if base_stack is not None else no_base_stack, computed_at=ci.updated_at),
        _kpi("lossMW", msg("발전 출력 손실", "Output loss"), unit="MW", baseline=0,
             **from_perf("lossMW", "MW", lambda p: p["lossMW"]["value"])),
        _kpi("lossMonthlyWon", msg("월간 발전 손실액", "Monthly loss"), unit="원",
             **from_perf("lossWonMonth", "원", lambda p: p["lossWonMonth"]["value"])),
        _kpi("recoveryPct", msg("세정 시 예상 회수 효과", "Expected recovery"), rec_pct, "%", rel="PUBLIC_REF" if rec_pct else "UNAVAILABLE",
             reason=None if rec_pct else (ref and ref.get("recovery_reason")) or msg("HRSG 차압(현재·청정·세정 후)을 입력하고 계산하세요.", "Enter HRSG ΔP values and calculate."),
             note=msg("GT 출력 회복 범위 (GE~IST 문헌 참고)", "GT output recovery range (GE–IST literature)")),
        _kpi("cleaningScore", msg("세정 필요도 지수", "Cleaning-need index"), unit="/100",
             **({**from_perf("cleaningScore", "", lambda p: p["cleaningScore"]["value"]), "rel": "DEMO",
                 "reason": perf["cleaningScore"]["reason"]} if perf else from_perf("cleaningScore", "", lambda p: p["cleaningScore"]["value"]))),
        _kpi("readiness", msg("데이터 준비 수령률", "Data received"), cl["readinessRate"], "%", rel="USER_INPUT",
             baseline=100, delta=None, note=msg(f"{cl['receivedCount']}/{cl['totalCount']} 항목", f"{cl['receivedCount']}/{cl['totalCount']} items")),
    ]

    # 화면 간 공통 상태 키 (프롬프트 6절)
    best = econ and next((m for m in econ["methods"] if m["key"] == econ["shortestPayback"]), None)
    calc_summary_kpi = None if not perf else {
        "backPressure": cur, "deltaP": v.get("hrsgDpKpa"), "stackTemp": stack, "lossMW": perf["lossMW"]["value"],
        "lossMonthlyWon": perf["lossWonMonth"]["value"], "recoveryBenefit": best and best["monthlyBenefit"]["value"],
        "cleaningNeedScore": perf["cleaningScore"]["value"]}
    checklist_readiness = {k: cl[k] for k in ("totalCount", "receivedCount", "requiredMetCount", "readinessRate", "verifiedCount", "missingRequiredCount")}

    # 작업 진행 (자료 준비 → 시뮬레이션 → 분석 → AI 검토)
    analysis_done = all(fresh(k)[0] for k in ("economics", "pinch", "reference"))
    workflow = [
        {"key": "data", "state": "done" if cl["missingRequiredCount"] == 0 else ("progress" if cl["receivedCount"] else "todo"),
         "detail": msg(f"수령 {cl['readinessRate']}% · 필수 {cl['requiredMetCount']}/{cl['requiredCount']}", f"Received {cl['readinessRate']}% · required {cl['requiredMetCount']}/{cl['requiredCount']}"), "link": "/checklist"},
        {"key": "simulation", "state": "done" if perf else ("stale" if old_perf else "todo"),
         "detail": status["label"] if perf else (STALE if old_perf else NOT_RUN), "link": "/simulation"},
        {"key": "analysis", "state": "done" if analysis_done else ("stale" if res.get("economics") else "todo"),
         "detail": msg("경제성·핀치·문헌 추정 최신", "Economics, pinch, literature up to date") if analysis_done else NOT_RUN, "link": "/analysis"},
        _ai_step(case),
    ]

    # 다음 추천 작업 — 현재 케이스 상태에서 자동으로 고릅니다
    recs = []
    def rec(key, tone, ko, en, link):
        recs.append({"key": key, "tone": tone, "text": msg(ko, en), "link": link})
    if not res.get("performance"):
        rec("run", "accent", "시뮬레이션에서 시나리오를 고르고 평가를 실행하세요.", "Pick a scenario and run the evaluation.", "/simulation")
    elif old_perf or any(r["stale"] for k, r in res.items() if k != "comparison"):
        rec("rerun", "caution", "입력이 바뀌었습니다. 재평가를 실행하세요.", "Inputs changed — run the evaluation again.", "/simulation")
    for w in fields.clean_inputs(v)[2]:
        recs.append({"key": "warn-" + w["key"], "tone": "caution", "text": w["message"], "link": "/simulation"})
    if cl["missingRequiredCount"]:
        first = cl["missingRequired"][0]
        rec("missing", "caution", f"필수 데이터 {cl['missingRequiredCount']}개가 아직 수령되지 않았습니다 (예: {first}).",
            f"{cl['missingRequiredCount']} required items not received yet (e.g. {first}).", f"/checklist?item={first}")
    if cl["bySupply"]["REQUEST_NEEDED"]:
        rec("request", "info", f"'요청 필요' {cl['bySupply']['REQUEST_NEEDED']}개 — 요청 메일 초안을 만드세요.",
            f"{cl['bySupply']['REQUEST_NEEDED']} items marked 'request needed' — draft the request e-mail.", "/checklist")
    waiting = cl["bySupply"]["NEEDS_CHECK"] + cl["byVerify"]["IN_PROGRESS"]
    if waiting:
        rec("verify", "info", f"검증 대기 항목 {waiting}개를 확인하세요.", f"Check {waiting} items awaiting verification.", "/checklist")
    if v.get("baselineStackTempC") is None:
        rec("baseStack", "info", "기준 스택 온도를 입력하면 세정 필요도 지수를 계산할 수 있습니다.", "Enter a baseline stack temperature to compute the cleaning index.", "/simulation")
    if econ and any(m["initialCost"]["value"] is None for m in econ["methods"]):
        rec("methods", "info", "고압수·화학 세정 비용·정지일수를 입력하면 공법 3종을 모두 비교할 수 있습니다.", "Enter costs/outage days for water and chemical cleaning to compare all three methods.", "/simulation")
    if not case.measurements.exists():
        rec("measure", "info", "세정 전후 실측값을 입력하면 실제 효과를 비교할 수 있습니다.", "Enter before/after measurements to compare the real effect.", "/before-after")

    # 알림: 계산 경고 + 세정 전후 편차 + 재평가
    alerts = []
    for p in (perf, econ):
        for w in (p or {}).get("warnings", []):
            alerts.append({"tone": "caution", "text": w})
    if comp and comp.get("deviation") and comp["deviation"]["exceeded"]:
        alerts.append({"tone": "danger", "text": comp["deviation"]["message"]})
    for w in (comp or {}).get("warnings", []):
        alerts.append({"tone": "caution", "text": w})

    activity = [{"type": "result", "kind": k, "at": r["computed_at"], "stale": r["stale"]} for k, r in res.items()]
    activity += [{"type": "snapshot", "label": s.label or f"#{s.id}", "id": s.id, "at": s.created_at} for s in case.snapshots.all()[:3]]
    last_m = case.measurements.order_by("-created_at").first()
    if last_m:
        activity.append({"type": "measurement", "label": f"D{last_m.day_offset:+d}", "at": last_m.created_at})
    activity.sort(key=lambda a: a["at"], reverse=True)

    return {
        "case": {"id": case.id, "name": case.name, "is_demo": case.seed_key is not None},
        "mode": ci.mode, "scenario": ci.scenario, "values": v, "sources": src,
        "status": status, "lastEvaluatedAt": perf_at, "kpis": kpis,
        "panel": {"turbineModel": v["turbineModel"], "capacityMW": v["capacityMW"], "loadFactor": v["loadFactor"],
                  "currentBP": cur, "baselineBP": base, "hrsgDpKpa": v.get("hrsgDpKpa"), "stackTempC": stack,
                  "excessBP": perf and perf["excessBP"]["value"], "referenceBand": perf and perf["referenceBand"]},
        "calc_summary_kpi": calc_summary_kpi,
        "calc_economic_params": econ and econ["economicParams"],
        "checklist_readiness": checklist_readiness,
        "checklist": {"summary": cl, "missingRequired": [
            {"id": r.item_id, "name": services.reg.BY_ID[r.item_id]["name"]} for r in rows if r.item_id in cl["missingRequired"]]},
        "actual_performance_gap": comp and comp["actualPerformanceGap"],
        "comparison": comp, "economics": econ and {"methods": econ["methods"], "shortestPayback": econ["shortestPayback"],
                                                    "shortestNote": econ["shortestNote"]},
        "workflow": workflow, "recommendations": recs, "alerts": alerts, "activity": activity[:8],
    }
