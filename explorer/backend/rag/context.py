"""화면 맥락 → AI 에 넘기는 서버 값 (Floating AI 의 'AI에게 질문하기').

브라우저가 보낸 숫자는 쓰지 않습니다. 화면 이름(page)만 받아, 이 케이스의 DB 에 저장된 입력·계산 결과·체크리스트 집계로
줄 목록을 만듭니다. 재평가가 필요한(stale) 결과는 현재 값으로 넘기지 않고 'not current' 로만 적습니다.
케이스 이름·메모·자유 입력 문자열은 넣지 않습니다 (민감정보 노출 방지).
"""

from cases import services as S
from cases import checklist_registry as reg

PAGES = {
    "dashboard": {"ko": "대시보드", "en": "Dashboard"},
    "calculator": {"ko": "성능·경제성 계산기", "en": "Calculator"},
    "simulation": {"ko": "시뮬레이션", "en": "Simulation"},
    "analysis": {"ko": "심층 분석", "en": "Analysis"},
    "before-after": {"ko": "세정 전후 비교", "en": "Before & after"},
    "checklist": {"ko": "데이터 요청 체크리스트", "en": "Data checklist"},
}

# 화면별로 넘기는 범위 (질문에 필요한 만큼만)
_SECTIONS = {
    "dashboard": ("inputs_short", "performance", "economics_short", "checklist_short"),
    "calculator": ("inputs", "performance", "economics"),
    "simulation": ("inputs", "performance"),
    "analysis": ("inputs_short", "performance", "economics", "pinch", "reference"),
    "before-after": ("inputs_short", "comparison", "economics_short"),
    "checklist": ("checklist",),
}


def _f(v):
    return "not computed" if v is None else v


def _val(d):
    return _f((d or {}).get("value"))


def _inputs(ci, short):
    v = ci.values
    lines = [f"current back pressure = {v.get('currentBP')} mmH2O", f"baseline back pressure = {v.get('baselineBP')} mmH2O",
             f"stack temperature = {v.get('stackTempC')} °C", f"capacity = {v.get('capacityMW')} MW, load factor = {v.get('loadFactor')} %"]
    if not short:
        lines += [f"baseline stack temperature = {_f(v.get('baselineStackTempC'))} °C", f"monthly operating hours = {v.get('operatingHoursMonth')} h",
                  f"SMP = {v.get('smpWonPerKWh')} KRW/kWh, target recovered output = {v.get('targetRecoveryMW')} MW"]
    return lines


def _performance(p):
    st = p.get("status") or {}
    return [f"operating status (DEMO scenario label, not a threshold judgment) = {(st.get('label') or {}).get('en', st.get('code'))}",
            f"excess back pressure = {_val(p.get('excessBP'))} mmH2O",
            f"output loss (DEMO kit formula) = {_val(p.get('lossMW'))} MW",
            f"monthly loss = {_val(p.get('lossWonMonth'))} KRW",
            f"cleaning-need index (DEMO heuristic, 0-100) = {_val(p.get('cleaningScore'))}"]


def _economics(e, short):
    out = []
    for m in e.get("methods", []):
        name = m["name"]["en"]
        if short:
            out.append(f"{name}: payback {_val(m.get('paybackMonths'))} months (assumption-based)")
        else:
            out.append(f"{name}: initial cost {_val(m.get('initialCost'))} KRW, monthly benefit {_val(m.get('monthlyBenefit'))} KRW, "
                       f"payback {_val(m.get('paybackMonths'))} months, break-even {_val(m.get('bepDays'))} days")
    if e.get("shortestPayback"):
        out.append(f"shortest payback under assumptions (not a recommendation) = {e['shortestPayback']}")
    return out


def _pinch(p):
    return [f"pinch (IAPWS-IF97 saturation temperature) = {_val(p.get('pinch'))} °C",
            f"approach = {_val(p.get('approach'))} °C",
            "DEMO reference ranges (not plant design criteria): pinch 8-15 °C, approach 5-12 °C"]


def _reference(r):
    eff = r.get("effects") or {}
    pct = eff.get("output_loss_pct") or {}
    return [f"public-literature reference range of output recovery (other machines, scaled by ΔP; not a forecast) = "
            f"{_val(pct.get('low'))}~{_val(pct.get('high'))} %"]


def _comparison(c):
    lines = [f"cleaning method in comparison = {(c.get('methodName') or {}).get('en', c.get('method'))}",
             f"measurement points = {c.get('count', 0)}",
             f"virtual (DEMO) break-even = {_f(c.get('virtualBepDays'))} days"]
    k = c.get("kpi")
    if k:
        lines += [f"measured back pressure before = {_val(k.get('backPressureBefore'))} mmH2O, after = {_val(k.get('backPressureAfter'))} mmH2O",
                  f"measured back pressure change = {_val(k.get('backPressureChange'))} mmH2O, stack temperature change = {_val(k.get('stackTempChange'))} °C",
                  f"recovered output (measured ΔBP via DEMO loss formula) = {_val(k.get('recoveryMW'))} MW"]
    else:
        lines.append("measured before/after KPI = not available (needs measurements both before and after cleaning)")
    if c.get("deviation"):
        lines.append("warning: load or ambient conditions differ between before/after measurements")
    return lines


def _checklist(case, short):
    rows = list(case.checklist.all())
    s = S.checklist_summary(rows)
    lines = [f"data received = {s['receivedCount']}/{s['totalCount']} items ({_f(s['readinessRate'])} %)",
             f"required items met = {s['requiredMetCount']}/{s['requiredCount']} (required criteria are provisional)",
             f"needs check = {s['bySupply']['NEEDS_CHECK']}, request needed = {s['bySupply']['REQUEST_NEEDED']}, not entered = {s['bySupply']['NOT_ENTERED']}"]
    missing = [f"{i} {reg.BY_ID[i]['name']['en']}" for i in s["missingRequired"]]
    if missing:
        lines.append("missing required: " + ", ".join(missing[: 6 if short else 20]) + (" ..." if short and len(missing) > 6 else ""))
    if not short:
        check = [f"{r.item_id} {reg.BY_ID[r.item_id]['name']['en']}" for r in rows if r.supply_status == "NEEDS_CHECK"]
        if check:
            lines.append("needs verification: " + ", ".join(check[:20]))
    return lines


def build(case, page):
    """→ {"page", "label", "lines", "stale"} (page 가 잘못되면 None)."""
    if page not in PAGES:
        return None
    ci = S.get_input(case)
    res = S.results(case)["results"]
    lines = [f"current screen: {PAGES[page]['en']}; mode {ci.mode}; DEMO engine values from the server, not plant measurements"]
    stale = []

    def result(kind):
        r = res.get(kind)
        if not r:
            lines.append(f"{kind}: not evaluated yet")
            return None
        if r["stale"]:
            stale.append(kind)
            lines.append(f"{kind}: inputs changed after the last evaluation — previous values are not current and are omitted")
            return None
        return r["payload"]

    for sec in _SECTIONS[page]:
        if sec in ("inputs", "inputs_short"):
            lines += _inputs(ci, sec == "inputs_short")
        elif sec == "performance" and (p := result("performance")):
            lines += _performance(p)
        elif sec in ("economics", "economics_short") and (e := result("economics")):
            lines += _economics(e, sec == "economics_short")
        elif sec == "pinch" and (p := result("pinch")):
            lines += _pinch(p)
        elif sec == "reference" and (r := result("reference")):
            lines += _reference(r)
        elif sec == "comparison" and (c := result("comparison")):
            lines += _comparison(c)
        elif sec in ("checklist", "checklist_short"):
            lines += _checklist(case, sec == "checklist_short")
    # 화면 맞춤 추천 질문이 '보낼 수 있는지' 판단할 근거 (값이 없으면 화면이 자동 전송하지 않고 안내)
    fresh = {k: bool(r) and not r["stale"] for k, r in ((k, res.get(k)) for k in ("performance", "economics", "pinch", "reference", "comparison"))}
    comp = res.get("comparison")
    available = {**fresh, "comparison_kpi": bool(fresh["comparison"] and comp["payload"].get("kpi")),
                 "measurements": case.measurements.count(), "checklist": True}
    return {"page": page, "label": PAGES[page], "lines": lines, "stale": stale, "available": available}
