# Phase 1-B. HRSG Explorer 통합 아키텍처 (초안, 2026-11-03)

확정된 결정 (사용자 답변)
- 위치 `HRSG/explorer/` — 기존 HRSG 앱(`HRSG/frontend`, `HRSG/backend`, DB `hrsg_ref`)은 수정하지 않음
- 포트: 프론트 **5174**, 백엔드 **8002** (기존 5173/8001과 동시 실행 가능)
- 검색: **확정 설정(locked_config) = 운영 기본값**, 프롬프트의 40/40 동일 가중 RRF = 실험용 재현 설정
- 진행: Phase별 구현·검증·보고

## 1. 전체 구조

```
explorer/
├── docs/                 # 분석·설계·보고
├── backend/              # Django + DRF (127.0.0.1:8002)
│   ├── config/           # settings, urls (.env 로 비밀값)
│   ├── cases/            # 케이스 CRUD·복제, 체크리스트, 입력값, 스냅샷, 세정 전후 실측
│   ├── engine/           # 공통 계산 엔진 (서버 전용, 화면에는 결과·공식 설명만)
│   │   ├── units.py      #   단위 변환 (1 mmH₂O = 0.00980665 kPa)
│   │   ├── demo_calc.py  #   프롬프트 11-2 DEMO 공식 (계수 0.0013 / 0.15 = DEMO 표시)
│   │   ├── cleaning_score.py
│   │   ├── reference_estimate.py, iapws.py, pinch.py, public_refs.py   # HRSG에서 이전
│   │   └── comparison.py #   세정 전후 비교·편차 가드레일
│   ├── rag/              # 공식 corpus 검색 (BM25 이식 + BGE-M3 + wrrf), Gemini 답변, 마스킹
│   ├── knowledge/        # 문헌·청크 관리, PDF 업로드 파이프라인
│   ├── assistant/        # 대화·메시지·피드백, 템플릿 케이스 질문(HRSG qa 이전)
│   └── system/           # health, 설정
└── frontend/             # React + TypeScript + Vite + Tailwind (localhost:5174)
    └── src/
        ├── app/          # 라우터, 레이아웃(사이드바·헤더), 테마, i18n
        ├── store/        # Zustand — 케이스별 상태 (서버 응답의 캐시일 뿐, 원본은 DB)
        ├── api/          # 타입이 있는 API 클라이언트 + 응답 검증
        ├── components/   # ReliabilityBadge, KpiCard, Gauge, LineChart, BarChart, HrsgDiagram …
        └── pages/        # 11개 화면
```

DB: 새 PostgreSQL DB **`hrsg_explorer`** (기존 `hrsg_ref`는 읽지도 쓰지도 않음)

## 2. 데이터 원칙

- **서버 DB가 원본**. 화면 상태(Zustand)는 케이스 ID별 캐시이며, 저장은 항상 API를 거칩니다.
- localStorage: 언어, 테마, 사이드바 접힘, 작성 중 임시 복구만.
- **단위**: 입력 규격의 단위로 저장합니다(배압 mmH₂O, 드럼 압력 bar, 온도 °C). 화면 단위 전환은 표시만 바꾸고 저장값은 바꾸지 않습니다.
- **계산 결과 유효성**: 모든 결과에 `inputs_hash` 를 저장합니다. 현재 입력의 해시와 다르면 → `재평가 필요` (이전 결과는 삭제하지 않고 흐리게 표시).
- 산출할 수 없으면 `{"value": null, "reason": {...}}` — 0으로 바꾸지 않습니다.
- 모든 값에 **신뢰성 구분**(`reliability`)을 붙입니다:
  `DEMO, EXAMPLE, USER_INPUT, MEASURED, PUBLIC_REF, NEEDS_VERIFICATION, VERIFIED, UNCONFIRMED, MODEL_NOT_CONNECTED, UNAVAILABLE, REEVALUATION_REQUIRED`
  → 화면의 `ReliabilityBadge` 하나가 이 값을 그립니다.

## 3. 화면 간 연동 (프롬프트 6절 상태 키 → API)

| 상태 키 | 만드는 곳 (서버) | 쓰는 화면 |
|---|---|---|
| `calc_summary_kpi` | `GET /api/cases/{id}/overview/` 안의 최신 유효 계산 결과 | 대시보드, 공정도 |
| `calc_economic_params` | 계산기 경제성 결과 스냅샷 | 세정 전후 |
| `ai_context_snapshot` | `POST /snapshots/` 로 저장된 스냅샷 ID | AI 도우미 (ID로 서버에서 다시 읽음 → LLM이 수치를 바꿀 수 없음) |
| `checklist_readiness` | 체크리스트 집계 | 대시보드 |
| `navigate_to_item` | 화면 라우팅 (`/checklist?item=A-01`) | 체크리스트 |
| `actual_performance_gap` | 세정 전후 실측값이 있을 때만 | 대시보드 |

대시보드·심층 분석은 **계산하지 않고** 저장된 결과만 읽습니다. 계산은 `POST /evaluate/{kind}/` 한 곳.

## 4. 계산 엔진 구성

| 계산 | 근거 | 신뢰성 표시 |
|---|---|---|
| 초과 배압, LossMW(×0.0013), LossWon, OutageCost(×0.15), InitialCost, 월간 편익, 회수기간, BEP(월 30일), 첫 달 순편익 | 사용자 프롬프트 11-2 | DEMO (계수 = DEMO 가정) |
| 세정 필요도 지수 | 프롬프트 11-3 | DEMO 휴리스틱. 기준 스택 온도 없으면 산출 보류 |
| 차압 → 출력 손실·열소비율 범위 | GE GER-3567H, IST 2000 (기존) | 공개 문헌 참고 |
| 포화온도, 핀치·어프로치 | IAPWS-IF97 (기존) | 표준식 / 범위 비교는 DEMO 범위 + IST 범위 병기 |
| 운전 상태(정상/주의/위험) | 시나리오에 **지정** (임계값 판정 아님) | DEMO. 사용자 입력 모드 → 모델 미연동 |
| 세정 전후 편차 경고 (부하 5%p, 외기 5 °C) | 프롬프트 13-4 | DEMO 가드레일 |

T07 검증값: 150 MW, 100 %, 초과 배압 100 mmH₂O → LossMW = 0.195

## 5. 검색 (recall 유지 설계)

```
질문 ─► 민감정보 마스킹 ─► [로컬] BM25 (retrieve.js 이식, KO_TERMS 확장) 상위 30
                         └► [로컬] BGE-M3 질문 임베딩 → 공식 passages.npy 코사인 상위 50
                         ─► wrrf-v1 결합 (0.7 / 0.3, k=60) ─► 참고문헌당 2개 ─► 상위 8
                         ─► (키 있으면) Gemini: 이 8개 문단만 전송 ─► 인용·수치 검증
```

재현 검증 (Phase 5 완료 조건)
1. 이식한 BM25 순위 = `.cache/official/test_locked/bm25_candidates.all.json` (100문항 전부 일치)
2. 결합 순위 = `.cache/official/test_locked/locked.ranking.json` (100문항 전부 일치)
3. 공식 채점 스크립트로 계산한 Recall@8 = 0.913 (전체), test 0.864 — test는 **다시 채점하지 않고** 저장된 결과만 표시. 일치 확인은 ranking 비교로 함
- 실험 설정(40/40, 동일 가중)은 RAG 평가 화면에서 dev 문항으로만 재현
- 지식베이스에 새 PDF를 올리면 **공식 corpus와 다른 별도 범위**로 색인합니다. 공식 범위 검색 결과(=recall 측정 범위)와 섞을 때는 "측정되지 않은 검색 범위" 표시

## 6. API (프롬프트 23절 그대로, 추가분)

- `POST /api/cases/{id}/clone/` (입력값·체크리스트 복제, 스냅샷·대화는 복제하지 않음)
- `GET/POST/PATCH/DELETE /api/cases/{id}/measurements/` (세정 전후 실측)
- `GET/POST/DELETE /api/conversations/`, `/api/conversations/{id}/messages/`
- `GET /api/glossary/`

공통 오류 형식: `{"error": {"code": "...", "message": {"ko": "...", "en": "..."}, "fields": {...}}}`

## 7. Phase 계획 (각 Phase 끝에 실행 가능 상태 + 보고)

| Phase | 내용 | 완료 확인 |
|---|---|---|
| 2 | 프로젝트 생성, DB, 레이아웃, 테마·언어, 케이스 CRUD·복제, health, 공통 배지 | T01·T02·T03·T17·T18 |
| 3 | 체크리스트, 시뮬레이션, 계산 엔진, 계산기, 심층 분석, 세정 전후, 스냅샷 | T04·T06~T12, 계산 단위 테스트 |
| 4 | 대시보드 (KPI, 공정도, 추이, 준비도, 다음 작업) | T04·T05 |
| 5 | 검색 이식·재현 검증, AI 도우미, 지식베이스, RAG 평가 화면 | T13·T14, 순위 100/100 일치 |
| 6 | Excel, PDF 보고서, 마스킹, 피드백, 문헌 갱신 파이프라인 | T15 |
| 7 | 디자인 고도화, 반응형 | 화면 점검 |
| 8 | 통합·E2E 테스트, README, API 명세, 구현 상태 보고서 | T16 전체 흐름 |
