# HRSG 레퍼런스 앱 (로컬 데모)

복합화력 발전소 HRSG의 운전 상태, 세정 필요성, 세정 공법별 경제성 검토를 돕는 **로컬 단일 사용자 데모**입니다.

> ⚠️ **가상 데이터를 쓰는 데모입니다.** 실제 플랜트 데이터, 승인된 계산 모델, 가스터빈 운전 한계표, 사내 데이터 요청 양식, LLM API 키는 연결되어 있지 않습니다.
> 실제 설비 판단에 사용하지 마세요. 미제공 자료 목록: [specs/09_missing_materials.md](specs/09_missing_materials.md)

| 메뉴 | 하는 일 |
|---|---|
| 평가 개요 | 데이터 준비 상태, 평가 가능 여부, 다음에 할 일 |
| 데이터 준비 | 플랜트 데이터 요청 체크리스트(계획서 기반 초안), 미수신 필터, 요청문 복사 |
| 성능·경제성 평가 | 한 줄 요약, 가상 시나리오(정상/경보/트립) 데모, 실제 평가(모델 미연동), **공개 문헌 기반 참고 추정**(차압 → GT 출력·열소비율 범위), 사용자 가정 경제성 비교 + **공개 SMP 실적**, HRSG 도식, **핀치·어프로치 참고 계산**(IAPWS-IF97), 근거 자료 목록, 압력 단위 전환(kPa·in H2O·mbar) |
| AI 질문하기 → 평가 케이스 질문 | 템플릿 기반 **데모 답변** (실제 AI 미연결). 체크리스트·저장 결과·계획서·공개 자료 범위에서만 답함 |
| AI 질문하기 → **논문 근거 질문** | 한국어·영어 질문 → 논문 문단 검색(BM25 + BGE-M3 + RRF) → 근거 문단(문헌명·쪽·DOI) 표시 → API 키가 있으면 Gemini 답변. §9 |

**공개 자료 (원문에서 직접 확인한 값만, 2026-10-19):** GE GER-3567H(배기 압력손실 영향), IST 2000(HRSG 경험값·핀치/어프로치), POWER 2015(세정 사례·세정 참고 기준), ASME PTC 4.4 공개 소개문, IAPWS-IF97(포화온도 식), 한국전력거래소 KPX·EPSIS(육지 SMP).
이 값들로 만든 결과는 모두 **"공개 문헌 참고 추정"**으로 표시하며, 이 설비의 성능 예측이나 승인 모델이 아닙니다. 근거와 계산 규칙: [specs/11_public_references.md](specs/11_public_references.md)

외부 배포는 하지 않습니다. 이 PC에서만 실행합니다.

---

## 1. 최초 설치와 데이터베이스 준비

필요한 프로그램 (macOS, 이 PC에서 확인한 버전)

| 프로그램 | 버전 | 확인 명령 |
|---|---|---|
| Python | 3.12 | `python3.12 --version` |
| Node.js / npm | 20.18 / 10.8 | `node -v` |
| PostgreSQL | 16 (Homebrew) | `pg_isready` → "접속을 받아드리는 중" |

PostgreSQL 이 꺼져 있으면 `brew services start postgresql@16` 로 켭니다.

```bash
# 프로젝트 폴더(HRSG)에서
createdb hrsg_ref                 # 이 앱 전용 DB (이미 있으면 "already exists" — 그대로 두면 됩니다)

cd backend
python3.12 -m venv .venv          # 가상환경 (처음 한 번)
.venv/bin/pip install -r requirements.txt

cd ../frontend
npm install                       # 화면 패키지 (처음 한 번)
```

> 같은 PostgreSQL 안의 다른 DB(예: `hr_system`)는 이 앱이 쓰지 않습니다.

## 2. 환경변수 설정

비밀값은 `backend/.env` 에만 둡니다. 이 파일은 Git에 올라가지 않습니다.

```bash
cd backend
cp .env.example .env
.venv/bin/python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"
# ↑ 출력된 값을 .env 의 DJANGO_SECRET_KEY= 뒤에 붙여 넣습니다.
```

| 변수 | 값 | 설명 |
|---|---|---|
| `DJANGO_SECRET_KEY` | 위 명령으로 만든 값 | 필수. 공유·커밋 금지 |
| `DJANGO_DEBUG` | `False` | 기본값. `True` 로 켜면 오류 화면에 내부 정보가 보일 수 있어 문제를 찾을 때만 잠깐 사용 |
| `DB_NAME` | `hrsg_ref` | |
| `DB_USER` | macOS 사용자 이름 (`whoami`) | Homebrew PostgreSQL 기본 사용자 |
| `DB_PASSWORD` | 비워 둠 | Homebrew 기본 설정은 로컬 접속에 비밀번호가 없음. 설정했다면 입력 |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | |
| `QA_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | `demo` / 비움 / 비움 | **현재 읽지 않음** (LLM 연결 코드 없음). §8 참고 |

## 3. 마이그레이션과 가상 데이터 생성

```bash
cd backend
.venv/bin/python manage.py migrate              # 표(테이블) 만들기 — 처음, 그리고 코드가 바뀐 뒤
.venv/bin/python manage.py seed_demo_cases      # 가상 케이스 3개 (선택)
```

- `seed_demo_cases` 는 다음 가상 케이스를 만듭니다.
  - **가상 케이스 C — 문헌 사례 수준 예시**: 모든 화면이 채워진 시연용 케이스. 차압은 공개 세정 사례 수준, SMP는 KPX 2025년 연평균(112.73 원/kWh), 결과·예시 질문까지 계산되어 있음
  - 가상 케이스 A — 데이터 일부 수신 / 가상 케이스 B — 신규
- **여러 번 실행해도** 케이스가 중복되지 않고, 사용자가 바꾼 이름·값을 덮어쓰지 않습니다. 체크리스트에 항목이 새로 추가된 경우 빠진 항목만 '미수신'으로 붙입니다.
- 값은 모두 가상 값입니다(가스터빈 모델명 `DEMO-GT`).

## 4. 프론트엔드와 백엔드 실행 (터미널 2개)

```bash
# 터미널 1 — 백엔드 (Django)
cd backend
.venv/bin/python manage.py runserver 127.0.0.1:8001

# 터미널 2 — 프론트엔드 (Vite)
cd frontend
npm run dev
```

- 둘 다 이 PC(`localhost`)에서만 열립니다. 화면의 `/api/...` 요청은 Vite 가 백엔드(8001)로 전달합니다.
- 백엔드 포트가 8000이 아니라 **8001**인 이유: 같은 PC의 다른 앱이 8000을 쓰고 있습니다.
- 확인: `curl http://localhost:5173/api/health/` → `{"status":"ok","database":"ok"}`

## 5. 실행 중지와 다음에 다시 켜는 방법

**중지**: 두 터미널에서 각각 `Ctrl + C`.
PostgreSQL 은 켜 둬도 됩니다. 끄려면 `brew services stop postgresql@16` (같은 PostgreSQL 을 쓰는 다른 앱도 멈춥니다).

**다시 켜기** (설치·마이그레이션은 다시 하지 않아도 됨)
1. `pg_isready` 로 PostgreSQL 확인 (꺼져 있으면 `brew services start postgresql@16`)
2. 터미널 1: `cd backend && .venv/bin/python manage.py runserver 127.0.0.1:8001`
3. 터미널 2: `cd frontend && npm run dev`
4. 코드가 바뀌었다면 2번 전에 `.venv/bin/python manage.py migrate`

"Error: That port is already in use" 가 나오면 이미 켜져 있는 것입니다. `lsof -nP -iTCP:8001 -sTCP:LISTEN` 으로 확인하세요.

## 6. 브라우저 접속 주소

**http://localhost:5173**

(백엔드 http://127.0.0.1:8001 은 화면이 아니라 API 입니다. 브라우저로 직접 열 필요가 없습니다.)

## 7. 3분 이내 시연 순서

**준비 (시연 전)**: `seed_demo_cases` 실행, 두 서버 실행, 브라우저에서 http://localhost:5173 열기, KO·라이트 모드, 케이스 **"가상 케이스 C — 문헌 사례 수준 예시"** 선택.
시나리오를 바꿔 보는 부분(0:55~)은 케이스 C의 값을 바꾸므로, 시연을 반복하려면 [+ 새 케이스]로 "시연용" 케이스를 만들어 그 부분만 거기서 해도 됩니다.

| 시간 | 화면 | 할 일 · 보여줄 것 |
|---|---|---|
| 0:00–0:20 | 평가 개요 | 상단 **DEMO 배지**, 수신 진행률, 평가 가능 여부(실제 평가는 **모델 미연동**), "다음에 할 일" |
| 0:20–0:45 | 데이터 준비 | **계획서 기반 초안** 배지와 **공개 자료 참고** 항목, [미수신] 필터 → [✉ 미수신 항목 요청문] 미리보기·복사 |
| 0:45–1:25 | 성능·경제성 평가 — 위쪽 | **한 줄 요약**(경보 · 차압 증가 0.90 kPa · GT 출력 손실 참고 범위 0.61–1.45 MW · 최대 순편익). 압력 단위를 **in H2O** 로 바꿔 3.6 in H2O(세정 참고 기준 3~4 in 안)를 보여줌. **문헌 참고 추정** 구역: GE~IST 범위 막대, "승인 모델 아님" 안내, 출처 칩 |
| 1:25–2:05 | 경제성 · SMP · 핀치 | 공법 A 326,380,000원 / B, **SMP 112.73 [공개 통계]** 와 2025~2026 월평균 그래프. 핀치·어프로치: IAPWS-IF97 포화온도 311.74 °C, 핀치 8.26 °C(문헌 범위 안 — 판정 아님). 맨 아래 **근거 자료** 6건(원문 인용·적용 한계) |
| 2:05–2:30 | 시나리오 전환 | [가상 정상] → [가상 경보] → [가상 트립] (상태·색·기호 즉시 변경). 차압을 바꾸면 결과가 **재평가 필요**로 가려짐 → [시나리오 값으로 되돌리기]. [실제 평가] → **모델 미연동, 판정 보류** |
| 2:30–3:00 | AI 질문하기 | 케이스 C의 예시 질문 3개(문헌 참고 추정·SMP 실적·경제성 입력) — 답변 수치 = 계산기 수치, 근거에 자료명·쪽·계산 시점. 상단 **"데모 답변 — 실제 AI 미연결"** |

마무리 멘트(예): "공개 문헌·통계에서 원문으로 확인한 값만 참고 추정으로 보여주고, 실제 설비 판단에는 승인된 모델·자료를 정해진 위치에 연결합니다(§8)."

## 8. 실제 데이터·계산 모델·요청 양식·LLM 연결 위치

| 받을 자료 | 연결 위치 | 바꾸는 방법 |
|---|---|---|
| 실제 플랜트 데이터 | 화면의 케이스 → 데이터 준비 / 운전 입력값 | 코드 변경 없음. 비식별 여부를 확인한 뒤 케이스에 입력 (일괄 가져오기 기능은 없음) |
| 사내 데이터 요청 양식 | `backend/core/checklist_seed.py` | `CHECKLIST_CATALOG` 에 항목 추가(`source="COMPANY_FORM"`), 필수 기준 확정 시 `REQUIREMENT_IS_PROVISIONAL=False`, 이어서 `seed_demo_cases` 실행 → 기존 케이스에 빠진 항목만 추가 |
| 비공개 성능 계산 모델 | `backend/calculators/performance.py` | `PerformanceModel` 을 구현하고 `evaluate_performance()` 의 실제 평가(REAL) 분기에서 `NotConnectedModel` 대신 사용. 서버에서만 실행, 응답·로그에 식 비노출 |
| 가스터빈 운전 한계표 | `backend/calculators/` (새 모듈) | 판정 로직은 성능 모델 안에서. 게이지 한계 구간은 서버 응답에 필드를 추가해 표시 |
| 핀치·어프로치 설계값·판정 기준 | `backend/calculators/pinch_approach.py` | 현재: IAPWS-IF97 포화온도 + 문헌 일반 범위(IST 2000)와 참고 비교. 이 설비 설계값·판정 기준을 받으면 비교 기준을 교체 |
| 공개 문헌 계수·SMP 값 갱신 | `backend/calculators/public_refs.py` | 출처(`SOURCES`), 계수, `SMP_MONTHLY`·`SMP_ANNUAL` 을 원문에서 다시 확인한 뒤 갱신하고 `CHECKED_ON` 날짜를 바꿈. 근거 기록은 specs/11 |
| 세정 공법 목록·비용 기준 | `backend/calculators/economics.py`, `demo_scenarios.py` | 공법 정의와 예시값 교체 (사용자 가정 입력은 유지) |
| LLM (API 키) | `backend/qa/service.py` 의 `get_provider()` + `backend/.env` | `qa/llm.py` 에 `LLMProvider` 구현 후 `QA_PROVIDER=llm`, `LLM_API_KEY`, `LLM_MODEL` 설정. 절차·검증: [specs/06_ai_qa.md §7](specs/06_ai_qa.md), [specs/10](specs/10_qa_acceptance_20.md) §5 |
| 협력사 기술 자료(비식별본) | `backend/qa/sources.py` | 현재는 계획서 요약만 근거로 사용. 추가 시 자료명·페이지를 함께 기록 |

---

## 9. 논문 근거 질문 (RAG 챗봇, 개인 프로토타입)

> ⚠ 검색 대상은 `reference/papers/` PDF 에서 직접 만든 **개인 프로토타입 코퍼스**입니다. 협업안의 공식 `corpus.json`(문헌 47건·약 1,800문단)·평가 질문 100개는
> 이 폴더에 없어서 쓰지 않았고, 협업안의 BM25 기준선 수치와 **직접 비교할 수 없습니다.** 명세: [specs/12_paper_rag.md](specs/12_paper_rag.md)

### 9.1 자료를 넣는 위치
| 자료 | 위치 | 비고 |
|---|---|---|
| 논문 PDF | `reference/papers/*.pdf` | Git 제외. 원본은 읽기만 함 |
| 참고문헌 엑셀 | `reference/HRSG_RAG_참고문헌_목록.xlsx` | 제목·DOI/URL 연결에만 사용 |
| 문헌별 사용 가능 여부 | `data/prototype/access_status.csv` | `open_license`·`free_access` 만 원문 사용, `paywalled` 원문 제외, `unknown` 제외. **`free_access` 판단은 발행처 유형 기준이라 확인이 필요합니다** (basis 열) |
| 유료 문헌 요약 노트 (선택) | `data/prototype/notes/<PDF 파일이름>.json` | `[{"pdf_page": 3, "printed_page": "196", "text": "직접 요약한 내용"}]` — 페이지를 적은 노트만 |
| 공식 협업 `corpus.json` (받으면) | 아직 연결 안 됨 | 형식을 확인한 뒤 `backend/rag/retrieval/corpus.py` 에 읽기 함수를 추가하고 `RAG_CORPUS_DIR` 로 지정 |
| 평가 질문 | `data/eval/eval_questions.csv` | 템플릿: `data/eval/eval_questions.template.csv`, 설명: [data/eval/README.md](data/eval/README.md) |

### 9.2 환경변수 (`backend/.env`)
| 변수 | 설명 |
|---|---|
| `GEMINI_API_KEY` | Gemini 답변 생성 키 (Google AI Studio). **비워 두면** 답변 대신 "답변 생성 API 설정 필요"를 표시하고, 검색·근거 확인은 그대로 됩니다 |
| `RAG_LLM_MODEL` | 비우면 `gemini-3.5-flash` (`gemini-2.5-flash` 는 새 사용자에게 열려 있지 않아 404) |

키 발급: https://aistudio.google.com/app/apikey · 사용 한도: https://ai.google.dev/gemini-api/docs/rate-limits
(키를 넣은 뒤 백엔드를 다시 켜야 적용됩니다. 혼잡할 때는 Gemini 가 503 을 돌려주며 화면에 '잠시 뒤 다시 시도' 로 표시됩니다.)

| `RAG_PAPERS_DIR`, `RAG_CORPUS_DIR`, `RAG_EVAL_FILE` | (선택) 자료 위치 변경 |
| `RAG_TERM_EXPANSION` | (선택) 한국어→영어 용어 목록 JSON — BM25 질의에만 덧붙임. 기본 사용 안 함 |
| `RAG_EMBED_DEVICE` | (선택) `mps` / `cpu`. 비우면 자동(Apple 칩은 mps) |

### 9.3 자료 처리와 임베딩 (처음 한 번, backend 폴더에서)
```bash
.venv/bin/pip install -r requirements.txt          # pymupdf, torch, sentence-transformers, google-genai 등
.venv/bin/python manage.py rag_build_corpus        # PDF → data/prototype/corpus.jsonl (약 15초), 제외·누락 보고
.venv/bin/python manage.py rag_build_embeddings    # 문단 5,113개 → 벡터 (이 PC M2·8GB, mps 에서 약 21분 — 2026-10-27 실측)
```
- `rag_build_embeddings` 는 처음 실행 때 Hugging Face 에서 `BAAI/bge-m3`(약 2.3GB)를 받아 둡니다.
- 메모리가 부족하면 `--batch-size 4`. 결과: `data/prototype/index/vectors.npy`, `meta.json`(코퍼스 해시·모델 리비전·잘린 문단 수).

### 9.4 웹앱 실행과 접속
§4 와 같습니다 (백엔드 8001, 프론트 5173). 브라우저에서 **http://localhost:5173/ask/papers**
- 개발용 검색 비교: **http://localhost:5173/dev/search** (메뉴에는 없고 질문 화면 아래 링크로 연결)
- 첫 검색 때 백엔드가 임베딩 모델을 불러오느라 1~2분 걸리고, 백엔드 메모리를 약 2.5GB 더 씁니다.

### 9.5 dev 평가 (평가 파일을 만든 뒤)
```bash
.venv/bin/python manage.py rag_eval     # dev: BM25 / 벡터 / 하이브리드, 한국어·영어별 Recall@8·MRR·시간, 실패 원인
.venv/bin/python manage.py rag_tune     # dev: 후보 30·40·50 × RRF 30·60·90 (최종 8·문헌당 2 고정)
.venv/bin/python manage.py rag_eval --bm25-k 40 --vector-k 50 --rrf-k 60 --lock    # 설정 확정
.venv/bin/python manage.py rag_eval --split test --confirm-test                   # test: 확정 후 한 번만
```

### 9.6 코퍼스가 바뀌었을 때
1. PDF 추가·교체, 또는 `access_status.csv`·요약 노트 수정
2. `rag_build_corpus` → `rag_build_embeddings` (코퍼스 해시가 같으면 임베딩을 건너뜀, 강제는 `--force`)
3. 백엔드 재시작. 벡터를 다시 만들지 않으면 화면에 "코퍼스가 벡터를 만든 뒤 바뀌었습니다"가 뜨고 BM25 결과만 나옵니다.

### 9.7 미구현·미검증
- 공식 협업 `corpus.json`·`research_index.json`·평가 질문 100개·기존 BM25·용어 목록: **미제공** → 공식 기준선과 비교 불가, 성능 수치 없음
- Gemini 실제 호출: 2026-11-03 샘플 질문 2개로 확인 (자동 테스트는 가짜 응답으로 인용 검증만 확인)
- Cloudflare Workers AI·Vectorize: 인터페이스 자리만 (미구현)
- 이미지로만 된 PDF 2개(Kim2002_KSMEB, JAKO200819463917983)와 일부 빈 페이지: OCR 하지 않아 코퍼스에 없음
- `free_access` 문헌의 실제 이용 조건: 발행처 유형으로 판단한 것으로, 사용자 확인 필요
- 문단 분할은 PDF 블록 기준이라 표·수식·참고문헌 목록 조각도 문단으로 들어가 있음 (참고문헌 목록 제외 처리 없음)
- 페이지 단위 정답 판정(근거 페이지 일치율)은 계산하지 않음 (문헌 단위만)
- 대화 이력은 저장하지 않음 (브라우저 창을 닫으면 사라짐)

---

## 10. 공식 검색 평가셋 v1 실험

공식 평가셋(`hrsg_eval_set_v1/`, Git 제외)으로 BM25 기준선 재현과 dev 가중 RRF 실험을 합니다. 실행 방법·파일 설명: [tools/official_eval/README.md](tools/official_eval/README.md),
결과: `data/official_eval/`. 규칙은 CLAUDE.md §9 (원본 수정 금지, dev 로만 조정, test 는 설정 확정 후 한 번, corpus 외부 API 전송 금지).

---

## 테스트

```bash
cd backend && .venv/bin/python manage.py test     # 서버 자동 테스트 (논문 RAG: manage.py test rag)
cd frontend && npm run build                     # 화면 빌드 확인
```

질문 20개 검수와 실제 LLM 정답률 검증 방법: [specs/10_qa_acceptance_20.md](specs/10_qa_acceptance_20.md)

## 폴더

| 폴더 | 내용 |
|---|---|
| `frontend/` | Vue 3 + Vite + Bootstrap 5 화면 |
| `backend/` | Django + Django REST Framework API, `calculators/`(계산), `qa/`(질문 답변) |
| `specs/` | 상세 명세 |
| `reference/` | 원문 PDF·논문(`papers/`)·참고문헌 엑셀 (Git 제외, 웹으로 제공하지 않음) |
| `data/prototype/` | 논문 RAG 프로토타입 코퍼스·벡터 (본문·벡터는 Git 제외, 명령으로 다시 생성) |
| `data/eval/` | 검색 평가 질문 템플릿과 실행 기록 |

## 비밀 정보
- `backend/.env` 에만 비밀 키·DB 비밀번호·API 키(`GEMINI_API_KEY`)를 둡니다. `.env` 는 Git에 올라가지 않습니다.
- `reference/` 의 원문 PDF는 Git에 올리지 않고, 앱이 정적 파일로 제공하지도 않습니다.
