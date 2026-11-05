"""IAPWS-IF97 포화온도 식 (Region 4 backward equation, Eq. 31).

출처: IAPWS R7-97(2012) Section 8.2, 계수 Table 34. 검증값 Table 36 은 test_reference.py 에서 확인합니다.
적용 범위: 포화압력 611.213 Pa(273.15 K) ~ 22.064 MPa(임계점).
"""

import math

# Table 34 (n1 ~ n10)
N = [
    0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5, -0.32325550322333e7,
    0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3,
]
P_MIN_MPA = 611.213e-6
P_CRIT_MPA = 22.064
STANDARD_ATM_MPA = 0.101325  # 게이지 압력 → 절대압력 변환 (표준 대기압 가정)


def saturation_temperature_k(p_mpa):
    """절대압력 p(MPa) → 포화온도(K). 범위 밖이면 ValueError."""
    if not (P_MIN_MPA <= p_mpa <= P_CRIT_MPA):
        raise ValueError("pressure out of range")
    n1, n2, n3, n4, n5, n6, n7, n8, n9, n10 = N
    beta = p_mpa ** 0.25
    e = beta**2 + n3 * beta + n6
    f = n1 * beta**2 + n4 * beta + n7
    g = n2 * beta**2 + n5 * beta + n8
    d = 2 * g / (-f - math.sqrt(f**2 - 4 * e * g))
    return (n10 + d - math.sqrt((n10 + d) ** 2 - 4 * (n9 + n10 * d))) / 2
