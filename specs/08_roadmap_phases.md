# 08. 개발 단계 (Phase 1~5)

수업 자료의 진행 방식을 따릅니다: **명세 작성 → Plan 모드로 계획 검토 → Phase별 실행 → 보고 → 다음 Phase.**

> 진행 현황 (2026-10-19): Phase 1~5 구현 완료, 로컬 실행·시연 준비까지. 외부 배포는 범위 밖.
> 미검증으로 남은 것: 실제 LLM 정답률(LLM 미연결), 실제 검증 사례 비교(자료 미제공), 사람이 직접 보는 브라우저 확인, 새 PC에서의 최초 설치 절차.
사용자가 요청한 Phase만 구현합니다. 각 Phase는 CLAUDE.md §2 형식으로 보고합니다.

## 1. 환경과 의존성 버전 후보

2026-10-18 이 PC에서 확인한 환경 (읽기 전용 확인):

| 도구 | 버전 | 비고 |
|---|---|---|
| python3 (시스템) | 3.14.7 | |
| 기존 venv Python | 3.12.2 | 상위 폴더의 다른 프로젝트 venv. 이 프로젝트에서 공유하지 않음 |
| Node.js / npm | 20.18.0 / 10.8.2 | **Vite 7 이상은 Node 20.19 이상 필요 → 사용 불가** |
| PostgreSQL | 16.15 (Homebrew) | |

후보 버전 (Phase 1에서 의존성 파일에 고정하고 설치로 확인):

| 패키지 | 후보 | 근거 |
|---|---|---|
| Django | 6.1.1 | 이 PC의 Python 3.12 venv에서 동작 중 |
| djangorestframework | 3.18.1 | 위와 같음 |
| django-cors-headers | 4.9.0 | 위와 같음 |
| psycopg2-binary | 2.9.13 | 위와 같음 |
| python-dotenv | Phase 1 설치 시 확정 | `.env` 읽기 |
| vue | 3.5.x | 이 PC에 3.5.43 설치 이력 |
| vite | 5.4.x | Node 20.18 호환, 이 PC에 5.4.21 설치 이력 |
| @vitejs/plugin-vue | 5.x | Vite 5 대응 버전 |
| vue-router | 4.x | Vue 3 대응 |
| axios | 1.x | |
| bootstrap | 5.3.x | `data-bs-theme` 다크 모드 지원 |

- 새 가상환경은 **Python 3.12** (`/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12`, 3.12.4) 로 `backend/.venv` 에 만듭니다.
- 데이터베이스는 새 DB **`hrsg_ref`** 를 사용합니다. 같은 PostgreSQL의 기존 `hr_system` DB는 사용·변경하지 않습니다.
- 포트: 백엔드 **8001**, 프론트 5173 (8000은 상위 폴더 인사평가 앱이 사용 중). 모두 `localhost` 에서만 실행.
- 설치 명령은 실행 전 사용자 확인을 받습니다.

---

## Phase 1 — 프로젝트 구성, 개발 환경, 서버 연결, 기본 화면

1. **목표**: 백엔드·프론트엔드 뼈대를 만들고 PostgreSQL, Vite 프록시 연결을 확인
2. **기능**: `/api/health/`, 사이드바 4개 메뉴 + 빈 본문, 상단 바(케이스 선택기 자리, 모드 배지, KO/EN, 라이트/다크), 서버 연결 실패 안내
3. **생성 파일**: `backend/`(config, core 앱, requirements.txt, .env.example, manage.py), `frontend/`(package.json, vite.config.js, src/main.js, App.vue, router.js, store.js, api.js, i18n, layouts/AppLayout.vue, views 4개 빈 화면), 기본 `README.md`
4. **수정 파일**: `CLAUDE.md`(확정 버전 기록), `.gitignore`(필요 시)
5. **명령**: `python3.12 -m venv .venv`, `pip install -r requirements.txt`, `createdb hrsg_ref`(사용자 확인 후), `python manage.py migrate`, `python manage.py runserver 127.0.0.1:8001`, `npm install`, `npm run dev`, `npm run build`
6. **검증**: `python manage.py check`, migrate 성공, `curl localhost:8001/api/health/`, Vite 경유 `/api/health/` 응답, `npm run build` 성공, 백엔드 중지 시 화면 안내 표시
7. **완료 조건**: 두 서버가 뜨고 화면에서 health 연결 상태가 보이며 `.env` 가 Git에 잡히지 않음

## Phase 2 — 평가 케이스 저장과 데이터 체크리스트

1. **목표**: 케이스 단위 저장과 체크리스트(계획서 기반 초안) 완성
2. **기능**: 케이스 생성·선택·수정, 체크리스트 30개 항목 편집, 상태(미수신/수신/검증 완료) 수동 변경, 필터, 진행률, 평가 기능별 필수 표시(임시 기준), 요청문 생성·복사, 평가 개요 화면(준비 상태·평가 가능 여부·다음 할 일)
3. **생성 파일**: `core/models.py`(EvaluationCase, ChecklistItem, CalculationInput), `core/checklist_seed.py`, serializers, views, `frontend` 의 OverviewView·DataView·케이스 상태 저장(store)
4. **수정 파일**: `core/urls.py`, AppLayout(케이스 선택기)
5. **명령**: `makemigrations`, `migrate`, `python manage.py test core`
6. **검증**: 07 R1~R4 자동 테스트, 화면 이동·새로고침 후 값 유지(R9 일부) 수동 확인
7. **완료 조건**: 새로고침 후 체크리스트 값·상태 복원, 요청문 복사 동작

## Phase 3 — 데모 계산기, 가정 기반 경제성 계산, 시각화

1. **목표**: 05 정책대로 서버 계산 모듈과 결과 화면 구현
2. **기능**: DEMO 시나리오 3개, REAL 경로(산출 불가), 입력 변경 시 재평가 필요, 경제성 계산, 핀치·어프로치 산출 불가, 결과 저장(CalculationResult), 게이지·HRSG 도식·공법 비교 막대, 계산 정보 영역
3. **생성 파일**: `backend/calculators/*`, `frontend/src/components/`(StatusCard, Gauge.vue, HrsgDiagram.vue, CompareBars.vue, ResultValue.vue), EvaluateView
4. **수정 파일**: `core/models.py`(CalculationResult), urls, overview(평가 가능 여부 반영)
5. **명령**: `makemigrations`, `migrate`, `python manage.py test`
6. **검증**: 07 §1 #1~#3, R5~R8 자동 테스트, 시나리오 전환 화면 수동 확인
7. **완료 조건**: 같은 입력 반복 시 결과 동일, 입력 수정 즉시 재평가 필요 표시, 시계열 그래프 없음

## Phase 4 — AI 질문 화면과 데모 답변, 향후 LLM 연결 구조

1. **목표**: 06 명세의 템플릿 기반 데모 답변과 교체 가능한 Provider 구조
2. **기능**: 질문·이력 저장, 의도 분류, 언어 감지, 결과 기반 수치 인용, 부족 데이터 안내, 민감 질문 거절, 예시 질문
3. **생성 파일**: `backend/qa/*`, `core/models.py`(QuestionLog), AskView
4. **수정 파일**: urls (`.env.example` 의 `LLM_API_KEY=` 빈 자리는 Phase 1에서 이미 둠)
5. **명령**: `makemigrations`, `migrate`, `python manage.py test`
6. **검증**: 07 §1 #4~#6 자동 테스트(질문 20개, 숫자 근거 검사)
7. **완료 조건**: API 키 없이 전체 앱 동작, 근거 없는 숫자 0건

## Phase 5 — 통합 검증, 반응형 개선, 실행 문서

1. **목표**: 전체 흐름 점검과 실행 안내 문서 작성
2. **기능**: 반응형·다크 모드 보정, 빈/로딩/오류 상태 점검, README 작성(설치·실행·종료·DB 생성 방법, 데모 한계, 미제공 자료)
3. **생성 파일**: `README.md`
4. **수정 파일**: 발견된 문제가 있는 화면·API
5. **명령**: `python manage.py test`, `npm run build`, 07 R11·R12 `grep`/`git status`
6. **검증**: 07 전체 표. 수동 항목(#7, #8, R9, R10, R13)은 확인 결과를 표로 보고
7. **완료 조건**: 자동 테스트 전부 통과, 수동 항목 확인 결과 보고(못 한 항목은 미실행으로 표기)

---

## 가장 먼저 할 일
Phase 1의 백엔드 뼈대 생성과 PostgreSQL 연결 확인 (DB 생성은 사용자 확인 후).
