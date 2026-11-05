"""DEMO 계산 엔진 — HRSG 계산기 키트(팀 1, common-0.2) 연결판.

계산은 키트 calc.py 의 calculate · compare_methods · loss_curve 를 그대로 부르고, 이 파일은 키트 결과를
화면이 쓰는 결과 형식(값 + 단위 + 산출 불가 이유)으로 옮기기만 합니다. 화면 상태 → 키트 입력은 engine/kit.py 의
어댑터(to_kit_inputs) 하나에서 바꿉니다. 계수·임계값·공법 데이터는 모두 키트 data/calculator.json 의 DEMO 값입니다.

세정 전후 비교(comparison.py)는 키트 연결표에 없는 화면이라 이전 DEMO 공식(loss_mw)을 그대로 씁니다.
"""

from decimal import ROUND_HALF_UP, Decimal

from . import kit
from .base import msg, none, val
from .fields import STATUS, effective_scenario

Dm = Decimal
VERSION = f"KIT-{kit.D()['engine']}"
LEGACY_VERSION = "DEMO-ENGINE-v1"
K = kit.D()["constants"]

# ---------------------------------------------------------------- 세정 전후 비교 전용 (이전 DEMO 공식, 키트 연결 범위 밖)
LOSS_COEF = Dm("0.0013")
DAYS_PER_MONTH = 30


def loss_mw(cap, load, excess):
    return cap * load / 100 * excess / 100 * LOSS_COEF


DEMO_COEFFICIENTS = [
    {"key": "gt_loss_pct_per_mbar", "value": K["gt_loss_pct_per_mbar"], "label": msg("GT 손실 계수 (%/mbar)", "GT loss factor (%/mbar)"),
     "where": "GT 손실 = GT 정격 × 0.08 %/mbar × 초과 압력 × 부하율"},
    {"key": "st_loss_pct_per_c", "value": K["st_loss_pct_per_c"], "label": msg("ST 손실 계수 (%/°C)", "ST loss factor (%/°C)"),
     "where": "ST 손실 = ST 정격 × 0.12 %/°C × 스택 초과 × 부하율"},
    {"key": "outage_margin_ratio", "value": K["outage_margin_ratio"], "label": msg("정지 손실 마진율", "Outage margin ratio"),
     "where": "정지 손실 = (GT + ST 정격) × 부하율 × 정지일수 × 24 h × 전력 단가 × 2%"},
    {"key": "index_weights", "value": " / ".join(f"{k} {w}" for k, w in K["index_weights"].items()),
     "label": msg("세정 필요도 지수 가중치", "Cleaning-index weights"),
     "where": "지수 = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압 + 0.25 × 스택 온도) 초과 비율"},
    {"key": "public_ref_inh2o", "value": "~".join(str(x) for x in K["public_ref_inh2o"]), "label": msg("공개 참고 구간 (inH₂O)", "Public reference (inH₂O)"),
     "where": "배압 상태 게이지의 참고 구간"},
]

NOTICE = msg(
    "DEMO 계산 엔진 (HRSG 계산기 키트 common-0.2). 식과 계수는 임시 DEMO 값이며 승인된 발전 성능 모델이 아닙니다. 실제 설비 판단에 사용하지 마세요.",
    "DEMO engine (HRSG calculator kit common-0.2). Formulas and factors are provisional DEMO values, not an approved plant model. Do not use for real decisions.",
)
MODEL_NOT_CONNECTED = msg("사용자 입력 모드: 검증된 성능 모델이 연동되지 않아 산출하지 않습니다.",
                          "User mode: no validated performance model is connected, so this is not computed.")
SCORE_NOTE = msg("DEMO 지표입니다 (키트 세정 필요도 지수). 실제 세정 필요성 판정 기준이 아닙니다.",
                 "DEMO index (kit cleaning-need index), not a real criterion for cleaning need.")
_EN = {"세정 비용": "cleaning cost", "정지일수": "outage days", "간접 비용": "indirect cost", "회수 출력": "recovered output"}


def q(x, places="0.001"):
    return float(Dm(str(x)).quantize(Dm(places), rounding=ROUND_HALF_UP))


def won(x):
    return int(Dm(str(x)).quantize(Dm("1"), rounding=ROUND_HALF_UP))


def money(x, **extra):
    """금액: 원 단위 정수 + 키트 format_krw 글자(「2.04억 원」)"""
    return val(won(x), "원", text=kit.calc.format_krw(x), **extra)


def _fmt(x):
    return f"{x:,.3f}".rstrip("0").rstrip(".") if isinstance(x, float) else f"{x:,}"


def _run(v):
    """→ (inp, 키트 calculate 결과) 또는 (inp, None, 오류 이유)"""
    inp = kit.to_kit_inputs(v)
    check = kit.calc.validate_inputs(inp, kit.D())
    if not check["ok"]:
        return inp, None, msg("키트 입력 검사 오류: " + " / ".join(check["errors"]), "Kit input check failed: " + " / ".join(check["errors"]))
    return inp, kit.calc.calculate(inp, kit.D()), None


# ---------------------------------------------------------------- 성능 (시뮬레이션·계산기 공통)
def evaluate_performance(mode, scenario, v):
    sc = effective_scenario(v, scenario) if mode == "DEMO" else None
    inp, r, err = _run(v)
    band_mm = [q(kit.calc.from_mbar(kit.calc.to_mbar(x, "inh2o"), "mmh2o"), "0.1") for x in K["public_ref_inh2o"]]
    base = {"scenario": sc, "currentBP": val(v.get("currentBP"), "mmH2O"), "baselineBP": val(v.get("baselineBP"), "mmH2O"),
            "stackTempC": val(v.get("stackTempC"), "°C"), "notice": NOTICE, "engine": VERSION}

    if mode != "DEMO" or r is None:
        reason = MODEL_NOT_CONNECTED if mode != "DEMO" else err
        rel = "MODEL_NOT_CONNECTED" if mode != "DEMO" else "UNAVAILABLE"
        status = {"code": "UNKNOWN", "label": STATUS["UNKNOWN"], "rel": rel, "reason": reason}
        return {**base, "status": status, "excessBP": none("mmH2O", reason), "excessBP_inH2O": none("inH2O", reason),
                "lossMW": none("MW", reason, rel=rel), "lossWonMonth": none("원", reason, rel=rel),
                "cleaningScore": {"value": None, "bpPart": None, "tempPart": None, "rel": "DEMO", "note": SCORE_NOTE, "reason": reason},
                "referenceBand": {"mmH2O": band_mm, "inH2O": K["public_ref_inh2o"], "position": None,
                                  "note": msg("공개 참고 구간 (판정 아님)", "Public reference band (not a judgment)")},
                "gauge": None, "lossCurve": None, "steps": [], "warnings": [], "indicators": None}, None

    kp = r["kpi"]
    excess_mm, excess_mbar = kp["excess_bp"]["mmh2o"], kp["excess_bp"]["mbar"]
    code = {"normal": "NORMAL", "caution": "ALARM", "danger": "TRIP"}[r["overall_level"]]
    status = {"code": code, "label": STATUS[code], "rel": "DEMO",
              "reason": msg("키트 DEMO 지표 판정: GT 배압·HRSG 차압·스택 온도 중 가장 나쁜 상태 (실제 설비 기준 아님).",
                            "Kit DEMO indicator check: worst of GT back pressure, HRSG ΔP and stack temperature (not a real plant criterion).")}
    loss = r["loss"]
    idx = r["index"]
    curve = kit.calc.loss_curve(inp, kit.D(), param="gt_bp")
    g = r["gauge"]
    lo, hi = band_mm
    position = "BELOW" if excess_mm < lo else ("WITHIN" if excess_mm <= hi else "ABOVE")
    n = r["indicators"]
    steps = [
        {"id": "excess", "label": msg("초과 압력", "Excess pressure"),
         "formula": "초과 압력 [mbar] = max(0, HRSG 차압 − 설계, GT 배압 − 설계)  (더 큰 초과분 하나)",
         "substituted": f"max(0, {_fmt(n['hrsg_dp_mbar']['value'])} − {_fmt(n['hrsg_dp_mbar']['design'])}, "
                        f"{_fmt(round(n['gt_bp_mbar']['value'], 3))} − {_fmt(round(n['gt_bp_mbar']['design'], 3))})",
         "result": q(excess_mbar, "0.01"), "unit": "mbar"},
        {"id": "loss", "label": msg("발전 출력 손실", "Output loss"),
         "formula": "GT 손실 = GT 정격 × 0.08 %/mbar × 초과 압력 × 부하율 · ST 손실 = ST 정격 × 0.12 %/°C × 스택 초과 × 부하율",
         "substituted": f"{q(loss['gt_mw'])} + {q(loss['st_mw'])}", "result": q(loss["total_mw"]), "unit": "MW",
         "note": msg("계수 = 키트 DEMO 상수", "Factors = kit DEMO constants")},
        {"id": "lossWon", "label": msg("월간 발전 손실액", "Monthly loss"),
         "formula": "월간 금액 [원] = MW × 월간 가동시간 × 전력 단가(원/MWh)",
         "substituted": f"{q(loss['total_mw'])} × {_fmt(v['operatingHoursMonth'])} × {_fmt(v['smpWonPerKWh'])} × 1000",
         "result": won(r["monthly_loss_krw"]), "unit": "원"},
        {"id": "index", "label": msg("세정 필요도 지수", "Cleaning-need index"),
         "formula": "지수 = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압 + 0.25 × 스택 온도)  — 각 초과 비율 = clamp((값 − 설계)/(위험값 − 설계), 0, 1)",
         "result": q(idx["value"], "0.1"), "unit": "/100"},
    ]
    result = {
        **base, "status": status,
        "currentBP": val(q(kp["current_bp"]["mmh2o"], "0.1"), "mmH2O"),
        "excessBP": val(q(excess_mm, "0.1"), "mmH2O"),
        "excessBP_inH2O": val(q(kit.calc.from_mbar(excess_mbar, "inh2o"), "0.01"), "inH2O"),
        "lossMW": val(q(loss["total_mw"]), "MW", rel="DEMO"),
        "lossWonMonth": money(r["monthly_loss_krw"], rel="DEMO"),
        "cleaningScore": {"value": q(idx["value"], "0.1"), "bpPart": q(idx["pressure_part"], "0.1"), "tempPart": q(idx["temp_part"], "0.1"),
                          "rel": "DEMO", "note": SCORE_NOTE, "reason": None,
                          "formula": "지수 = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압 + 0.25 × 스택 온도) 초과 비율"},
        "referenceBand": {"mmH2O": band_mm, "inH2O": K["public_ref_inh2o"], "position": position,
                          "note": msg("공개 사례의 세정 참고 기준(청정 대비 3~4 inH₂O 증가)과의 비교 — 판정 아님",
                                      "Compared with a public cleaning rule of thumb (3–4 inH₂O over clean) — not a judgment")},
        "gauge": {"valueMM": q(g["value"]["mmh2o"], "0.1"), "maxMM": q(g["max"]["mmh2o"], "0.1"),
                  "refMM": [q(x["mmh2o"], "0.1") for x in g["public_ref"]]},
        "lossCurve": [{"x": q(p["excess"]["mmh2o"], "0.1"), "y": q(p["loss_mw"])} for p in curve["points"]],
        "indicators": {k: {"value": x["value"], "design": x["design"], "caution": x["caution"], "danger": x["danger"], "level": x["level"]}
                       for k, x in n.items()},
        "steps": steps,
        "warnings": [msg(w, w) for w in r["input_warnings"]],
    }
    return result, loss["total_mw"]


# ---------------------------------------------------------------- 경제성
def _method_out(row):
    mk = kit.method_key(row["id"])
    name = msg(row["name"], kit.METHOD_EN.get(row["id"], row["name"]))
    if not row["available"]:
        reason = msg(row["message"], "Not computable — input required: " + ", ".join(_EN.get(x, x) for x in row["missing"]))
        out = {"key": mk, "name": name, "available": False, "message": reason}
        for k, u in (("recoveryMW", "MW"), ("cost", "원"), ("outageDays", "일"), ("monthlyBenefit", "원"), ("outageCost", "원"),
                     ("initialCost", "원"), ("paybackMonths", "개월"), ("bepDays", "일"), ("firstMonthNet", "원")):
            out[k] = none(u, reason)
        return out
    pay = row["payback_months"]
    no_pay = msg("월간 회수 편익이 0 이라 회수기간을 계산할 수 없습니다 (산출 불가).", "Monthly benefit is 0, so payback cannot be computed.")
    return {
        "key": mk, "name": name, "available": True,
        "recoveryMW": val(q(row["recovered_mw"]), "MW", source={"mw": "METHOD", "ratio": "RATIO", "target": "TARGET"}[row["recovery_basis"]]),
        "recoveryRatio": row["recovery_ratio"],
        "cost": money(row["cost_krw"]), "outageDays": val(row["outage_days"], "일"),
        "indirectCost": money(row["indirect_krw"]),
        "monthlyBenefit": money(row["monthly_benefit_krw"]), "outageCost": money(row["outage_loss_krw"], rel="DEMO"),
        "initialCost": money(row["total_investment_krw"]),
        "paybackMonths": val(q(pay, "0.01"), "개월") if pay is not None else none("개월", no_pay),
        "bepDays": val(q(row["breakeven_days"], "0.1"), "일", rel="DEMO") if pay is not None else none("일", no_pay),
        "firstMonthNet": money(row["first_month_net_krw"]),
        "annualNet": money(row["annual_net_krw"]),
    }


def evaluate_economics(v, loss=None):
    inp, r, err = _run(v)
    if r is None:
        return {"methods": [], "shortestPayback": None, "maxNetBenefit": None, "order": {}, "economicParams": None,
                "sensitivity": {"smp": {"x": [], "unit": "원/kWh", "series": {}}, "hours": {"x": [], "unit": "h", "series": {}}, "y_unit": "개월"},
                "steps": [], "warnings": [err], "coefficients": DEMO_COEFFICIENTS, "notice": NOTICE,
                "shortestNote": msg("회수기간이 가장 짧은 공법 (가정 기준, 추천 아님)", "Shortest payback (under assumptions, not a recommendation)"),
                "doubleCountNote": msg("", "")}
    D = kit.D()
    cmp = r["methods"]
    methods = [_method_out(row) for row in cmp["rows"]]
    keyed = {m["key"]: m for m in methods}
    best = kit.method_key(cmp["best_payback_id"]) if cmp["best_payback_id"] else None
    # 비교 탭 정렬 (키트 compare_methods 의 정렬을 그대로)
    order = {tab: [kit.method_key(x["id"]) for x in kit.calc.compare_methods(inp, D, sort)["rows"]]
             for tab, sort in (("paybackMonths", "payback"), ("initialCost", "total"), ("firstMonthNet", "net"))}

    # 민감도: SMP·월간 가동시간만 바꾸고 나머지 입력은 그대로 (키트 compare_methods)
    def paybacks(econ_over):
        x = {**inp, "economics": {**inp["economics"], **econ_over}}
        return {kit.method_key(row["id"]): (q(row["payback_months"], "0.01") if row["available"] and row["payback_months"] is not None else None)
                for row in kit.calc.compare_methods(x, D)["rows"]}
    smp_axis = list(range(50, 501, 25))
    hours_axis = [100, 200, 300, 400, 500, 600, 700, 744]
    smp_runs = [paybacks({"price_krw_per_kwh": x}) for x in smp_axis]
    hour_runs = [paybacks({"monthly_hours": x}) for x in hours_axis]
    ok_keys = [m["key"] for m in methods if m["available"] and m["paybackMonths"]["value"] is not None]
    sensitivity = {
        "smp": {"x": [float(x) for x in smp_axis], "unit": "원/kWh", "series": {k: [run[k] for run in smp_runs] for k in ok_keys}},
        "hours": {"x": [float(x) for x in hours_axis], "unit": "h", "series": {k: [run[k] for run in hour_runs] for k in ok_keys}},
        "y_unit": "개월",
    }
    params = None
    if best:
        b = keyed[best]
        params = {"method": best, "monthlyNetBenefit": b["monthlyBenefit"]["value"], "initialCost": b["initialCost"]["value"],
                  "bepDays": b["bepDays"]["value"], "targetRecoveryMW": b["recoveryMW"]["value"]}
    steps = [
        {"id": "recovery", "label": msg("회수 출력", "Recovered output"),
         "formula": "회수 출력 = 공법 회수 출력 → 없으면 회수율: 현재 손실 − (설계 초과분이 회수율만큼 줄어든 뒤의 손실) → 둘 다 없으면 목표 회수 출력"},
        {"id": "outage", "label": msg("정지 손실", "Outage loss"),
         "formula": "정지 손실 = (GT + ST 정격) × 부하율 × 정지일수 × 24 h × 전력 단가 × 2%",
         "note": msg("2% = 키트 DEMO 마진율", "2% = kit DEMO margin ratio")},
        {"id": "initial", "label": msg("총투자", "Total investment"), "formula": "총투자 = 세정 비용 + 간접 비용 + 정지 손실"},
        {"id": "benefit", "label": msg("월간 편익", "Monthly benefit"), "formula": "월간 편익 = 회수 출력 × 월간 가동시간 × 전력 단가(원/MWh)"},
        {"id": "payback", "label": msg("투자 회수기간", "Payback"), "formula": "회수기간 [개월] = 총투자 ÷ 월간 편익 (편익 0 이면 산출 불가)"},
        {"id": "bep", "label": msg("손익분기 일수", "Break-even days"), "formula": "손익분기 [일] = 회수기간 × 월간 가동시간 ÷ 24"},
        {"id": "net", "label": msg("첫 달 순편익", "First-month net benefit"), "formula": "첫 달 순편익 = 월간 편익 − 총투자",
         "note": msg("첫 달 기준 값이며 누적 순편익이 아닙니다.", "First month only — not cumulative.")},
    ]
    return {
        "methods": methods, "shortestPayback": best,
        "maxNetBenefit": kit.method_key(cmp["max_net_benefit_id"]) if cmp["max_net_benefit_id"] else None,
        "order": order,
        "shortestNote": msg("회수기간이 가장 짧은 공법 기준 (가정 기준, 추천 아님)", "Shortest payback under these assumptions (not a recommendation)"),
        "economicParams": params, "sensitivity": sensitivity, "steps": steps,
        "warnings": [msg(w, w) for w in r["warnings"]],
        "coefficients": DEMO_COEFFICIENTS, "notice": NOTICE,
        "doubleCountNote": msg("가동시간은 월간 편익에만, 정지일수는 정지 손실에만 씁니다 (중복 차감 없음).",
                               "Operating hours feed only the monthly benefit; outage days only the outage cost (no double counting)."),
    }
