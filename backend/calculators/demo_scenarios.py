"""DEMO 시나리오와 데모 예시값 (모두 가상 값).

화면 확인용으로 지정한 고정값입니다. 실제 설비 상태, 제조사 운전 한계, 성능 산정식이 아닙니다.
운전 상태(정상/경보/트립)는 임계값 비교로 판정하지 않고 시나리오에 '지정'되어 있습니다.
"""

from .base import msg

DEMO_VERSION = "DEMO-SCENARIO-v1"
DEMO_SOURCE = msg("가상 데모 시나리오 (실제 설비·운전 한계 아님)", "Virtual demo scenario (not a real plant or operating limit)")
DEMO_NOTICE = msg(
    "입력값, 결과, 상태 기준이 모두 시연용 가상 값입니다. 실제 설비 상태나 운전 한계가 아닙니다.",
    "Inputs, results and status criteria are all virtual values for demonstration. They are not real plant conditions or limits.",
)
STATUS_BASIS = msg(
    "데모 시나리오에 지정된 상태입니다. 실제 판정 기준이 적용되지 않았습니다.",
    "This status is assigned by the demo scenario. No real criteria were applied.",
)
TRIP_NO_EXAMPLE = msg(
    "트립 상태 데모 시나리오에는 성능 손실 예시값이 없습니다.",
    "The trip demo scenario has no example value for performance loss.",
)

# 운전값은 공개 사례의 차압 수준을 참고한 가상 값입니다 (POWER 2015: 세정 전 ~19.5 in H2O ≈ 4.86 kPa, 세정 후 ~13.2 in H2O ≈ 3.29 kPa).
# 예시 손실·회수값은 같은 입력의 '공개 문헌 기반 참고 추정' 범위(GE~IST) 안에서 정한 가상 값입니다.
# 공통 참고 입력: 청정 기준 차압 3.3 kPa, 세정 후 기대 차압 3.3 kPa, 가스터빈 출력 160 MW (모두 가상).
SCENARIO_NOTE = msg(
    "운전값은 공개 사례의 차압 수준(세정 전 약 19.5 in H2O, 세정 후 약 13.2 in H2O — POWER 2015)을 참고한 가상 값입니다.",
    "Operating values are virtual, modeled on ΔP levels in a public case (about 19.5 in H2O before and 13.2 in H2O after cleaning — POWER 2015).",
)


def _reference(dp):
    return {"current_dp_kpa": dp, "clean_dp_kpa": 3.3, "post_cleaning_dp_kpa": 3.3, "gt_output_mw": 160}


SCENARIOS = {
    "DEMO-NORMAL": {
        "label": msg("가상 정상", "Virtual normal"),
        "operating_values": {
            "gt_model": "DEMO-GT", "gt_load": 100, "ambient_temp": 15, "gt_exhaust_temp": 600,
            "gt_exhaust_flow": 650, "gt_back_pressure": 3.9, "hrsg_dp": 3.4, "stack_temp": 95, "steam_flow": 300,
        },
        "reference_inputs": _reference(3.4),
        "result": {"status": "NORMAL", "performance_loss": 0.1, "cleaning_recovery": 0.1},
    },
    "DEMO-ALARM": {
        "label": msg("가상 경보", "Virtual alarm"),
        "operating_values": {
            "gt_model": "DEMO-GT", "gt_load": 100, "ambient_temp": 15, "gt_exhaust_temp": 601,
            "gt_exhaust_flow": 650, "gt_back_pressure": 4.8, "hrsg_dp": 4.2, "stack_temp": 104, "steam_flow": 292,
        },
        "reference_inputs": _reference(4.2),
        "result": {"status": "ALARM", "performance_loss": 1.0, "cleaning_recovery": 0.8},
    },
    "DEMO-TRIP": {
        "label": msg("가상 트립", "Virtual trip"),
        "operating_values": {
            "gt_model": "DEMO-GT", "gt_load": 100, "ambient_temp": 15, "gt_exhaust_temp": 602,
            "gt_exhaust_flow": 650, "gt_back_pressure": 5.5, "hrsg_dp": 4.9, "stack_temp": 112, "steam_flow": 284,
        },
        "reference_inputs": _reference(4.9),
        "result": {"status": "TRIP", "performance_loss": None, "cleaning_recovery": None},
    },
}

# 경제성 '데모 값' — 가상 공법 A/B 의 가정 예시입니다. 실제 업체 가격이나 공식 SMP가 아닙니다.
ECONOMICS_EXAMPLE = {
    "smp": 120,  # 데모 값 (공개 실적은 경제성 화면의 'SMP 참고값' 에서 따로 고를 수 있음)
    "methods": {
        "A": {"recovered_mw": 1.5, "operating_hours": 4000, "cleaning_cost": 300_000_000,
              "extra_cost": 50_000_000, "extra_cost_included": False},
        "B": {"recovered_mw": 1.0, "operating_hours": 4200, "cleaning_cost": 150_000_000,
              "extra_cost": 20_000_000, "extra_cost_included": False},
    },
}


def public_scenarios():
    """화면에 보내는 시나리오 목록 (입력값만. 결과는 평가 요청 시 서버가 반환)."""
    return [
        {"id": sid, "label": s["label"], "operating_values": s["operating_values"],
         "reference_inputs": s["reference_inputs"]}
        for sid, s in SCENARIOS.items()
    ]
