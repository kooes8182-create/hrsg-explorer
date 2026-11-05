# 04. REST API 명세 (Django REST Framework, JSON)

- 기본 경로: `/api/`. 개발 중 Vite가 `/api` 를 `http://127.0.0.1:8001` 으로 프록시합니다 (8000은 다른 앱이 사용 중).
- 인증 없음(로컬 단일 사용자). CORS는 `http://localhost:5173` 만 허용.
- 언어: 서버 문구가 필요한 요청은 `?lang=ko|en` (기본 `ko`).
- 시간: ISO 8601, 서버 시간대 `Asia/Seoul`.

## 1. 공통 형식

### 결과 값
```json
{ "value": 1.0, "unit": "MW", "reason": null }
{ "value": null, "unit": "MW", "reason": { "ko": "승인된 계산 모델이 연동되지 않아 결과를 산출할 수 없습니다.", "en": "..." } }
```
`value` 가 `null` 이면 `reason` 은 반드시 있습니다. 결과는 저장된 뒤 언어를 바꿔 볼 수 있어야 하므로 사유·안내 문구는 `{ko, en}` 둘 다 담습니다 (Phase 3에서 변경).

### 결과 메타
```json
"meta": {
  "kind": "PERFORMANCE",
  "mode": "DEMO",
  "basis": "DEMO_FIXED",
  "model_version": "DEMO-SCENARIO-v1",
  "data_source": "가상 데모 시나리오 (실제 설비·운전 한계 아님)",
  "computed_at": "2026-10-18T14:00:00+09:00",
  "inputs": [ { "key": "hrsg_dp", "label": "HRSG 가스측 차압", "value": 3.3, "unit": "kPa" } ],
  "missing_inputs": []
}
```

### 오류
| 코드 | 언제 | 본문 |
|---|---|---|
| 400 | 입력 검증 실패 | `{"error": "입력값을 확인하세요.", "fields": {"smp": ["0 이상이어야 합니다."]}}` |
| 404 | 없는 케이스·항목 | `{"error": "평가 케이스를 찾을 수 없습니다."}` |
| 500 | 서버 오류 | `{"error": "서버 오류가 발생했습니다."}` (내부 상세·스택은 응답에 넣지 않음) |

## 2. 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health/` | `{"status": "ok", "database": "ok"}`. DB 접속 실패 시 503 `{"status": "error", "database": "error"}`. 프론트가 서버 연결 확인에 사용 |
| GET | `/api/cases/` | 케이스 목록 (최근 수정 순) |
| POST | `/api/cases/` | 생성 `{name, memo}` → 체크리스트 초안 복사, 빈 계산 입력 생성 |
| GET | `/api/cases/{id}/` | 케이스 상세 |
| PATCH | `/api/cases/{id}/` | 이름·메모 수정 |
| DELETE | `/api/cases/{id}/` | 케이스 삭제 `{"confirm_name": "케이스 이름"}` — 이름이 다르면 400. 관련 데이터 모두 삭제 (204) |
| GET | `/api/cases/{id}/overview/` | 평가 개요 (§3) |
| GET | `/api/cases/{id}/checklist/` | 항목 목록 + 진행률. 필터 `?status=MISSING&category=GT_INFO` |
| PATCH | `/api/cases/{id}/checklist/` | 일괄 수정 `{"items": [{"key": "...", "value": ..., "status": ...}]}` |
| GET | `/api/cases/{id}/checklist/request-text/?lang=ko` | 미수신 항목 요청문 `{"subject": "...", "body": "..."}` |
| GET | `/api/public/smp/` | 공개 SMP 실적 (KPX/EPSIS 확인값, 기준일) — Phase 6 |
| GET | `/api/public/sources/` | 참고한 공개 자료 목록 (인용·쪽·적용 한계, 파일 없음) — Phase 6 |
| GET | `/api/demo/scenarios/` | 시나리오 목록과 고정 입력값, 경제성 데모 예시값 (예시 결과는 포함하지 않음) |
| GET | `/api/cases/{id}/inputs/` | 저장된 계산 입력 (mode, scenario_id, operating_values, economics_assumptions, pinch_inputs, 항목 정의) |
| PUT | `/api/cases/{id}/inputs/` | **보낸 부분만** 저장. `mode=DEMO` 는 유효한 `scenario_id` 필요, `mode=REAL` 이면 `scenario_id` 는 null 로 저장. 오류 key: `operating_values` 항목은 그대로, 경제성은 `economics.A.cleaning_cost`, 핀치는 `pinch.drum_pressure` |
| POST | `/api/cases/{id}/evaluate/performance/` | 저장된 입력으로 성능 평가 실행 |
| POST | `/api/cases/{id}/evaluate/economics/` | 경제성 계산 실행 |
| POST | `/api/cases/{id}/evaluate/pinch-approach/` | 핀치·어프로치 실행 (현재 항상 산출 불가) |
| GET | `/api/cases/{id}/results/` | kind별 최신 결과 + 현재 입력과 다르면 `stale: true` |
| GET | `/api/qa/info/` | `{answer_type: "DEMO_TEMPLATE", llm_connected: false, suggestions: {ko, en}, about_result: {PERFORMANCE, ECONOMICS, PINCH_APPROACH}}` |
| GET | `/api/cases/{id}/questions/` | 질문 이력 (시간순) |
| POST | `/api/cases/{id}/questions/` | 질문 `{"question": "..."}` (1~500자) → 데모 답변 저장·반환 `{id, question, answer, lang, intent, answer_type, citations, cards, created_at}` |

프론트는 평가 실행 전에 `PUT /inputs/` 로 입력을 저장합니다(입력·결과 짝이 서버에서 일치하도록).

## 3. 응답 예시

### 체크리스트 GET
```json
{
  "source_label": "계획서 기반 초안",
  "progress": { "total": 30, "missing": 22, "received": 5, "verified": 3,
                "by_category": { "GT_INFO": { "total": 4, "received": 1, "verified": 1 } } },
  "items": [
    { "key": "hrsg_dp", "category": "FUEL_EXHAUST", "name": "HRSG 가스측 차압 (ΔP)",
      "value": null, "unit": "kPa", "condition": "", "measured_at": null, "memo": "",
      "status": "MISSING",
      "required_for": { "PERFORMANCE": true, "PINCH_APPROACH": false },
      "requirement_provisional": true }
  ]
}
```

### overview GET
```json
{
  "case": { "id": 1, "name": "케이스 1" },
  "readiness": { "total": 30, "missing": 22, "received": 5, "verified": 3 },
  "evaluations": [
    { "kind": "PERFORMANCE", "mode": "REAL", "available": false,
      "reason": "승인된 계산 모델 미연동", "required_ready": "4/17", "provisional": true },
    { "kind": "PERFORMANCE", "mode": "DEMO", "available": true, "reason": "가상 시나리오" },
    { "kind": "ECONOMICS", "available": false, "reason": "필수 가정값 누락: SMP, 운전 시간" },
    { "kind": "PINCH_APPROACH", "available": false,
      "reason": "검증된 물성 계산·기준값 없음", "required_ready": "0/3", "provisional": true }
  ],
  "next_actions": [ { "code": "REQUEST_MISSING", "text": "미수신 필수 항목 14개 — 요청문을 복사해 보내세요.", "link": "/data?status=MISSING" } ]
}
```

### 성능 평가 POST (DEMO-ALARM, 입력 그대로)
```json
{
  "result": {
    "status": { "value": "ALARM", "unit": null, "reason": null },
    "status_basis": "데모 시나리오에 지정된 상태입니다. 실제 판정 기준이 적용되지 않았습니다.",
    "performance_loss": { "value": 1.0, "unit": "MW", "reason": null },
    "cleaning_recovery": { "value": 0.8, "unit": "MW", "reason": null }
  },
  "meta": { "kind": "PERFORMANCE", "mode": "DEMO", "basis": "DEMO_FIXED", "scenario_id": "DEMO-ALARM", "...": "..." }
}
```

### 경제성 POST (데모 값)
```json
{
  "result": {
    "smp": { "value": 120, "unit": "원/kWh", "reason": null, "source": "DEMO" },
    "methods": [
      { "key": "A", "name": { "ko": "가상 공법 A", "en": "Virtual method A" },
        "inputs": { "recovered_mw": { "value": 1.5, "unit": "MW", "source": "DEMO" },
                    "operating_hours": { "value": 4000, "unit": "h", "source": "DEMO" },
                    "cleaning_cost": { "value": 300000000, "unit": "원", "source": "DEMO" },
                    "extra_cost": { "value": 50000000, "unit": "원", "source": "DEMO" },
                    "extra_cost_included": false },
        "extra_kwh": { "value": 6000000, "unit": "kWh", "reason": null },
        "revenue": { "value": 720000000, "unit": "원", "reason": null },
        "net_benefit": { "value": 370000000, "unit": "원", "reason": null } }
    ],
    "max_net_benefit_method": "A",
    "complete": true,
    "notice": { "ko": "일정한 회수 출력과 SMP를 가정한 단순 비교입니다. …", "en": "…" }
  },
  "meta": { "kind": "ECONOMICS", "basis": "USER_ASSUMPTION", "model_version": "USER-ASSUMPTION-CALC-v1",
            "computed_at": "…", "inputs": [ "…" ], "missing_inputs": [] },
  "stale": false
}
```

### 결과 GET
`{"PERFORMANCE": {result, meta, stale} | null, "ECONOMICS": … , "PINCH_APPROACH": …}` — `stale` 은 지금 입력과 결과의 입력 스냅샷이 다를 때 true.

## 4. 금지 사항
- 응답에 비공개 계산식, 모델 계수, 원문 문서 내용, 비밀값을 넣지 않습니다.
- 서버 로그에 요청 본문 전체나 비밀값을 남기지 않습니다(`DEBUG` 는 로컬 개발 시에만 True).
