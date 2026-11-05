# 03. 데이터 모델 (Django ORM / PostgreSQL)

앱 이름: `core`. 사용자 모델은 만들지 않습니다(단일 사용자, 로그인 없음).

## 1. 모델

### EvaluationCase — 평가 케이스
| 필드 | 타입 | 설명 |
|---|---|---|
| id | BigAutoField | |
| name | CharField(100) | 필수 |
| memo | TextField | blank 허용 |
| created_at / updated_at | DateTimeField | 자동 |

### ChecklistItem — 케이스별 체크리스트 항목
케이스 생성 시 §3 초안 목록에서 복사해 만듭니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| case | FK(EvaluationCase, CASCADE) | |
| key | CharField(50) | 초안 항목 키 (예: `gt_model`). `(case, key)` unique |
| category | CharField choices | §2 범주 코드 |
| order | PositiveSmallIntegerField | 표시 순서 |
| name_ko / name_en | CharField(200) | 항목명 |
| value | TextField **null=True** | 비어 있으면 null. 0으로 바꾸지 않음 |
| unit | CharField(30) | 기본 단위, 수정 가능 |
| condition | CharField(200) | 측정 위치 또는 조건 |
| measured_at | DateTimeField null | 측정 시점 |
| memo | TextField | |
| status | CharField choices | `MISSING`(미수신, 기본) / `RECEIVED`(수신) / `VERIFIED`(검증 완료) |
| source | CharField | 항상 `PLAN_DRAFT` (계획서 기반 초안) |
| updated_at | DateTimeField | |

검증: `status=VERIFIED` 인데 `value` 가 null/빈 문자열이면 저장 거부(400).

### ChecklistRequirement — 평가 기능별 필수 여부
코드 상수(`core/checklist_seed.py`)로 관리하고 DB 모델로 만들지 않습니다(사용자 편집 기능이 요구사항에 없음).

```python
REQUIREMENTS = {  # key -> {평가기능: 필수여부}
    "drum_pressure": {"PINCH_APPROACH": True},
    ...
}
REQUIREMENT_IS_PROVISIONAL = True   # 모든 기준은 임시 기준
```

### CalculationInput — 케이스별 계산 입력 (케이스당 1개)
| 필드 | 타입 | 설명 |
|---|---|---|
| case | OneToOne(EvaluationCase) | |
| mode | CharField | `DEMO` / `REAL` |
| scenario_id | CharField null | `DEMO-NORMAL` / `DEMO-ALARM` / `DEMO-TRIP` / null |
| operating_values | JSONField | 운전값 `{key: number or null}` (05 §2.2 키) |
| economics_assumptions | JSONField | 경제성 가정값 (05 §4) |
| pinch_inputs | JSONField | 핀치·어프로치 입력 (05 §5) |
| updated_at | DateTimeField | |

`is_modified`(시나리오 값과 다른지)는 저장하지 않고 서버가 매번 시나리오 고정값과 비교해 계산합니다.

### CalculationResult — 계산 결과 (케이스·종류별 최신 1건)
| 필드 | 타입 | 설명 |
|---|---|---|
| case | FK(EvaluationCase) | `(case, kind)` unique — 다시 계산하면 덮어씀 |
| kind | CharField | `PERFORMANCE` / `ECONOMICS` / `PINCH_APPROACH` |
| basis | CharField | `DEMO_FIXED` / `USER_ASSUMPTION` / `UNAVAILABLE` / `REEVALUATION_REQUIRED` |
| payload | JSONField | API 응답의 `result` 부분 그대로 |
| inputs_snapshot | JSONField | 계산에 쓴 입력 |
| model_version | CharField | 예: `DEMO-SCENARIO-v1`, `USER-ASSUMPTION-CALC-v1`, `NOT-CONNECTED` |
| data_source | CharField | 예: `가상 데모 시나리오`, `사용자 입력 가정값` |
| computed_at | DateTimeField | |

- 케이스·kind별 **1건만** 저장합니다(계산 이력 기능은 요구사항에 없음).
- 결과 화면을 열 때 서버는 결과의 `inputs_snapshot` 과 현재 입력을 **kind별 범위로** 비교해 다르면 `stale: true` 로 응답합니다.

  | kind | 비교 범위 |
  |---|---|
  | PERFORMANCE | `mode`, `scenario_id`, `operating_values` |
  | ECONOMICS | `economics_assumptions` |
  | PINCH_APPROACH | `pinch_inputs` |

  (예: SMP만 바꾸면 경제성 결과만 stale, 성능 결과는 유지)

### QuestionLog — 질문 이력
| 필드 | 타입 | 설명 |
|---|---|---|
| case | FK(EvaluationCase) | |
| lang | CharField | `ko` / `en` (질문에서 감지) |
| question | TextField | |
| answer | TextField | |
| answer_type | CharField | `DEMO_TEMPLATE` (향후 `LLM`) |
| intent | CharField | 06 §3 의도 코드 |
| referenced | JSONField | 참조한 결과 `{kind, basis, computed_at}` 목록과 체크리스트 key 목록 (결과는 덮어쓰므로 id 대신 저장) |
| created_at | DateTimeField | |

## 2. 체크리스트 범주 코드
| 코드 | 한국어 | English |
|---|---|---|
| `GT_INFO` | 가스터빈 정보 | Gas turbine information |
| `FUEL_EXHAUST` | 연료 및 배기가스 운전 데이터 | Fuel & exhaust gas operating data |
| `WATER_STEAM` | 급수 및 증기 운전 데이터 | Feedwater & steam operating data |
| `EMISSIONS` | 배출가스 운전 데이터 | Stack emission operating data |
| `MODULE_DESIGN` | 열교환 모듈 사양과 설계값 | Heat exchange module specs & design values |
| `PINCH_APPROACH` | 핀치·어프로치 평가 항목 | Pinch/approach evaluation items |
| `SCHEDULE_SITE` | 일정과 현장 조건 | Schedule & site conditions |

## 3. 체크리스트 초안 항목 (계획서 기반 초안)

계획서의 범주명만 근거로 만든 **초안**입니다. 사내 요청 양식의 실제 항목과 다를 수 있습니다.
필수 열: P = 성능 평가(PERFORMANCE), A = 핀치·어프로치(PINCH_APPROACH). 모두 **임시 기준**.

| 범주 | key | 항목명 | 기본 단위 | P | A |
|---|---|---|---|---|---|
| GT_INFO | `gt_model` | 가스터빈 모델명 | — | ● | |
| GT_INFO | `gt_rated_output` | 가스터빈 정격 출력 | MW | | |
| GT_INFO | `gt_load` | 운전 부하 | % | ● | |
| GT_INFO | `ambient_temp` | 대기 온도 | °C | ● | |
| FUEL_EXHAUST | `fuel_type` | 연료 종류 | — | | |
| FUEL_EXHAUST | `fuel_flow` | 연료 유량 | kg/s | | |
| FUEL_EXHAUST | `gt_exhaust_temp` | 가스터빈 배기가스 온도 | °C | ● | |
| FUEL_EXHAUST | `gt_exhaust_flow` | 가스터빈 배기가스 유량 | kg/s | ● | |
| FUEL_EXHAUST | `gt_back_pressure` | 가스터빈 배압 | kPa | ● | |
| FUEL_EXHAUST | `hrsg_dp` | HRSG 가스측 차압 (ΔP) | kPa | ● | |
| WATER_STEAM | `feedwater_flow` | 급수 유량 | t/h | ● | |
| WATER_STEAM | `feedwater_temp` | 급수 온도 (절탄기 입구) | °C | ● | |
| WATER_STEAM | `steam_flow` | 주증기 유량 | t/h | ● | |
| WATER_STEAM | `steam_pressure` | 주증기 압력 | MPa | ● | |
| WATER_STEAM | `steam_temp` | 주증기 온도 | °C | ● | |
| EMISSIONS | `stack_temp` | 굴뚝(스택) 온도 | °C | ● | |
| EMISSIONS | `stack_o2` | 배출가스 O₂ 농도 | % | | |
| EMISSIONS | `stack_nox` | 배출가스 NOx 농도 | ppm | | |
| MODULE_DESIGN | `module_arrangement` | 열교환 모듈 구성 (과열기·증발기·절탄기 배열) | — | ● | |
| MODULE_DESIGN | `tube_fin_spec` | 튜브·핀 사양 | — | | |
| MODULE_DESIGN | `design_hrsg_dp` | 설계 가스측 차압 | kPa | ● | |
| MODULE_DESIGN | `design_stack_temp` | 설계 굴뚝 온도 | °C | ● | |
| MODULE_DESIGN | `design_steam_flow` | 설계 증기 생산량 | t/h | ● | |
| PINCH_APPROACH | `drum_pressure` | 드럼 압력 | MPa | | ● |
| PINCH_APPROACH | `eco_outlet_water_temp` | 절탄기 출구 급수 온도 | °C | | ● |
| PINCH_APPROACH | `evap_outlet_gas_temp` | 증발기 출구 가스 온도 | °C | | ● |
| SCHEDULE_SITE | `outage_window` | 세정 가능 정지 기간 | — | | |
| SCHEDULE_SITE | `last_cleaning` | 최근 세정 이력 (시기·공법) | — | | |
| SCHEDULE_SITE | `site_access` | 현장 접근·작업 조건 | — | | |
| SCHEDULE_SITE | `data_period` | 운전 데이터 측정 기간 | — | | |

- 경제성(ECONOMICS)은 체크리스트 필수 항목이 없습니다(사용자 가정값으로 계산).
- 항목·단위·필수 여부는 사내 양식 확보 후 교체 대상입니다 → [09](09_missing_materials.md).
