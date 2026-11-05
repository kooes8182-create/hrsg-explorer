# HRSG Explorer — 통합 엔지니어링 웹앱 (로컬 데모)

복합화력 발전소 HRSG(배열회수보일러)의 운전 상태·성능 저하·세정 필요성·경제성을 분석하고, 논문 근거 검색과 AI 질의응답으로 검토를 돕는 웹앱입니다.

> ⚠️ **가상 데이터와 DEMO 계수로 동작하는 데모입니다. 실제 발전소 운전·안전 판단에 사용하지 마세요.**
> 실제 플랜트 데이터, 승인된 성능 모델, 가스터빈 운전 한계표는 연결되어 있지 않습니다.

| 문서 | 내용 |
|---|---|
| [docs/04_status_report.md](docs/04_status_report.md) | **기능별 구현 상태 보고서** (완료·테스트·일부·미구현·외부 자료 필요·발견된 오류·개선 권장) |
| [docs/03_api.md](docs/03_api.md) | API 명세 |
| [docs/02_architecture.md](docs/02_architecture.md) | 통합 설계 (Phase 1) |
| [docs/01_existing_analysis.md](docs/01_existing_analysis.md) | 기존 HRSG 앱 분석 (Phase 1) |
| [CLAUDE.md](CLAUDE.md) | 작업 규칙 (상위 HRSG 규칙 중 이 앱에서 덮어쓰는 항목) |

기존 HRSG 앱(`../frontend`, `../backend`, DB `hrsg_ref`, 포트 5173·8001)과 **별개**이며 동시에 켤 수 있습니다.

---

## 1. 전체 구조

```
브라우저 (localhost:5174)
  React + TypeScript + Vite + Tailwind · Zustand(케이스별 상태 캐시) · SVG 차트·공정도
        │  /api/*  (Vite 프록시)
        ▼
Django REST Framework (127.0.0.1:8002)
  cases/      케이스·체크리스트·입력값·결과·스냅샷·실측값·대시보드 집계·Excel
  engine/     공통 계산 엔진 (DEMO 공식 · 공개 문헌 참고 추정 · IAPWS-IF97 · 단위 변환) — 서버에서만 계산
  rag/        공식 corpus 검색(BM25 이식 + BGE-M3 + 가중 RRF) · Gemini 답변 · 마스킹 · 대화 · 평가 기록
  knowledge/  업로드 문헌 파이프라인 (PDF → 청크 → 임베딩 → 별도 인덱스)
        │
        ├─ PostgreSQL 16 (hrsg_explorer)
        ├─ ../hrsg_eval_set_v1 (공식 corpus·질문, 읽기 전용) · ../.cache/official (공식 벡터, 읽기 전용)
        └─ Google Gemini API (설정에서 '외부 AI 전송 허용'을 켰을 때만)
```

- 모든 업무 데이터의 원본은 서버 DB 입니다. 브라우저 저장소에는 언어·테마·표시 단위·마지막 케이스만 둡니다.
- 모든 값에 신뢰성 배지(DEMO·사용자 입력·실측·공개 문헌·산출 불가·재평가 필요 등)를 붙이고, 계산할 수 없는 값은 0 이 아니라 "—" + 사유로 보입니다.

## 2. 기술 스택

| 영역 | 사용 |
|---|---|
| 화면 | React 18.3.1, TypeScript 5.6, Vite 5.4, Tailwind 3.4, React Router 6.28, Zustand 5 |
| 서버 | Python 3.12, Django 6.1, Django REST Framework 3.18, PostgreSQL 16 |
| 검색·AI | sentence-transformers 6.2 + torch 2.14 (BGE-M3 rev 5617a9f6, 로컬), google-genai 2.34 (Gemini) |
| 문서 | PyMuPDF 2.0 (PDF 추출), openpyxl 3.1.5 (Excel) |
| 테스트 | Django test (82개), Chrome DevTools 프로토콜 화면 테스트 (T01~T18, 추가 설치 없음) |

Docker 는 쓰지 않습니다 (로컬 직접 실행 — 2026-11-03 결정). Cloudflare Workers AI·Vectorize 는 연결하지 않았습니다.

## 3. 디렉터리

```
explorer/
├── README.md · CLAUDE.md · .gitignore
├── docs/                      분석·설계·API·상태 보고서
├── data/                      rag/(재현 확인·dev 실험 기록) · kb/uploads/(업로드 원본, Git 제외)
├── backend/
│   ├── config/                settings(.env 사용), urls
│   ├── cases/                 models · services · overview · excel · checklist_registry · management/commands
│   ├── engine/                fields(입력 규격·시나리오) · demo_calc · pinch · iapws · reference_estimate · comparison · units · public_refs · glossary
│   ├── rag/                   official(검색) · answer(Gemini) · masking · template_qa · experiments · management/commands/rag_verify
│   ├── knowledge/             pdf_extract · pipeline · search · storage
│   └── system/                health · 공통 오류 형식
└── frontend/
    ├── src/app · pages(화면 13개 — 보고서·안내 포함) · components(charts·HrsgDiagram·ui…) · store · api · i18n · lib
    └── e2e/                   run.mjs (T01~T18) · browser.mjs
```

## 4. 설치 (처음 한 번)

필요: Python 3.12, Node 20, PostgreSQL 16 (Homebrew), Google Chrome (화면 테스트용).
BGE-M3 모델은 Hugging Face 캐시에 있어야 합니다 (기존 HRSG 앱에서 이미 받음 — 없으면 의미 검색이 꺼지고 BM25 로 대체).

```bash
createdb hrsg_explorer

cd explorer/backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                 # 아래 5절 참고

cd ../frontend
npm install
```

## 5. 환경변수 (`backend/.env`, Git 제외)

| 변수 | 값 |
|---|---|
| `DJANGO_SECRET_KEY` | `.venv/bin/python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"` 출력값 |
| `DJANGO_DEBUG` | `False` (문제를 찾을 때만 잠깐 `True`) |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` | `hrsg_explorer` / `whoami` 결과 / 비움 / `localhost` / `5432` |
| `GEMINI_API_KEY` | Google AI Studio 키 (비우면 근거 검색만) |
| `RAG_LLM_MODEL` | 비우면 `gemini-3.5-flash` |
| (선택) `RAG_OFFICIAL_CORPUS` · `RAG_OFFICIAL_QUESTIONS` · `RAG_OFFICIAL_VECTORS` · `RAG_EMBED_DEVICE` | 공식 자료 위치·임베딩 장치(mps/cpu). 비우면 HRSG 폴더 기본 위치 |

## 6. DB 초기화와 DEMO 데이터

```bash
cd explorer/backend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo_cases     # 가상 케이스 1개 ('오염 진행' 시나리오). 여러 번 실행해도 중복·덮어쓰기 없음
.venv/bin/python manage.py check_integrity     # 데이터 정합성 검사 (읽기 전용)
```

DEMO 케이스에는 실측값·체크리스트 수령 상태를 만들지 않습니다 (가상 값이 실측처럼 보이지 않도록).

## 7. 실행 (터미널 2개)

```bash
cd explorer/backend  && .venv/bin/python manage.py runserver 127.0.0.1:8002
cd explorer/frontend && npm run dev
```

브라우저 **http://localhost:5174** · 중지는 각 터미널에서 `Ctrl + C`.
메모리 8 GB 에서는 BGE-M3(약 2.3 GB)를 쓰는 검색을 기존 HRSG 앱과 동시에 쓰지 마세요.

### 3분 시연 순서
대시보드(작업 단계·KPI·공정도) → 시뮬레이션 [오염 진행]·[평가 실행] → 계산기(공법 비교·민감도·단계별 계산식) → [이 결과 질문하기] → AI 도우미(근거 문단·인용) → 체크리스트(누락 항목·요청 메일·Excel) → RAG 평가(재현 확인 100/100).

## 8. 계산 엔진 연결 방법 (실제 모델로 바꿀 때)

| 받을 것 | 바꿀 곳 |
|---|---|
| 승인된 성능 모델 | `backend/engine/demo_calc.py` 의 `evaluate_performance` — 지금은 사용자 입력 모드에서 '모델 미연동'. 모델을 서버 모듈로 추가하고 USER 분기에서 호출 (계수·식은 응답에 넣지 않음) |
| DEMO 계수 교체 | `demo_calc.py` 상단 `LOSS_COEF`·`OUTAGE_COEF`·`DAYS_PER_MONTH`·`SCORE_*` (화면의 'DEMO 계수' 목록에 자동 반영) |
| 입력 규격·기본값·허용 범위 | `engine/fields.py` 의 `FIELDS` (화면 입력칸·검증이 자동으로 따라감) |
| 운전 한계·판정 기준 | 지금은 시나리오에 '지정'된 상태만 표시. 기준을 받으면 `engine/` 에 판정 모듈을 추가 |
| 사내 데이터 요청 양식 | `cases/checklist_registry.py` 의 `ITEMS` (기존 케이스에는 빠진 항목만 추가됨) |
| 공개 문헌 계수·SMP | `engine/public_refs.py` (원문 재확인 후 `CHECKED_ON` 갱신) |

## 9. AI API 연결

1. `backend/.env` 에 `GEMINI_API_KEY` 입력 → 백엔드 재시작
2. 화면 **설정 → '외부 AI(Gemini) 전송 허용'** 켜기 (기본 꺼짐)
3. 보내는 것은 마스킹한 질문 + 검색된 문단 최대 8개(+ 업로드 문헌 최대 3개, 선택) + 첨부한 계산값뿐입니다. 전화번호·이메일·주민번호 형식과 설정에 등록한 식별정보(발전소명 등)는 보내기 전에 가립니다.
4. 키가 없거나 꺼져 있으면 답변을 만들지 않고 근거 문단만 보여 줍니다 (가짜 답변 없음).

## 10. 검색 성능 평가

```bash
cd explorer/backend
.venv/bin/python manage.py rag_verify          # 공식 100문항 BM25·결합·상위 8 순위가 측정 때와 같은지 (1~2분)
```

- 운영 검색 = `../tools/official_eval/locked_config.json` 확정 설정 (test Recall@8 **0.864** 를 측정한 설정). 재현 확인 **100/100 일치** (2026-11-03).
- dev 설정 비교는 화면 **RAG 검색 성능 평가 → dev 실행** (공식 채점 복사본 사용, test 는 다시 계산하지 않음).
  확정 설정 dev 전체 0.935·한국어 0.907 (저장 기록과 동일) / 프롬프트의 동일 가중 40/40: 0.879·0.827.
- 업로드 문헌은 별도 범위이며 정답 라벨이 없어 recall 이 측정되지 않습니다.

## 11. 테스트

```bash
cd explorer/backend  && .venv/bin/python manage.py test     # 서버 82개 (계산 엔진·API·Excel·파이프라인·검색 이식·마스킹)
cd explorer/frontend && npm run build                      # 타입 검사 + 빌드
cd explorer/frontend && npm run e2e                        # 화면 테스트 T01~T18 (두 서버를 켠 상태에서, 약 3분)
E2E_GEMINI=1 npm run e2e                                   # (선택) T14 에서 실제 Gemini 1회 호출
```

화면 테스트는 임시 케이스만 쓰고 끝나면 지우며, 바꾼 설정도 원래대로 돌립니다.

## 12. 알려진 제한사항

- **DEMO 계산**: 출력 손실·정지 손실·세정 필요도는 프롬프트의 DEMO 계수입니다. 프롬프트 기본값끼리 맞지 않습니다 (출력 손실 0.195 MW < 목표 회수 출력 2.1 MW → 화면에 '가정 확인' 경고).
- **운전 상태**는 시나리오에 지정된 가상 상태이며 임계값 판정이 아닙니다. 사용자 입력 모드는 '모델 미연동'.
- **고압수·화학 세정** 비용·정지일수 기본값이 없어 입력 전에는 '산출 불가'입니다. 월간 가동시간 720 h 는 DEMO 가정입니다.
- **미제공 자료**: 첨부 최종 구현 가이드(추천 질문 14개 문장, 데이터 인벤토리 35개), 팀원 앱 코드, 일부 실험 수치(0.813, 16→4, 39편·2,037청크) — 지어내지 않았습니다.
- **공공 SMP** 는 원문에서 확인한 실적값(2026-10-19)만 쓰며 실시간으로 받아오지 않습니다.
- **PDF**: 이미지뿐인 PDF 는 OCR 하지 않습니다. 보고서는 브라우저 인쇄('PDF로 저장')로 만듭니다.
- 로그인·권한·외부 배포·Docker·Cloudflare 연결은 범위 밖입니다.

자세한 목록: [docs/04_status_report.md](docs/04_status_report.md)
