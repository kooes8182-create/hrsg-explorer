# 11. 공개 자료 근거 (Phase 6)

사용자 요청(2026-10-19): 실제 논문·공개 데이터를 참고해 데모를 현실화한다. 단 실제 플랜트 데이터·사내 계산 모델은 여전히 없다.
원칙: **원문에서 직접 확인한 값만 쓴다.** 결과는 항상 '공개 문헌 기반 참고 추정'(basis `REFERENCE_ESTIMATE`)으로 표시하고, 승인 모델(실제 평가)은 계속 '미연동'으로 둔다.
코드 위치: `backend/calculators/public_refs.py` (출처·계수·SMP 값), API `GET /api/public/sources/`, `GET /api/public/smp/`.

## 1. 사용한 자료 (원문 직접 확인, 2026-10-19)

| key | 자료 | 확인한 원문 (쪽·위치) | 앱에서 쓰는 곳 | 적용 한계 |
|---|---|---|---|---|
| `GE_GER3567H` | F.J. Brooks, *GE Gas Turbine Performance Characteristics*, GER-3567H, GE Power Systems, 2000 | p.10 Fig.12 "4 Inches (10 mbar) H2O Exhaust Drop Produces: 0.42% Power Output Loss, 0.42% Heat Rate Increase, 1.9 F (1.1 C) Exhaust Temperature Increase" / p.9 "effects … unique to each design" | 참고 추정 낮은 쪽 출력 손실, 열소비율, 배기온도 | Frame 7EA 한 기종, 단순사이클 |
| `IST_2000` | Innovative Steam Technologies, *Heat Recovery Steam Generators*, EPIC Turbines & Cogeneration Workshop, 2000 | §1.1(e) "additional gas side pressure drop of 4 inches WG results in approximately 1% decline in the electrical power output"; §1.2 핀치·어프로치 정의, "optimum pinch point ranges from 10 F to 30 F", "Typical approach temperatures are approximately 25 F", economizer steaming 회피 | 참고 추정 높은 쪽, 핀치·어프로치 정의·참고 범위 | 제조사 경험값 |
| `POWER_2015` | C. Norton, R. Taikowski Jr., "CO2 Blasting Restores HRSG Performance", *POWER*, 2015-06-01 | "cleaning is required when the gas path pressure drop … reaches 3 to 4 inches H2O over 'new and clean'"; 19.5 → 13.2 in H2O; GE 계수 적용 0.66% | 세정 참고 기준(3~4 in), 체크리스트 '청정 기준 차압', 데모 차압 수준, 검증용 사례(0.66%) | 발전소 1곳 사례 |
| `ASME_PTC44` | ASME PTC 4.4 공개 소개문 (asme.org) | "determination of the gas turbine exhaust flow by two different means … including units with auxiliary duct burners" | 체크리스트 2항목(배기 유량 산정 방법, 덕트 버너 연료) | 표준 본문(유료)은 읽지 않음 |
| `IAPWS_IF97` | IAPWS R7-97(2012) Revised Release on IAPWS-IF97 | §8.2 Eq.(31), Table 34 계수, Table 36 검증값(0.1/1/10 MPa → 372.755919/453.035632/584.149488 K) | 드럼 포화온도 | 611.213 Pa ~ 22.064 MPa |
| `KPX_SMP` | 한국전력거래소 월별·연도별 SMP, EPSIS 가중평균 SMP | 육지 월평균 2025-01~2026-09, 연평균 2022~2025; EPSIS "가중평균SMP는 시간대별 SMP를 시간대별 전력수요예측량으로 가중평균한 값", 단위 원/kWh | SMP 참고값·그래프, 질문 답변 | 과거 실적, 예측 아님. 이용조건은 "공공데이터포털 이용허락범위 제한 없음"으로만 표기 |

## 2. 조사했지만 쓰지 않은 자료
- Ahmed 외(2018, IJLCT) 핀치·어프로치 10~15 °C: 원문 페이지가 차단되어 직접 확인하지 못함.
- NAES(압력파 세정 사례), CCJ(KinetiClean·Ventanilla 사례), Brun & Kurz(2018): 하위 조사에서만 확인, 직접 대조하지 않음 / 제조사 홍보성.
- 오염 ↔ 굴뚝 온도·스팀터빈 출력 관계, HRSG 설계 차압 '일반값', 세정 비용: 일반적으로 쓸 수 있는 공개 근거 없음 → 계산하지 않음.
- 2023~2024 SMP 월평균: EPSIS 조회 결과를 직접 재확인하지 못해 제외(연평균만 사용).

## 3. 계산 규칙
- 차압 증가 = 현재 차압 − 신규·세정 직후 기준 차압 (kPa). 1 in H2O = 249.08891 Pa (ρ = 1000 kg/m³, g = 9.80665 m/s²).
- 출력 손실 % 범위 = 증가(in H2O) × [0.42 (GE), 1 (IST)] ÷ 4. MW = 가스터빈 출력 × % ÷ 100. 열소비율 % = × 0.42 ÷ 4, 배기온도 °C = × 1.1 ÷ 4 (GE 만).
- 4 in 한 점의 값을 비례 적용(선형 가정). 원문은 4 in 한 점만 제시함을 화면에 밝힘.
- 세정 참고 기준 비교: 증가 < 3 in → 낮음, 3~4 in → 범위 안, > 4 in → 높음 (POWER 2015). **판정이 아니라 참고 비교.**
- 회복 참고 범위 = (현재 − 세정 후 기대 차압)에 같은 계수 적용.
- 현재 < 기준이면 계산하지 않고 측정 조건 확인 안내. 스팀터빈·굴뚝 온도는 null + "공개 근거 없음".
- 핀치 = 증발기 출구 가스 온도 − Tsat, 어프로치 = Tsat − 절탄기 출구 급수 온도 (IST 정의). Tsat 은 IAPWS-IF97 Eq.(31), 게이지 압력이면 표준 대기압 0.101325 MPa 를 더함(가정, 화면에 표시). 참고 범위: 핀치 10~30 °F(5.56~16.67 °C), 어프로치 약 25 °F(13.89 °C). 어프로치 ≤ 0 이면 IST 의 steaming 회피 설명을 표시.
- 경제성 입력 출처: `PUBLIC` 은 SMP 값이 확인된 공개값과 같을 때만, `REFERENCE` 는 회수 출력이 저장된(무효 아닌) 참고 추정 MW 값과 같을 때만 인정.

## 4. 검증 (자동 테스트 `backend/core/test_reference.py`)
- IAPWS Table 36 값 일치 (오차 1e-6 K 이하)
- POWER 2015 사례: 19.5 → 13.2 in H2O 입력 시 낮은 쪽 0.66% (기사 값과 일치)
- 분수(Fraction) 기반 독립 계산과 일치, 세정 기준 경계값(2.99/3/4/4.01 in), 반복 일치, 입력 변경 시 무효
- 데모 예시 손실·회수값이 같은 입력의 참고 범위 안에 있음
- 공개 SMP 값이 KPX 확인값과 같음, 출처 표시 검증, 질문 답변 수치가 공개값·저장 결과에서만 나옴
