"""평가 케이스 질문 — 템플릿 DEMO 답변 (AI 아님). 기존 HRSG 앱의 템플릿 질문 기능을 이 앱 데이터에 맞게 옮겼습니다.

질문의 핵심어로 주제를 고르고, 서버에 저장된 값(입력·계산 결과·체크리스트·공개 SMP)만 문장에 넣습니다.
주제를 찾지 못하면 답할 수 있는 주제 목록을 돌려줍니다. 새 수치를 만들지 않습니다.
"""

from cases.overview import overview
from engine import public_refs

TOPICS = [
    ("loss", ("손실", "배압", "출력", "loss", "back pressure", "output")),
    ("economics", ("경제", "회수기간", "비용", "공법", "편익", "payback", "cost", "method", "benefit")),
    ("pinch", ("핀치", "어프로치", "포화", "pinch", "approach", "saturation")),
    ("data", ("데이터", "체크리스트", "누락", "필요", "자료", "data", "checklist", "missing")),
    ("smp", ("smp", "전력가격", "계통한계")),
    ("beforeafter", ("세정 전후", "실측", "before", "after", "measured")),
]


def _topic(q):
    ql = q.lower()
    for key, words in TOPICS:
        if any(w in ql for w in words):
            return key
    return None


def _n(x, d=3):
    if x is None:
        return "—"
    t = f"{x:,.{d}f}"
    return t.rstrip("0").rstrip(".") if d > 0 else t  # 정수 자리의 0 은 지우지 않음


def answer(case, question, lang):
    o = overview(case)
    k = {x["key"]: x for x in o["kpis"]}
    t = _topic(question)
    ko = lang == "ko"
    sources = []
    if t == "loss":
        loss = k["lossMW"]
        if loss["value"] is None:
            text = ("출력 손실이 아직 계산되지 않았거나 입력이 바뀌어 재평가가 필요합니다. 계산기에서 [계산 실행]을 누르세요."
                    if ko else "Output loss is not calculated yet or needs re-evaluation. Run the calculator.")
        else:
            ex = o["panel"]["excessBP"]
            text = (f"현재 배압 {_n(k['backPressure']['value'], 1)} mmH₂O, 기준 배압 {_n(k['backPressure']['baseline'], 1)} mmH₂O 이고, "
                    f"HRSG 차압·GT 배압 중 더 큰 설계 초과분(초과 배압)은 {_n(ex, 1)} mmH₂O 입니다. DEMO 공식으로 계산한 출력 손실은 {_n(loss['value'])} MW, "
                    f"월간 손실액은 {_n(k['lossMonthlyWon']['value'], 0)} 원입니다. 계수는 계산기 키트의 DEMO 값입니다."
                    if ko else
                    f"Back pressure {_n(k['backPressure']['value'], 1)} mmH₂O vs baseline {_n(k['backPressure']['baseline'], 1)} gives "
                    f"{_n(k['backPressure']['delta'], 1)} mmH₂O excess. DEMO output loss {_n(loss['value'])} MW, monthly loss "
                    f"{_n(k['lossMonthlyWon']['value'], 0)} KRW. The factors are DEMO values from the calculator kit.")
        sources = ["계산기 성능 결과 (DEMO 엔진)" if ko else "Calculator performance result (DEMO engine)"]
    elif t == "economics":
        e = o["economics"]
        if not e:
            text = "경제성 결과가 없습니다. 계산기에서 계산을 실행하세요." if ko else "No economics result. Run the calculator."
        else:
            lines = []
            for m in e["methods"]:
                pb = m["paybackMonths"]["value"]
                lines.append(f"- {m['name'][lang]}: " + (f"{'회수기간' if ko else 'payback'} {_n(pb, 2)} {'개월' if ko else 'months'}, "
                                                        f"{'총투자' if ko else 'investment'} {_n(m['initialCost']['value'], 0)} {'원' if ko else 'KRW'}"
                                                        if pb is not None else (m["paybackMonths"]["reason"] or {}).get(lang, "—")))
            text = ("공법별 경제성 (DEMO 가정, 추천 아님):\n" if ko else "Economics by method (DEMO assumptions, not a recommendation):\n") + "\n".join(lines)
        sources = ["계산기 경제성 결과 (DEMO 엔진)" if ko else "Calculator economics (DEMO engine)"]
    elif t == "pinch":
        from cases.services import results
        p = results(case)["results"].get("pinch")
        if not p or p["stale"]:
            text = "핀치·어프로치 결과가 없거나 재평가가 필요합니다." if ko else "Pinch/approach result missing or stale."
        else:
            pl = p["payload"]
            text = (f"드럼 포화온도는 {_n(pl['saturationTempC']['value'], 2)} °C (IAPWS-IF97), 핀치 {_n(pl['pinch']['value'], 2)} °C, "
                    f"어프로치 {_n(pl['approach']['value'], 2)} °C 입니다. DEMO 참고 범위는 핀치 8~15 °C, 어프로치 5~12 °C 이며 판정 기준이 아닙니다."
                    if ko else
                    f"Saturation {_n(pl['saturationTempC']['value'], 2)} °C (IAPWS-IF97), pinch {_n(pl['pinch']['value'], 2)} °C, "
                    f"approach {_n(pl['approach']['value'], 2)} °C. DEMO ranges 8–15 / 5–12 °C are references, not criteria.")
        sources = ["IAPWS-IF97", "IST 2000"]
    elif t == "data":
        miss = o["checklist"]["missingRequired"]
        s = o["checklist"]["summary"]
        text = (f"전체 {s['totalCount']}개 중 {s['receivedCount']}개를 수령했습니다. 아직 받지 못한 필수 항목 {len(miss)}개: "
                + ", ".join(f"{m['id']} {m['name'][lang]}" for m in miss[:10]) + (" …" if len(miss) > 10 else "")
                if ko else
                f"{s['receivedCount']} of {s['totalCount']} items received. {len(miss)} required items missing: "
                + ", ".join(f"{m['id']} {m['name'][lang]}" for m in miss[:10]) + (" …" if len(miss) > 10 else ""))
        sources = ["데이터 요청 체크리스트" if ko else "Data request checklist"]
    elif t == "smp":
        a = public_refs.SMP_ANNUAL
        text = ("KPX 공개 SMP(육지, 연평균): " + ", ".join(f"{y}년 {v} 원/kWh" for y, v in a.items())
                + f". 현재 계산 입력값은 {o['values']['smpWonPerKWh']} 원/kWh (DEMO) 입니다. 과거 실적이며 예측이 아닙니다."
                if ko else
                "KPX public SMP (mainland, annual): " + ", ".join(f"{y}: {v} KRW/kWh" for y, v in a.items())
                + f". Current input {o['values']['smpWonPerKWh']} KRW/kWh (DEMO). Historical, not a forecast.")
        sources = [f"KPX/EPSIS ({public_refs.CHECKED_ON})"]
    elif t == "beforeafter":
        g = o["actual_performance_gap"]
        text = ((f"세정 직후 배압 {_n(g['d0_backPressure'], 1)} → 현재 {_n(g['current_backPressure'], 1)} mmH₂O, "
                 f"실측 기반 회수 출력(DEMO 환산) {_n(g['actualRecoveryMW'])} MW 입니다." if ko else
                 f"BP right after cleaning {_n(g['d0_backPressure'], 1)} → now {_n(g['current_backPressure'], 1)} mmH₂O; "
                 f"recovered output (DEMO conversion) {_n(g['actualRecoveryMW'])} MW.") if g else
                ("세정 전후 실측값이 없습니다. 세정 전후 비교 화면에서 입력하세요." if ko else "No before/after measurements yet."))
        sources = ["세정 전후 실측값" if ko else "Before/after measurements"]
    else:
        text = ("이 템플릿 답변은 다음 주제만 다룹니다: 출력 손실·배압, 공법별 경제성, 핀치·어프로치, 필요 데이터, SMP, 세정 전후. "
                "논문 근거가 필요한 질문은 '논문 근거 질문'을 쓰세요." if ko else
                "Template answers cover: output loss/back pressure, method economics, pinch/approach, required data, SMP, before/after. "
                "Use the literature tab for evidence-based questions.")
    return {"topic": t, "text": text, "sources": sources, "type": "TEMPLATE_DEMO"}
