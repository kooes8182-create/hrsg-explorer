# HRSG Explorer API 명세

- 기준 주소: `http://127.0.0.1:8002/api/` (화면에서는 `http://localhost:5174/api/` — Vite 프록시)
- 형식: JSON (파일 업로드만 `multipart/form-data`). 로그인·인증 없음 (로컬 단일 사용자 데모).
- 계산은 서버에서만 합니다. 화면이 보낸 결과 값은 받지 않고, 저장된 입력값으로 다시 계산합니다.

## 공통 규칙

**결과 값 형식** — 계산 결과의 숫자 하나는 이렇게 옵니다.

```json
{"value": 0.195, "unit": "MW", "reason": null, "rel": "DEMO"}
{"value": null,  "unit": "원", "reason": {"ko": "입력 필요: 세정 비용", "en": "Input required: cleaning cost"}}
```

`value` 가 `null` 이면 `reason`(한/영)이 반드시 있습니다. 입력 누락을 0 으로 바꾸지 않습니다.
`rel` (신뢰성): `DEMO` · `EXAMPLE` · `USER_INPUT` · `MEASURED` · `PUBLIC_REF` · `NEEDS_VERIFICATION` · `VERIFIED` · `UNCONFIRMED` · `MODEL_NOT_CONNECTED` · `UNAVAILABLE` · `REEVALUATION_REQUIRED`

**오류 형식**

```json
{"error": {"code": "VALIDATION_ERROR", "message": {"ko": "입력값을 확인하세요.", "en": "Check the input values."},
           "fields": {"loadFactor": {"ko": "허용 범위 30 ~ 105 % 를 벗어났습니다.", "en": "..."}}}}
```

| code | HTTP | 뜻 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 입력 검증 실패 (`fields` 에 항목별 사유) |
| `NOT_FOUND` | 404 | 없는 대상·주소 |
| `LAST_CASE` | 409 | 마지막 남은 케이스 삭제 시도 |
| `REEVALUATION_REQUIRED` | 409 | 현재 입력으로 계산한 결과 없이 스냅샷 저장 시도 |
| `DUPLICATE` · `BUSY` | 409 | 같은 PDF 재업로드 · 다른 처리 작업 진행 중 |
| `SEARCH_UNAVAILABLE` | 503 | 공식 corpus 를 읽지 못함 |
| `EXPERIMENT_FAILED` | 500 | dev 실험 실행 실패 |
| `SERVER_ERROR` | 500 | 처리하지 못한 오류 (상세는 서버 터미널에만) |

**재평가 필요(stale)** — 결과마다 계산 당시 입력 해시(`inputs_hash`)를 저장합니다. 현재 입력과 다르면 `stale: true` 이며, 화면은 그 값을 현재 결과로 보이지 않습니다.

---

## 시스템

| 방식·주소 | 설명 |
|---|---|
| `GET /health/` | `{status, server, database, search: {status, vector, reason}, ai: {status, key_configured, external_enabled, reason}, checked_at}`. DB 오류면 503. 화면은 30초마다 호출 |
| `GET /settings/` · `PATCH /settings/` | `{ai_external_enabled: bool, sensitive_terms: [str]}` 변경. 응답에 검색 설정(확정·실험) 포함 |

## 케이스

| 방식·주소 | 설명 |
|---|---|
| `GET /cases/` · `POST /cases/` | 목록 · 만들기 `{name, memo}` (입력값은 DEMO 기본값, 체크리스트 40개 생성) |
| `GET·PATCH·DELETE /cases/{id}/` | 조회·이름/메모 변경·삭제 (마지막 1개는 409) |
| `POST /cases/{id}/clone/` | 복제. 입력값·체크리스트·실측값 복사, 결과·스냅샷·대화는 복사 안 함 (`policy` 로 응답) |
| `GET /cases/{id}/overview/` | 대시보드 집계: `kpis[7]`(value·baseline·delta·changeRate·rel·previous), `status`, `panel`, `workflow[4]`, `recommendations`, `alerts`, `activity`, 공통 상태 키 `calc_summary_kpi`·`calc_economic_params`·`checklist_readiness`·`actual_performance_gap`. 계산하지 않음 (세정 전후 결과만 없으면 공통 엔진으로 갱신) |

## 입력값·계산

| 방식·주소 | 설명 |
|---|---|
| `GET /inputs/schema/` | 입력 규격 `fields[]`(key·label·unit·min·max·default·required), 시나리오 3종, 단위 변환표, DEMO 계수 |
| `GET·PUT /cases/{id}/inputs/` | `{mode: DEMO\|USER, scenario, values}`. 저장 시 전 항목 검증 (하나라도 틀리면 저장 안 함). 응답 `sources`(값별 DEMO/USER_INPUT), `hash`, `warnings` |
| `POST /cases/{id}/inputs/reset/` | `{scenario?: NORMAL\|ALARM\|TRIP}` — 기본값 또는 시나리오 값으로 |
| `POST /cases/{id}/evaluate/{kind}/` | `kind` = `performance` · `economics` · `pinch` · `reference` · `comparison` · `all`(앞 4개). 결과 저장 후 반환 |
| `GET /cases/{id}/results/` | `{results: {kind: {payload, computed_at, inputs_hash, stale}}, current_hash, last_calculated_at}` |
| `GET·POST /cases/{id}/snapshots/` | 목록 · 저장 `{label}` (현재 입력으로 계산한 결과가 있어야 함) |
| `GET /cases/{id}/snapshots/{sid}/` · `POST …/restore/` | 상세(입력·결과) · 입력값 불러오기 (스냅샷은 보존) |

계산 결과 주요 필드 — `performance`: status, currentBP, excessBP(+inH₂O), lossMW, lossWonMonth, cleaningScore, referenceBand, lossCurve, steps, warnings ·
`economics`: methods[3](cost·outageCost·initialCost·monthlyBenefit·paybackMonths·bepDays·firstMonthNet), shortestPayback, economicParams, sensitivity(smp·hours), steps ·
`pinch`: saturationTempC, pinch, approach, ranges(demo·ist2000), position, designDiff ·
`reference`: dp_increase, trigger_position, effects, recovery, sources ·
`comparison`: virtual·measured 시계열, kpi, deviation, actualPerformanceGap

## 체크리스트

| 방식·주소 | 설명 |
|---|---|
| `GET /cases/{id}/checklist/` | `items[40]`(정의 + state), `summary`(수령·검토·검증·필수 충족률, 분포), 범주, 상태 이름 |
| `PATCH /cases/{id}/checklist/` | `{updates: [{id, value?, unit?, location?, condition?, measured_at?, data_source?, supply_status?, verify_status?, document_confirmed?, reviewed?, memo?}]}` — 전부 또는 전무. 값 없는 검증 완료 차단 |
| `POST /cases/{id}/checklist/request-text/` | `{lang, format: markdown\|html, customer, plant, subject?, purpose?}` → '요청 필요' 항목만 넣은 메일 초안 (발송 없음) |
| `GET /cases/{id}/checklist/export/` · `GET /checklist/template/` | Excel 내보내기 · 표준 양식 (.xlsx) |
| `POST /cases/{id}/checklist/import/[?apply=1]` | multipart `file`(.xlsx ≤5 MB). 기본은 미리보기 `{rows[{id, changes, issues[{level, message}]}], counts}`. `apply=1` 이고 오류 0 일 때만 반영 |

## 세정 전후 실측값

| 방식·주소 | 설명 |
|---|---|
| `GET·POST /cases/{id}/measurements/` | `{dayOffset(정수, 음수=세정 전), backPressure, stackTempC?, loadFactor?(30~105), ambientTempC?, measuredOn?, memo?}` |
| `PATCH·DELETE /cases/{id}/measurements/{mid}/` | 수정·삭제 |

## 공개 자료

| 방식·주소 | 설명 |
|---|---|
| `GET /public/smp/` | KPX/EPSIS 육지 SMP 월별·연도별 실적 (원문 확인값, 확인일 포함) |
| `GET /public/sources/` | 공개 문헌 6건 (인용문·적용 한계·확인일) |
| `GET /glossary/` | 용어 12개, 자료 4분류 |

## 논문 근거 검색·AI

| 방식·주소 | 설명 |
|---|---|
| `GET /rag/info/` | 공식 corpus(47편·1,797문단), 벡터 상태, 검색 설정(확정·실험), AI 상태 |
| `POST /rag/search/` | `{question, mode: bm25\|dense\|hybrid, config: locked\|equal40}` → 상위 8 (참고문헌당 2). 의미 검색 불가 시 BM25 대체 + `fallback_reason` |
| `POST /rag/compare/` | `{question, config}` → 세 방식 결과·순위·원점수 |
| `GET·POST /cases/{id}/conversations/` · `GET·PATCH·DELETE /conversations/{cid}/` | 대화 목록(`?q=` 검색)·만들기·조회·제목 변경·삭제 |
| `POST /conversations/{cid}/messages/` | `{question, mode?, snapshot_id?, context?, include_uploads?}` → 마스킹 → 로컬 검색(확정 설정) → (허용 시) Gemini. 응답 `{user, assistant}`; assistant.payload: `evidence[]`(cited·scope), `generation{status: ok\|disabled\|not_configured\|no_passages\|refused\|error, text, citations, warnings}`, `snapshot`, `context`, `verification`. `context` 는 화면 이름만 받고 줄 목록은 서버가 DB 값으로 만듭니다 |
| `GET /cases/{id}/ai-context/?page=` | Floating AI 'AI에게 질문하기' 미리보기. page: dashboard·calculator·simulation·analysis·before-after·checklist → `{page, label, lines[], stale[]}`. 서버 저장값만, 재평가 필요한 결과는 빼고, 케이스 이름·자유 입력 문자열 미포함, 민감 식별정보 마스킹 |
| `POST /messages/{mid}/feedback/` | `{rating: up\|down, comment}` |
| `GET /rag/feedback/export/` | 피드백 → 평가셋 v2 후보 JSON |
| `GET·POST /rag/labels/` · `PATCH·DELETE /rag/labels/{id}/` | 정답 라벨 (공식 평가셋 파일은 수정 안 함) |
| `POST /cases/{id}/questions/` | 평가 케이스 질문 — 템플릿 DEMO 답변 (AI 아님) |
| `GET /rag/experiments/` · `POST /rag/experiments/run-dev/` | 공식 기록·재현 확인·dev 실행 결과 · `{config}` dev 재채점 (공식 채점 복사본) |

## 지식베이스

| 방식·주소 | 설명 |
|---|---|
| `GET /knowledge/papers/` · `GET /knowledge/chunks/?ref=` | 공식 corpus 문헌·문단 (읽기 전용) |
| `GET·POST /knowledge/uploads/` | 업로드 목록 · multipart `file`(PDF ≤30 MB) + `title?`·`authors?`(; 구분)·`year?`·`doi?` → 처리 작업 시작 |
| `GET·PATCH·DELETE /knowledge/uploads/{id}/` | 상세(마지막 작업 단계 포함)·메타데이터 수정·삭제 |
| `GET /knowledge/uploads/{id}/chunks/` · `POST …/reprocess/` · `POST …/reembed/` | 청크 · 재처리 · 재임베딩 |
| `GET /knowledge/jobs/` · `POST /knowledge/reindex/` | 작업 단계 상태 · 업로드 전체 재색인 |
| `POST /knowledge/upload-search/` | `{question}` → 업로드 범위 상위 8 (`measured: false`) |

원본 PDF 를 내려받는 주소는 없습니다.

## 알림 센터 (notifications)

| 엔드포인트 | 설명 |
|---|---|
| `GET /notifications/?case={id}` | 조회 전에 현재 상태로 맞춤(sync) → 케이스 알림 + 시스템 알림(case 없음). `{items[], unread, unresolved, live_plant_data:false}`. 항목: `id, caseId, kind(STATE\|EVENT), category(OPERATION\|DATA\|CALC\|SYSTEM), severity(CRITICAL\|WARNING\|INFO\|SUCCESS), title{ko,en}, message{ko,en}, source, isDemo, createdAt, readAt, resolvedAt, targetRoute, targetItemId, eventKey` |
| `POST /notifications/{id}/read/` | `{read: bool}` — 읽음만 바뀌고 해결(resolvedAt)은 그대로 |
| `POST /notifications/read-all/` | `{case}` — 그 케이스 + 시스템 알림 모두 읽음 |
| `POST /notifications/client-event/` | 브라우저가 감지한 사건 (문구는 서버가 만듦). `server_down\|db_error` + `since, until`(복구 뒤 1회, 같은 since 는 1건), `calc_failed` + `case, fields[]`(입력 항목 이름만 허용), `autosave_failed\|autosave_ok` + `case` |
| `GET /cases/{id}/ai-context/?page=&notification={nid}` | 알림 내용(서버 저장 문구)을 화면 데이터 앞에 덧붙임. 다른 케이스 알림이면 400. 질문 API 는 `notification_id` |

상태형 알림은 (케이스, eventKey) 마다 미해결 1건만 둡니다 — 생성 전 PostgreSQL advisory lock 으로 동시 조회 중복을 막습니다.
