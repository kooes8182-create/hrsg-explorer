# CLAUDE.md — HRSG 레퍼런스 앱 (로컬 데모 PoC)

복합화력 발전소 엔지니어가 **HRSG(배열회수보일러)의 운전 상태, 세정 필요성, 세정 공법별 경제성**을
검토하도록 돕는 웹앱입니다. 이번 목표는 **가상 데이터로 로컬에서 실행되는 단일 사용자 데모**입니다.

> 이 문서는 바이브 코딩 작업 헌장입니다. 모든 구현은 이 문서와 `specs/` 를 따릅니다.
> 문서와 코드가 다르면 **문서가 우선**이며, 문서를 바꿔야 할 때는 사용자에게 먼저 확인합니다.

> ⚠️ **상위 폴더의 CLAUDE.md는 이 프로젝트에 적용하지 않습니다.**
> 이 폴더는 `hr_system/` 안에 있어서 `~/CLAUDE.md`(SMP 예측 실습)와 `hr_system/CLAUDE.md`(인사평가 시스템)가
> 함께 읽힐 수 있습니다. 그 문서의 규칙·기능(Tabler, 로그인·관리자 계정, 팀 보너스, 4섹션 파이썬 스크립트 규칙 등)은
> **HRSG 앱과 무관**하며, 이 문서와 `specs/` 만 따릅니다.

---

## 1. 절대 규칙

1. **구현 전에 관련 명세를 먼저 읽습니다.** 작업과 관련된 `specs/*.md` 를 확인한 뒤 시작합니다.
2. **요청받은 Phase만 구현합니다.** 다음 Phase 작업을 미리 만들지 않습니다.
3. **요구되지 않은 기능은 추가하지 않습니다.** 특히 아래는 이번 범위에서 금지입니다.
   - 회원가입, 로그인, 사용자별 권한 관리
   - 실시간 센서 연동, 자동 제어
   - ~~외부 배포(Render 등)~~ → **2026-11-05 사용자 승인**: `explorer/` 앱만 Render 무료 플랜 + 비공개 GitHub 저장소로 배포 가능 (팀 1 키트 포함, 평가셋 원문·임베딩·PDF·`.env` 제외). 절차: `explorer/docs/07_render_deploy.md`
     → **2026-11-07 사용자 승인**: 공식 corpus.json 을 GitHub 이 아닌 **Render Secret Files** 로만 서버에 올려 배포판 AI 채팅에 사용 가능 (`RAG_OFFICIAL_CORPUS=/etc/secrets/corpus.json`). 임베딩(.cache)·PDF·질문 파일은 계속 제외. 배포판은 BM25 단독 검색(축소판)이며 Render 의 `ANTHROPIC_API_KEY` 는 사용자가 대시보드에 직접 입력
   - Docker
   - 수업 자료의 인사평가 예시 기능
4. **실제 모델과 데이터를 임의로 추정해 구현하지 않습니다.**
   - 비공개 성능 산정식, 오염도 지수, 가스터빈 운전 한계값, 핀치·어프로치 기준값을 만들어 넣지 않습니다.
   - 실제 제조사·발전소·고객사 이름을 쓰지 않습니다. 가상 모델명은 `DEMO-GT` 를 씁니다.
   - 제공되지 않은 자료를 확보한 것처럼 표현하지 않습니다. → [specs/09_missing_materials.md](specs/09_missing_materials.md)
5. **입력 누락을 0으로 처리하지 않습니다.** 산출하지 못한 결과는 `null` 과 **이유**를 함께 반환합니다.
6. **계산은 서버(Django)에서만 합니다.** 브라우저 코드에 계산식·비공개 로직·API 키를 넣지 않습니다.
7. **데모와 실제를 항상 구분합니다.** 데모 결과·사용자 가정 계산·산출 불가를 화면과 API 모두에서 표시합니다.
8. **기존 파일과 데이터베이스를 임의로 삭제하지 않습니다.** DB 초기화(drop)·파일 삭제가 필요하면 먼저 묻습니다.
9. **패키지 설치(pip, npm, brew)는 실행 전에 사용자에게 확인**받습니다.
10. **실행하지 못한 검증을 성공했다고 보고하지 않습니다.** 실행하지 않은 것은 "미실행"으로 적습니다.

## 2. 작업 보고 형식 (각 Phase 끝에 반드시)

```
### 변경 파일      — 생성/수정한 파일 목록
### 실행 명령      — 실제로 실행한 명령
### 검증 결과      — 실행한 테스트와 결과(통과/실패 수). 실행 못 한 항목은 '미실행'과 이유
### 미완료 항목    — 남은 일, 보류한 결정, 미제공 자료로 막힌 부분
```

---

## 3. 자료 현황 (2026-10-18 기준)

| 자료 | 위치 | 상태 |
|---|---|---|
| HRSG 레퍼런스 앱 계획서 (4쪽) | `reference/HRSG_레퍼런스앱_계획서.pdf` | 읽음. **서비스 기능의 기준** |
| 웹앱 개발 수업 자료 (28쪽) | `reference/웹앱 개발_수업자료.pdf` | 읽음. **기술 구성·개발 절차의 기준**. 목차의 "Ⅲ 배포" 슬라이드는 PDF에 없음 |
| 실제 플랜트 데이터, 사내 요청 양식 전체, 비공개 계산 모델, GT 운전 한계표, LLM API 키 | — | **미제공** |

- 원문 PDF는 Git에 올리지 않습니다(`.gitignore`). 앱 화면·답변·로그에 원문을 노출하지 않습니다.
- 계획서와 이번 요구사항이 다를 때의 처리 기준은 [specs/00_overview.md](specs/00_overview.md) §7 에 있습니다.

## 4. 기술 스택

```
Vue.js 3 SPA (frontend/)
   │  HTTP / JSON   (개발 중에는 Vite 프록시: /api → localhost:8001)
   ▼
Django REST Framework (backend/)
   │  Django ORM
   ▼
PostgreSQL 16 (로컬)
```

| 영역 | 기술 |
|---|---|
| Frontend | Vue.js 3, Vite, Vue Router, Axios, Bootstrap 5, HTML/CSS (차트·도식은 SVG 직접 작성) |
| Backend | Python 3, Django, Django REST Framework, Django ORM, python-dotenv |
| Database | PostgreSQL 16 (Homebrew 설치본) |
| 실행 | 로컬 직접 실행. Docker 미사용 |

버전 후보와 선택 이유: [specs/08_roadmap_phases.md](specs/08_roadmap_phases.md) §1

## 5. 폴더 구조

```
HRSG/
├── CLAUDE.md
├── .gitignore
├── reference/            # 원문 PDF (Git 제외)
├── specs/                # 상세 명세
├── backend/              # Django 프로젝트 (Phase 1에서 생성)
│   ├── config/           # settings, urls
│   ├── core/             # 모델, 시리얼라이저, 뷰
│   ├── calculators/      # 계산 모듈 (서버 전용)
│   ├── qa/               # 질문 답변 생성 모듈
│   ├── requirements.txt
│   └── .env.example
└── frontend/             # Vue 3 + Vite (Phase 1에서 생성)
```

## 6. 실행 명령

포트: 백엔드 **8001** (8000은 상위 폴더의 인사평가 앱이 사용 중), 프론트 **5173**. 둘 다 `localhost` 에서만 실행합니다.

```bash
# Backend
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # 값은 직접 입력 (비밀번호는 커밋 금지)
python manage.py migrate
python manage.py runserver 127.0.0.1:8001

# Frontend
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

## 7. 비밀 정보

- DB 비밀번호, API 키는 **`backend/.env` 환경변수**로만 관리합니다.
- `.env.example` 에는 변수 이름과 빈 값(또는 예시 자리표시자)만 둡니다.
- 로그·응답·브라우저 코드에 비밀값과 계산식을 남기지 않습니다.

## 8. 명세 문서

| 문서 | 내용 |
|---|---|
| [00_overview.md](specs/00_overview.md) | 목적, 범위, 메뉴 흐름, 용어, 업무 규칙, 계획서와의 차이 처리 |
| [01_features.md](specs/01_features.md) | 평가 케이스, 평가 개요, 데이터 준비 체크리스트 기능 |
| [02_ui_ux.md](specs/02_ui_ux.md) | 레이아웃, 테마, 언어, 시각화, 화면 상태 |
| [03_data_model.md](specs/03_data_model.md) | Django 모델, 체크리스트 초안 항목 |
| [04_api.md](specs/04_api.md) | REST API 엔드포인트와 응답 형식 |
| [05_calculation_and_demo_policy.md](specs/05_calculation_and_demo_policy.md) | 계산 경로, 데모 시나리오, 경제성 계산, 산출 불가 규칙 |
| [06_ai_qa.md](specs/06_ai_qa.md) | AI 질문하기 (데모 답변, 향후 LLM 연결 구조) |
| [07_acceptance_criteria.md](specs/07_acceptance_criteria.md) | 검수 기준과 테스트 질문 초안 |
| [08_roadmap_phases.md](specs/08_roadmap_phases.md) | Phase 1~5 작업 계획, 의존성 버전 |
| [09_missing_materials.md](specs/09_missing_materials.md) | 미제공 자료와 대체 처리 |
| [10_qa_acceptance_20.md](specs/10_qa_acceptance_20.md) | 질문 20개 검수 (데모 검증과 실제 LLM 정답률 검증 구분) |
| [11_public_references.md](specs/11_public_references.md) | 공개 자료 근거 (원문 확인한 문헌·표준·KPX SMP), 참고 추정·핀치 계산 규칙 |

---

## 9. 공식 검색 평가셋 v1 규칙 (`hrsg_eval_set_v1/`, 2026-10-29 추가)

출처: `hrsg_eval_set_v1/CLAUDE.md` (하위 폴더라 자동으로 읽히지 않아 여기에 옮김. 원문은 그대로 둠)

- `hrsg_eval_set_v1/App/tools/eval_questions.json`, `hrsg_eval_set_v1/App/web-server/data/corpus.json` 은 절대 수정하지 않는다.
- 채점은 `App/tools/eval_retrieval.mjs` 의 지표 정의(recall@8, hit@8, MRR, page@8)와
  `retrieve.js` 의 `cap()`(참고문헌당 최대 2개, k = 8)을 그대로 쓴다. 지표를 새로 구현하지 않는다.
- 모델 비교와 설정 조정은 split 이 "dev" 인 문항으로만 한다.
- "test" 점수는 최종 설정을 확정한 뒤 한 번만 계산한다. test 결과를 본 뒤에는 설정을 바꾸지 않는다.
- ~~corpus 텍스트를 외부 API(OpenAI 등)로 보내지 않는다. 로컬에서 실행하는 모델만 쓴다.~~
  → **2026-11-03 사용자 승인으로 변경**: 검색(임베딩·BM25)은 계속 로컬 모델만 쓴다.
  답변 생성 단계에 한해, 검색으로 찾은 문단(최종 8개 이내)을 외부 답변 AI 로 보낼 수 있다. corpus 전체를 보내지는 않는다. (예외: 2026-11-07 승인 — 배포용 Render Secret Files 업로드만 허용)
  → **2026-11-05 사용자 승인**: explorer 앱의 답변 AI 를 Gemini 에서 **Claude(Anthropic API)** 로 교체. 보내는 범위는 위와 같다.
- 시간이 오래 걸리는 계산 결과(예: 임베딩 벡터)는 `.cache/` 폴더에 저장하고 재사용한다.
  모델, corpus, 질문 파일 중 하나라도 바뀌면 다시 계산한다.

기존 규칙과의 관계 (삭제한 규칙 없음)
- **공식 점수**는 위 채점 스크립트로 계산한 값만 쓴다. `backend/rag/` 의 `rag_eval`·`rag_tune` 은 개인 프로토타입 코퍼스 전용이며 공식 점수와 비교하지 않는다.
- **외부 API 사용 (2026-11-03 변경)**: 논문 근거 질문 화면(specs/12)은 API 키가 있으면 검색 문단을 Gemini API 로 보내 답변을 만든다. 공식 corpus 를 챗봇에 연결하는 것도 사용자 승인을 받았으므로, 위 변경된 규칙(찾은 문단만 전송)을 지키면 된다.
- recall 값을 유지하려면 검색은 `tools/official_eval/locked_config.json` 의 확정 설정(BGE-M3 같은 revision, 벡터 0.7 / BM25 0.3, 후보 BM25 30·벡터 50, RRF k=60, 최종 8, 참고문헌당 2)과 `.cache/official/bge-m3/` 임베딩을 그대로 쓴다.
- 임베딩 캐시 위치: 공식 평가셋 실험은 `.cache/official/`, 개인 프로토타입은 기존 `data/prototype/index/` (둘을 섞지 않음).
