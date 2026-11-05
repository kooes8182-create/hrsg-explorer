# 계산식 — 두 팀 공통 (common-0.2, 임시)

모든 숫자는 DEMO 값이고, 식은 임시 식입니다. 값은 `data/calculator.json` 에서 읽고, 구현은 `calc.js`(JavaScript)와 `calc.py`(Python) 두 판이 있고 결과가 같습니다. 아래 함수 이름은 JavaScript 기준이며, Python 은 snake_case 입니다(`compareMethods` → `compare_methods`).
두 팀이 같은 식을 씁니다. 화면에 무엇을 보여 줄지만 팀마다 다릅니다.

## 입력 (`inp`)

| 묶음 | 키 | 뜻 (단위) | 필수 |
|---|---|---|---|
| equipment | `gt_class` | 가스터빈 등급 `F` / `H` / `E` | ✓ |
| | `load_pct` | 운전 부하율 (%) | ✓ |
| | `gt_bp_<단위>` | GT 배압·현재 배압 | ✓ |
| | `hrsg_dp_<단위>` | HRSG 가스측 차압 | ✓ |
| | `stack_c` | 스택 온도 (°C) | ✓ |
| | `rated_gt_mw`, `rated_st_mw` | 정격 출력 (MW) — 없으면 GT 등급 값 | |
| | `base_gt_bp_<단위>`, `base_hrsg_dp_<단위>`, `base_stack_c` | 기준(설계)값 — 없으면 GT 등급 값 | |
| | `gt_exhaust_c`, `exhaust_flow_kgs`, `ambient_c` | GT 배기 온도, 배기 유량, 외기 온도 — 없으면 열회수 효율 null | |
| economics | `price_krw_per_kwh` 또는 `price_krw_per_mwh` | 전력 단가 (SMP) — 둘 중 하나 | ✓ |
| | `monthly_hours`, `annual_hours` | 월간 가동시간, 연간 운전 시간 — 하나만 있으면 ×12 / ÷12 로 채움 | ✓(하나 이상) |
| | `target_recovery_mw` | 목표 회수 출력 (MW) | |
| methods[] | `id`, `name`, `cost_krw`, `outage_days`, `indirect_krw`, `recovery_ratio`, `recovery_mw` | 세정 공법 | |
| sections | `HP` / `IP` / `LP`: `drum_barg`, `evap_outlet_gas_c`, `econ_outlet_water_c`, `pinch_design_c`, `approach_design_c` | 핀치·어프로치 (없으면 null) | |
| | `hp_steam_tph` | HP 스팀 생산량 (t/h) | |

**압력 단위**는 키 이름 끝에 붙입니다: `_mbar`, `_mmh2o`, `_kpa`, `_inh2o` 중 하나 (1 mmH₂O = 0.0980665 mbar, 1 kPa = 10 mbar, 1 inH₂O = 2.49089 mbar).
계산은 mbar 로 하고, 결과의 압력은 `{ mbar, mmh2o }` 두 단위로 줍니다.

`defaultInputs(D)` = 예시 운전 상태 (F-Class, GT 배압 30 · HRSG 차압 30 mbar · 스택 95 °C), `designInputs(D, 'F')` = 설계 상태(손실 0).

## 손실·금액 (`calculate`)

```
지표 판정 (GT 배압 · HRSG 차압 · 스택 온도)   값 ≥ 위험 → 위험 / ≥ 주의 → 주의 / 그 외 정상.  종합 = 가장 나쁜 것
초과 압력 [mbar] = max(0, HRSG 차압 − 설계, GT 배압 − 설계)          # 더 큰 초과분 하나 (이중 계산 방지)
스택 초과 [°C]   = max(0, 스택 온도 − 설계)
GT 손실 [MW]     = GT 정격 × 0.08 %/mbar × 초과 압력 × 부하율
ST 손실 [MW]     = ST 정격 × 0.12 %/°C   × 스택 초과 × 부하율
발전 출력 손실   = GT 손실 + ST 손실                                   기본값: 1.08 + 0.81 = 1.89 MW
월간 금액 [원]   = MW × 월간 가동시간 × 전력 단가(원/MWh)              월간 손실 2.04억 원
연간 금액 [원]   = MW × 연간 운전 시간 × 전력 단가                     연간 손실 22.68억 원
```

## 세정 필요도(오염) 지수 · 열회수 효율

```
초과 비율(지표) = clamp((값 − 설계) / (위험값 − 설계), 0, 1)
지수 [0~100]    = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압 + 0.25 × 스택 온도)      기본값 41.1
  압력 기여     = 100 × (0.5 × HRSG 차압 + 0.25 × GT 배압)                         33.3
  온도 기여     = 100 × 0.25 × 스택 온도                                           7.8
열회수 효율     = (배기온도 − 스택온도) / (배기온도 − 외기온도)                     86.32% (설계 87.18%)
```

- 게이지(`gauge`): 초과 압력을 0 ~ (지표 max − 설계) 눈금에, 공개 참고 3~4 inH₂O 구간과 함께.
- 효율 추이(`efficiencyTrend`): 설계 → 현재 효율을 12개월 선형 저하로 가정한 13개 점 + 세정 후.
- 압력-손실 곡선(`lossCurve`): `param: 'hrsg_dp'` 또는 `'gt_bp'` 하나만 min~max 로 바꾼 손실. 점마다 값·초과분(mbar, mmH₂O)과 손실 MW.

## 세정 공법 (`compareMethods`)

```
회수 출력 [MW]  = recovery_mw 가 있으면 그 값
                  → 없으면 recovery_ratio: 현재 손실 − (세 지표의 설계 초과분이 회수율만큼 줄어든 뒤의 손실)
                  → 둘 다 없으면 목표 회수 출력
정지 손실       = (GT + ST 정격) × 부하율 × 정지일수 × 24 h × 전력 단가 × 2%
총투자          = 세정 비용 + 간접 비용 + 정지 손실
월간 편익       = 월간 금액(회수 출력)            연간 편익 = 연간 금액(회수 출력)
첫 달 순편익    = 월간 편익 − 총투자              연간 순편익 = 연간 편익 − 총투자
회수기간 [개월] = 총투자 ÷ 월간 편익 (편익 0 이면 null → 「산출 불가」)
손익분기 [일]   = 회수기간 × 월간 가동시간 ÷ 24
```

| 기본값 | 회수율 | 회수 출력 | 총투자 | 회수기간 | 연간 순편익 |
|---|---|---|---|---|---|
| 기계식 세정 | 45% | 0.85 MW | 3.25억 | 3.54개월 | 6.96억 |
| 고압수 세정 | 60% | 1.13 MW | 4.04억 | 3.30개월 | 9.57억 |
| 드라이아이스 세정 | 70% | 1.32 MW | 4.46억 | **3.12개월 (회수기간 최단)** | 11.42억 |
| 화학 세정 | 85% | 1.61 MW | 7.42억 | 4.27개월 | **11.86억 (순편익 최대)** |

- 비용·정지일수·간접 비용 중 하나라도 비면 「산출 불가 — 입력 필요: 세정 비용, 정지일수, 간접 비용」.
- `best_payback_id` = 회수기간이 가장 짧은 공법 (「가정 기준, 추천 아님」), `max_net_benefit_id` = 연간 순편익이 가장 큰 공법 (모두 0 이하면 null). 「권장」·「추천」이라고 쓰지 않습니다.
- 정렬: `compareMethods(inp, D, 'payback' | 'total' | 'net' | 'annual_net')`.
- `default_method`(기계식 세정)로 세정했을 때의 회수: `calculate().default_method` (회수 출력, 월간·연간 회수액, 손실 대비 회수율).
- 경고: 회수 출력을 직접 넣었거나 목표 회수 출력을 쓴 공법의 회수 출력이 현재 손실보다 크면 `warnings` 에 문구가 들어갑니다.

## 핀치·어프로치 (`pinchSection`, `keyIndicators`)

```
포화온도 = IAPWS-IF97 Region 4 (드럼 압력 + 1.01325 bar → 절대압)   # 검증: 0.1 MPa 99.606 · 10 MPa 310.999 °C
핀치     = 증발기 출구 가스 온도 − 포화온도
어프로치 = 포화온도 − 절탄기 출구 급수 온도
판정     어프로치 < 0 → 위험(스티밍 우려) / 핀치 > 설계 + 3 °C → 주의 / |어프로치 − 설계| > 3 °C → 주의 / 그 외 정상
         값이 없으면 「데이터 필요」 + 체크리스트 「B. HRSG 열역학/설계」로 연결
```

`keyIndicators` = 섹션 3개(HP 정상, IP·LP 데이터 필요) + KPI 10개(종합 상태, HP 핀치·어프로치, HP 스팀, 열회수 효율, 손실, 세정 후 회복, 연간 손실, 세정 비용(기본 공법 총투자), 투자 회수 기간).
