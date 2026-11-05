# CLAUDE.md — HRSG Explorer (통합 엔지니어링 웹앱, 로컬 데모)

`HRSG/explorer/` 안의 새 앱 작업 헌장입니다. 상위 `HRSG/CLAUDE.md` 규칙을 그대로 따르되, **아래 항목만 이 앱에서 덮어씁니다** (2026-11-03 사용자 승인).
`~/CLAUDE.md`(SMP 예측 실습)와 `hr_system/CLAUDE.md`(인사평가)는 이 앱과 무관합니다.

설계 문서: [docs/01_existing_analysis.md](docs/01_existing_analysis.md), [docs/02_architecture.md](docs/02_architecture.md)

## 1. 상위 규칙을 덮어쓰는 항목

| 항목 | HRSG 앱 | 이 앱 |
|---|---|---|
| 프론트엔드 | Vue 3 + Bootstrap | **React + TypeScript + Vite + TailwindCSS + React Router + Zustand** |
| 포트 | 5173 / 8001 | **5174 / 8002** (`localhost`·`127.0.0.1` 전용) |
| DB | `hrsg_ref` | **`hrsg_explorer`** (`hrsg_ref` 는 읽지도 쓰지도 않음) |
| 계산식 | 비공개 식·기준값을 만들어 넣지 않음 | 사용자가 제공한 **DEMO 공식**(LossMW 계수 0.0013, 정지 손실 계수 0.15, 세정 필요도 지수, 핀치 8~15 °C·어프로치 5~12 °C 참고 범위, 세정 전후 편차 5%p·5 °C)은 사용. 화면·API에 항상 **"DEMO 계수/DEMO 가정"** 표시 |
| 계산기·체크리스트 키트 (2026-11-05) | — | 성능·경제성·핀치 계산과 체크리스트 항목·상태·집계는 **`../hrsg_calc_kit_team1`(팀 1 키트)의 calc.py·checklist.py·data 를 고치지 않고** `backend/engine/kit.py` 로 불러 씀. 화면 상태 → 키트 입력 변환은 어댑터 `to_kit_inputs` 하나에서만. 키트 폴더 파일은 수정 금지. 세정 전후 비교만 이전 DEMO 공식(0.0013) 유지 |

Docker 는 쓰지 않습니다 (로컬 직접 실행 — 사용자 결정 2026-11-03).

**Render 배포 (2026-11-05 사용자 승인)**: 비공개 GitHub 저장소(루트 = `HRSG/`) + Render 무료 플랜(웹 서비스 1 + PostgreSQL 1, `HRSG/render.yaml`).
Django 가 API 와 React 빌드 결과를 같은 주소로 제공하고, 배포판은 휴대폰 화면을 켭니다(`VITE_MOBILE_UI=1`).
배포용 설정은 `RENDER_EXTERNAL_HOSTNAME`·`DATABASE_URL` 이 있을 때만 켜지므로 로컬 실행은 그대로입니다.
배포판에서 AI 근거 검색은 '사용 불가'(무료 512MB 로 BGE-M3 불가, 평가셋 원문 재배포 금지). 절차: [docs/07_render_deploy.md](docs/07_render_deploy.md)

**모바일 웹 (2026-11-04 사용자 승인)**: 휴대폰 접속용 서버 `npm run dev:mobile`(`vite.mobile.config.ts`, 포트 **5175**, `0.0.0.0` 바인딩 + 사설망 주소만 허용)에 한해 '이 컴퓨터 전용' 규칙을 완화합니다.
PC 웹(5174 localhost)·백엔드(8002 127.0.0.1)·`vite.config.ts` 는 바꾸지 않습니다. 모바일 화면은 5175 로 열고 폭 ≤ 767px 일 때만 켜집니다. 상세: [docs/05_mobile.md](docs/05_mobile.md)

## 2. 그대로 적용되는 상위 규칙 (요약)

- 요청받은 Phase만 구현. 범위 밖 기능 추가 금지 (실시간 센서·자동 제어 없음. 외부 배포는 위 Render 만)
- **로그인·역할 (2026-11-05 사용자 요청)**: 사번·비밀번호 + 역할 2개(PLANT_ENGINEER·AI_ADMIN). 회원가입·역할 변경 기능은 없음. 모든 API 는 `accounts/policy.py` 권한표를 거치며 표에 없으면 거부. 상세: [docs/06_auth.md](docs/06_auth.md)
- 데모·사용자 입력·실측·공개 문헌·산출 불가를 화면과 API 모두에서 구분 (`ReliabilityBadge`)
- 입력 누락을 0으로 처리하지 않음 → `null` + 이유
- 계산은 서버(Django)에서만. 브라우저에 계산식·API 키 금지
- 실제 제조사·발전소·고객사 이름 금지. 출처 파일 없는 수치를 사실처럼 표시 금지
- 기존 파일·DB 삭제, 패키지 설치는 먼저 확인
- 실행하지 못한 검증은 '미실행'으로 보고. 각 Phase 끝에 상위 CLAUDE.md §2 보고 형식 사용

## 3. 검색(RAG) 규칙

- 운영 기본값 = `../tools/official_eval/locked_config.json` (BGE-M3 rev 5617a9f6, wrrf-v1, 벡터 0.7/BM25 0.3, 후보 30/50, k=60, 최종 8, 참고문헌당 2)
- BM25는 평가셋 원본 `retrieve.js` 와 같은 순위를 내야 함 (100문항 순위 일치로 검증)
- 공식 corpus·질문 파일·`.cache/official/` 은 읽기만 함. test 결과는 다시 채점하지 않음
- 프롬프트의 40/40 동일 가중 RRF 는 실험용 설정으로만 (dev 문항)
- 답변 AI 는 **Claude (Anthropic API, 기본 `claude-opus-5-5`)** — 2026-11-05 사용자 결정으로 Gemini 에서 교체. Claude 에는 검색으로 찾은 문단(최대 8개)·마스킹된 질문·서버 계산값만 보냄
- API 키는 `backend/.env` 의 `ANTHROPIC_API_KEY` 에 **사용자가 직접** 넣음. 키를 채팅·코드·문서·프롬프트에 넣거나 출력하지 않음 (존재 여부만 확인)

## 4. 실행

```bash
# 백엔드
cd explorer/backend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo_cases
.venv/bin/python manage.py runserver 127.0.0.1:8002

# 프론트엔드
cd explorer/frontend
npm run dev            # http://localhost:5174
```
