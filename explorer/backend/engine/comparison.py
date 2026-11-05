"""세정 전후 비교 (프롬프트 13절).

- 가상 시나리오(점선): DEMO 가정 — 세정 전에는 현재 입력 배압, 세정 후(D0~)에는 기준 배압으로 복귀. 오염 재진행은 반영하지 않음.
- 사용자 실측(실선·점): 입력한 측정값만 그대로 표시. 측정값이 없으면 실측 결과는 만들지 않습니다.
- 운전 조건 편차 가드레일: 세정 전후 평균 부하율 차이 > 5%p 또는 외기 온도 차이 > 5 °C → 효과 단정 불가 경고 (DEMO 기준).
- 회수 출력(실측 기반)은 DEMO 출력 손실 공식으로 세정 전후 배압 차이를 환산한 값입니다.
"""

from decimal import Decimal

from .base import msg, none, val
from .demo_calc import DAYS_PER_MONTH, evaluate_economics, loss_mw, q, won
from .fields import METHODS

D = Decimal
LOAD_TOL_PP = 5
AMBIENT_TOL_C = 5
STACK_WARN_C = 300  # 외부 유입 데이터 경고용 DEMO 임계값 (트립 기준 아님)
DAYS = list(range(-30, 61))

MEASUREMENT_FIELDS = {
    "dayOffset": {"min": -365, "max": 365, "unit": "일", "required": True, "integer": True},
    "backPressure": {"min": 0, "max": 1200, "unit": "mmH2O", "required": True},
    "stackTempC": {"min": 0, "max": 600, "unit": "°C", "required": False},
    "loadFactor": {"min": 30, "max": 105, "unit": "%", "required": False},
    "ambientTempC": {"min": -30, "max": 50, "unit": "°C", "required": False},
}


def _mean(xs):
    xs = [D(str(x)) for x in xs if x is not None]
    return None if not xs else sum(xs) / len(xs)


def evaluate_comparison(v, measurements, method_key=None):
    econ = evaluate_economics(v)
    params = econ["economicParams"]
    method_key = method_key if method_key in {m["key"] for m in METHODS} else (params["method"] if params else None)
    m_out = next((m for m in econ["methods"] if m["key"] == method_key), None)
    cap, load, hours, smp = (D(str(v[k])) for k in ("capacityMW", "loadFactor", "operatingHoursMonth", "smpWonPerKWh"))
    cur, base = D(str(v["currentBP"])), D(str(v["baselineBP"]))
    initial = None if not m_out or m_out["initialCost"]["value"] is None else D(m_out["initialCost"]["value"])
    monthly = None if not m_out or m_out["monthlyBenefit"]["value"] is None else D(m_out["monthlyBenefit"]["value"])

    # 가상 시나리오 (DEMO 가정)
    excess_before = max(D(0), cur - base)
    virtual = {
        "backPressure": [{"x": d, "y": float(cur if d < 0 else base)} for d in DAYS],
        "stackTempC": [{"x": d, "y": v["stackTempC"] if d < 0 else v.get("baselineStackTempC")} for d in DAYS],
        "lossMW": [{"x": d, "y": q(loss_mw(cap, load, excess_before)) if d < 0 else 0.0} for d in DAYS],
        "cumulativeNet": None if initial is None or monthly is None else
        [{"x": d, "y": won(-initial + monthly / DAYS_PER_MONTH * d)} for d in DAYS if d >= 0],
        "assumption": msg("DEMO 가정: 세정 후 기준 배압으로 즉시 복귀, 오염 재진행 미반영. 회수 편익은 선택한 공법의 월간 편익 ÷ 30일.",
                          "DEMO assumption: back pressure returns to baseline right after cleaning; re-fouling ignored. Benefit = method monthly benefit ÷ 30 days."),
    }
    virtual_bep = None
    if initial is not None and monthly:
        virtual_bep = q(initial / (monthly / DAYS_PER_MONTH), "0.1")

    ms = sorted(measurements, key=lambda m: m["dayOffset"])
    before = [m for m in ms if m["dayOffset"] < 0]
    after = [m for m in ms if m["dayOffset"] > 0]
    d0 = next((m for m in ms if m["dayOffset"] == 0), None)
    measured = {k: [{"x": m["dayOffset"], "y": m.get(k), "id": m.get("id")} for m in ms if m.get(k) is not None]
                for k in ("backPressure", "stackTempC")}
    for m in ms:
        lf = D(str(m["loadFactor"])) if m.get("loadFactor") is not None else load
        m["_loss"] = loss_mw(cap, lf, max(D(0), D(str(m["backPressure"])) - base))
    measured["lossMW"] = [{"x": m["dayOffset"], "y": q(m["_loss"])} for m in ms]

    warnings = []
    for m in ms:
        if m.get("stackTempC") is not None and m["stackTempC"] > STACK_WARN_C:
            warnings.append(msg(f"D{m['dayOffset']:+d} 스택 온도 {m['stackTempC']} °C — DEMO 경고 임계값 {STACK_WARN_C} °C 초과 (트립 기준 아님). 측정값을 확인하세요.",
                                f"D{m['dayOffset']:+d} stack temperature {m['stackTempC']} °C exceeds the DEMO warning threshold {STACK_WARN_C} °C (not a trip limit)."))

    no_data = msg("세정 전(D<0)과 세정 후(D≥0) 실측값이 모두 있어야 합니다.", "Needs measurements both before (D<0) and after (D≥0) cleaning.")
    post = after + ([d0] if d0 else [])
    kpi, gap, deviation = None, None, None
    if before and post:
        latest = max(post, key=lambda m: m["dayOffset"])
        first_post = d0 or min(after, key=lambda m: m["dayOffset"])
        bp_before = _mean(m["backPressure"] for m in before)
        loss_before = _mean(m["_loss"] for m in before)
        rec = max(D(0), loss_before - latest["_loss"])
        daily = rec * 1000 * hours / DAYS_PER_MONTH * smp
        cum = daily * latest["dayOffset"] - (initial or 0)
        measured["cumulativeNet"] = None if initial is None else [
            {"x": d, "y": won(daily * d - initial)} for d in range(0, max(latest["dayOffset"], 0) + 1)]
        st_before = _mean(m.get("stackTempC") for m in before)
        kpi = {
            "backPressureBefore": val(q(bp_before, "0.1"), "mmH2O", rel="MEASURED"),
            "backPressureAfter": val(latest["backPressure"], "mmH2O", rel="MEASURED", day=latest["dayOffset"]),
            "backPressureChange": val(q(D(str(latest["backPressure"])) - bp_before, "0.1"), "mmH2O", rel="MEASURED"),
            "stackTempChange": val(q(D(str(latest["stackTempC"])) - st_before, "0.1"), "°C", rel="MEASURED")
            if st_before is not None and latest.get("stackTempC") is not None else none("°C", msg("스택 온도 실측 없음", "No stack temperature measured")),
            "recoveryMW": val(q(rec), "MW", rel="DEMO", note=msg("실측 배압 차이를 DEMO 손실 공식으로 환산", "Measured ΔBP converted with the DEMO loss formula")),
            "cumulativeNet": val(won(cum), "원", rel="DEMO") if initial is not None else none("원", msg("선택 공법의 초기 비용이 없습니다.", "No initial cost for the selected method.")),
        }
        lb, la = _mean(m.get("loadFactor") for m in before), _mean(m.get("loadFactor") for m in post)
        ab, aa = _mean(m.get("ambientTempC") for m in before), _mean(m.get("ambientTempC") for m in post)
        dl = None if lb is None or la is None else q(abs(la - lb), "0.1")
        da = None if ab is None or aa is None else q(abs(aa - ab), "0.1")
        exceeded = (dl is not None and dl > LOAD_TOL_PP) or (da is not None and da > AMBIENT_TOL_C)
        deviation = {"loadDiffPP": dl, "ambientDiffC": da, "limits": {"loadPP": LOAD_TOL_PP, "ambientC": AMBIENT_TOL_C},
                     "exceeded": exceeded, "rel": "DEMO",
                     "message": msg("운전 조건 편차가 커서 세정 효과를 단정할 수 없습니다.",
                                    "Operating conditions differ too much to conclude the cleaning effect.") if exceeded else None,
                     "missing": dl is None or da is None,
                     "note": msg("DEMO 비교 가드레일 (실제 설비 판정 기준 아님)", "DEMO comparison guardrail (not a real plant criterion)")}
        gap = {"d0_backPressure": first_post["backPressure"], "current_backPressure": latest["backPressure"],
               "actualRecoveryMW": q(rec), "bepAchieved": None if initial is None else bool(cum >= 0)}
    return {
        "method": method_key, "methodName": m_out["name"] if m_out else None,
        "initialCost": m_out["initialCost"] if m_out else none("원", msg("공법을 계산할 수 없습니다.", "No computable method.")),
        "virtual": virtual, "virtualBepDays": virtual_bep, "measured": measured,
        "kpi": kpi, "kpiReason": None if kpi else no_data, "deviation": deviation,
        "actualPerformanceGap": gap, "warnings": warnings, "count": len(ms),
    }
