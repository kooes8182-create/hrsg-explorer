# Phase 1-A. 기존 프로젝트 분석 (2026-11-03)

조사 범위: `hr_system/HRSG/` 전체. 다른 팀원의 앱 코드와 "첨부된 최종 구현 가이드"는 이 PC에 없어 분석하지 못했습니다.
`hr_system/` 상위의 인사평가 앱(Vue + Tabler)은 HRSG와 무관하여 통합 대상에서 제외합니다.

## 1. 현재 존재하는 것

| 구분 | 위치 | 내용 |
|---|---|---|
| 화면 | `HRSG/frontend/` | Vue 3 + Bootstrap 5. 화면 13개, 컴포넌트 31개, 한/영 사전, 라이트/다크 |
| 서버 | `HRSG/backend/core` | 케이스·체크리스트·입력·결과·질문 API 14개 |
| 계산 | `HRSG/backend/calculators` | 성능(데모/미연동), 문헌 참고 추정, 경제성(A/B), 핀치(IAPWS-IF97), 공개 SMP·출처 |
| 케이스 질문 | `HRSG/backend/qa` | 의도 분류 + 템플릿 데모 답변 (LLM 없음) |
| 논문 검색 | `HRSG/backend/rag` | Python BM25 + BGE-M3 + RRF, Gemini 답변, 인용 번호·수치 검증 |
| 공식 평가 | `HRSG/tools/official_eval`, `.cache/official`, `data/official_eval` | 공식 평가셋 v1 실험·확정 설정·test 1회 결과 |
| DB | PostgreSQL 16 `hrsg_ref` | 모델 5개 (EvaluationCase, ChecklistItem, CalculationInput, CalculationResult, QuestionLog) |
| localStorage | 화면 | 언어·테마·현재 케이스 정도만. 업무 데이터는 이미 DB에 있음 → 마이그레이션 대상 없음 |

## 2. 공식 검색 성능 (recall 유지 대상) — 실제 파일에서 확인

- 설정: `tools/official_eval/locked_config.json`
  BGE-M3(rev `5617a9f6`), 가중 RRF wrrf-v1, 벡터 0.7 / BM25 0.3, 후보 BM25 30·벡터 50, RRF k 60, 최종 8, 참고문헌당 2
- 결과: `data/official_eval/test_locked_result.csv`

| 구분 | BM25 기준선 Recall@8 | 확정 설정 Recall@8 |
|---|---|---|
| test 전체 (30문항) | 0.699 | **0.864** |
| test 한국어 | 0.510 | 0.829 |
| 전체 dev+test (94문항) | 0.728 | 0.913 |

- **중요**: 이 값은 `backend/rag` 의 Python BM25가 아니라 **평가셋 원본 `retrieve.js` 의 BM25**(영문 토큰화 + 한국어 용어 확장 `KO_TERMS`)로 만든 후보 순위를 썼습니다.
  새 앱에서 같은 recall을 재현하려면 이 BM25를 그대로 옮기고, 100문항 전체에서 **순위가 같은지 검증**해야 합니다.
- 공식 corpus: `hrsg_eval_set_v1/App/web-server/data/corpus.json` — 참고문헌 47개, 문단 1,797개 (수정 금지)
- 임베딩: `.cache/official/bge-m3/passages.npy` + `passages_meta.json`

### 프롬프트의 수치 중 확인되지 않은 것

| 프롬프트 | 확인 결과 |
|---|---|
| BM25 기준선 all 0.728, 기존 test 0.699 | ✅ 위 파일과 일치 |
| 개선된 test 0.813 | ❌ 이 PC의 확정 결과는 0.864. 다른 실험(팀원)의 값으로 추정 |
| 한국어 실패 16 → 4개, 재현성 100/100 | ❌ 파일 없음 |
| 문헌 39편, 청크 2,037개 | ❌ 공식 47편·1,797개 / 프로토타입 5,113개 |
| 데이터 인벤토리 35개, 추천 질문 14개 문장 | ❌ 파일 없음 |

→ 출처 파일이 없는 수치는 화면에 넣지 않습니다(또는 "출처 파일 미제공"으로 표시).

## 3. 분류

### ① 그대로 재사용 (Python 서버 코드 → 새 백엔드로 복사)
- `calculators/iapws.py` (포화온도, 공식 검증값 테스트 포함)
- `calculators/public_refs.py` (문헌 6건 원문 인용, SMP 월별·연도별 실적)
- `calculators/reference_estimate.py` (차압 → 출력 손실 범위, GE~IST)
- `calculators/base.py` (값 + 단위 + 산출 불가 사유 형식)
- `rag/answer.py` (Gemini 호출, 인용 번호 검증, 근거에 없는 수치 검출)
- `rag/retrieval/embedder.py`, `vector_index.py` (BGE-M3 로컬 임베딩, 파일 일치 검사, Cloudflare 자리)
- `qa/` 템플릿 케이스 질문 (프롬프트 14-7 "기존 템플릿형 질문 유지")
- 기존 테스트 (phase2~5, reference, rag) — 옮긴 코드와 함께 이전

### ② 구조를 바꿔 통합
- **체크리스트**: 기존 33개(7범주) + 프롬프트 22개(A/B/C) → 하나의 항목 레지스트리 (총 40개, 겹치는 15개 통합). 겹치는 항목은 하나로 합치고 ID(A-01 등) 부여. 상태를 '수급 상태'와 '검증 상태' 두 칸으로 분리(기존 `VERIFIED` → 검증 완료로 변환)
- **시나리오**: 기존 정상/경보/트립(kPa 단위, 결과 고정) + 프롬프트 입력 규격(mmH₂O, F-Class 등) → 프리셋 하나로 통합, Custom 추가
- **경제성**: 기존 가상 공법 A/B → 드라이아이스/고압수/화학 세정 3공법 + 프롬프트 DEMO 공식(정지 손실, 회수기간, BEP)
- **핀치**: 기존(IST 2000 범위: 핀치 5.6~16.7 °C, 어프로치 약 13.9 °C) + 프롬프트 DEMO 범위(8~15 / 5~12 °C) → 두 기준을 출처와 함께 나란히 표시
- **논문 검색**: 기존 Python BM25 → 공식 `retrieve.js` BM25 이식(recall 재현용). 기존 BM25는 실험 비교용으로만
- **화면**: Vue 화면 13개 → React 화면 11개로 재작성 (같은 화면에 Vue·React 혼합하지 않음)

### ③ 신규 구현
- 대시보드 KPI 7개, 성능 추이, 다음 작업 추천
- 성능·경제성 계산기 (프롬프트 11-2 DEMO 공식, 세정 필요도 지수, 민감도 분석)
- 세정 전후 비교 (실측값 입력, 편차 경고, 누적 순편익)
- AI 도우미 3열 화면, 대화 목록·이력, 계산 스냅샷 첨부, 피드백
- 지식베이스 (PDF 업로드 → 추출 → 청킹 → 임베딩)
- 참고 자료·용어집, 설정 화면
- 케이스 복제, 마지막 케이스 삭제 차단
- Excel 가져오기/내보내기, PDF 보고서, 민감정보 마스킹
- DB 모델 13개 추가 (프롬프트 22절)

### ④ 중복이라 제거
- 기존 "개요"와 "자료 준비" 화면 안의 중복 진행률 표시 → 대시보드 데이터 준비도 하나로
- 기존 분석 › 경제성 탭과 새 계산기의 경제성 → 서버 계산 엔진 하나, 화면은 계산기(입력·계산) / 심층 분석(해석)으로 역할 분리
- 기존 lab › 질문별 비교와 지식베이스 › 검색 비교 → 같은 API 하나

### ⑤ 외부 자료·모델이 필요 (없으면 "미제공/미연동" 표시)
- 실제 플랜트 데이터, 승인된 성능 모델, GT 운전 한계표, 사내 요청 양식
- 팀원 앱 코드, 첨부 최종 구현 가이드(추천 질문 14개 문장, 데이터 인벤토리 35개)
- Gemini API 키 (있으면 답변, 없으면 근거 검색만)
- Cloudflare 계정 (인터페이스만, 기본 꺼짐)

## 4. 이 PC 환경 (확인만, 설치 안 함)

| 항목 | 상태 |
|---|---|
| Node 20.18 / npm 10.8 | 있음 |
| Python 3.12.4 | 있음 |
| PostgreSQL 16.15 | 있음, 실행 중 |
| BGE-M3 모델 파일 | 있음 (Hugging Face 캐시) |
| HRSG 가상환경의 torch, sentence-transformers, google-genai, Django, DRF | 있음 |
| Docker | **없음** |
| 메모리 | **8 GB** — BGE-M3(약 2.3 GB)를 HRSG 앱과 새 앱이 동시에 올리면 부족할 수 있음 |
