"""성능 평가: DEMO 시나리오 경로와 실제 평가 경로(모델 미연동).

실제 모델이 생기면 PerformanceModel 을 구현해 evaluate_performance() 의 REAL 분기만 교체합니다.
실제 평가 요청을 데모 결과로 대신하지 않습니다.
"""

from . import demo_scenarios as demo
from .base import DEMO_FIXED, REEVALUATION_REQUIRED, UNAVAILABLE, msg, none, numbers_equal, val

UNITS = {"performance_loss": "MW", "cleaning_recovery": "MW"}

NOT_CONNECTED = msg(
    "승인된 계산 모델이 연동되지 않아 결과를 산출할 수 없습니다.",
    "The approved calculation model is not connected, so no result can be produced.",
)
REEVALUATE = msg(
    "입력 변경으로 재평가 필요 / 실제 모델 미연동",
    "Inputs changed — re-evaluation required / real model not connected",
)
STATUS_PENDING_REAL = msg("판정 보류 — 실제 판정 기준과 모델이 없습니다.", "Pending — no real criteria or model.")


class PerformanceModel:
    """성능 모델 인터페이스. 실제 모델은 서버에서만 실행하며, 식·계수를 응답에 넣지 않습니다."""

    version = ""
    data_source = None

    def evaluate(self, operating_values):
        raise NotImplementedError


class NotConnectedModel(PerformanceModel):
    version = "NOT-CONNECTED"
    data_source = msg("승인된 계산 모델 없음", "No approved calculation model")

    def evaluate(self, operating_values):
        return UNAVAILABLE, {
            "status": none(None, STATUS_PENDING_REAL),
            "status_basis": None,
            "performance_loss": none("MW", NOT_CONNECTED),
            "cleaning_recovery": none("MW", NOT_CONNECTED),
        }


def _demo_result(scenario_id, operating_values):
    scenario = demo.SCENARIOS[scenario_id]
    same = all(numbers_equal(operating_values.get(k), v) for k, v in scenario["operating_values"].items())
    if not same:
        # 시나리오 값을 바꾸면 예시 결과를 쓰지 않습니다 (몰래 계산하거나 추정하지 않음).
        return REEVALUATION_REQUIRED, {
            "status": none(None, REEVALUATE),
            "status_basis": None,
            "performance_loss": none("MW", REEVALUATE),
            "cleaning_recovery": none("MW", REEVALUATE),
        }
    fixed = scenario["result"]
    result = {"status": val(fixed["status"], None), "status_basis": demo.STATUS_BASIS}
    for key, unit in UNITS.items():
        v = fixed[key]
        result[key] = val(v, unit) if v is not None else none(unit, demo.TRIP_NO_EXAMPLE)
    return DEMO_FIXED, result


def evaluate_performance(mode, scenario_id, operating_values):
    """반환: (basis, result, model_version, data_source, notice)"""
    if mode == "DEMO":
        basis, result = _demo_result(scenario_id, operating_values)
        return basis, result, demo.DEMO_VERSION, demo.DEMO_SOURCE, demo.DEMO_NOTICE
    model = NotConnectedModel()
    basis, result = model.evaluate(operating_values)
    return basis, result, model.version, model.data_source, None
