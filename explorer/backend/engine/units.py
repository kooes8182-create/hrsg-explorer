"""단위 변환 (표시용). 계산에 쓰는 저장값은 항상 기준 단위이며, 표시 단위를 바꿔도 물리량은 그대로입니다.

정의값
- 1 mmH₂O = 9.80665 Pa (= 0.00980665 kPa, 표준 중력·물 밀도 1000 kg/m³)
- 1 inH₂O = 249.08891 Pa (관용 인치 수주, public_refs.IN_H2O_PA 와 같은 값)
- 1 mbar = 100 Pa, 1 bar = 100 kPa, 1 psi = 6.894757293168 kPa
- 1 lb/h = 0.45359237 kg / 3600 s
"""

from decimal import Decimal

from .public_refs import IN_H2O_PA

D = Decimal
MMH2O_KPA = D("0.00980665")
INH2O_KPA = IN_H2O_PA / 1000
PSI_KPA = D("6.894757293168")
LB_KG = D("0.45359237")

# 단위 → (물리량, 기준 단위로 바꾸는 배수). 기준 단위: 압력 kPa, 온도 °C, 질량 유량 kg/s
_PRESSURE = {"kPa": D(1), "mmH2O": MMH2O_KPA, "inH2O": INH2O_KPA, "mbar": D("0.1"), "bar": D(100), "psia": PSI_KPA}
_FLOW = {"kg/s": D(1), "lb/h": LB_KG / 3600}
QUANTITY = {**{u: "pressure" for u in _PRESSURE}, **{u: "flow" for u in _FLOW}, "°C": "temperature", "°F": "temperature"}


class UnitError(ValueError):
    pass


def convert(value, from_unit, to_unit):
    """value(from_unit) → to_unit. 물리량이 다르면 UnitError."""
    if from_unit == to_unit:
        return D(str(value))
    q1, q2 = QUANTITY.get(from_unit), QUANTITY.get(to_unit)
    if q1 is None or q1 != q2:
        raise UnitError(f"{from_unit} → {to_unit} 변환은 할 수 없습니다.")
    v = D(str(value))
    if q1 == "temperature":
        return v * 9 / 5 + 32 if to_unit == "°F" else (v - 32) * 5 / 9
    table = _PRESSURE if q1 == "pressure" else _FLOW
    return v * table[from_unit] / table[to_unit]


def display_table():
    """화면용 변환표: {단위: {물리량, factor, offset}} — 화면값 = 기준값 × factor + offset (기준: kPa, °C, kg/s)."""
    out = {}
    for u, f in _PRESSURE.items():
        out[u] = {"quantity": "pressure", "factor": float(1 / f), "offset": 0.0}
    for u, f in _FLOW.items():
        out[u] = {"quantity": "flow", "factor": float(1 / f), "offset": 0.0}
    out["°C"] = {"quantity": "temperature", "factor": 1.0, "offset": 0.0}
    out["°F"] = {"quantity": "temperature", "factor": 1.8, "offset": 32.0}
    return out
