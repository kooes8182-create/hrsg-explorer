# 로그인 · 역할별 접근 제어

사번·비밀번호 로그인(Django 세션 + CSRF)과 두 역할의 화면·API 접근 범위입니다. (2026-11-05 사용자 요청으로 추가)

## 1. 역할과 시작 화면

| 역할 | 시작 화면 | 메뉴 |
|---|---|---|
| `PLANT_ENGINEER` 플랜트 엔지니어 | 대시보드 | OVERVIEW: 대시보드 · ENGINEERING: 데이터 요청 체크리스트, 시뮬레이션, 심층 분석, 세정 전후 비교 · AI & KNOWLEDGE: AI 엔지니어링 도우미, 참고 자료 및 용어집 (+ 알림 센터, 인쇄용 보고서) |
| `AI_ADMIN` AI 관리자 | RAG 검색 성능 평가 | RAG 관리: RAG 지식베이스, RAG 검색 성능 평가 (조회 전용) |

- 역할은 서버의 `accounts_userprofile` 표에만 있습니다. 로그인 화면에서 역할을 고르지 않으며, 사번·비밀번호 모양으로 추측하지 않습니다.
- 역할이 없는 계정(Django superuser 포함)은 로그인할 수 없고 업무 API 도 403 입니다. AI_ADMIN 은 superuser·staff 가 아닙니다.
- '성능·경제성 계산기'와 '설정'은 두 역할 모두 메뉴·화면·API 를 열지 않습니다(코드는 남김). 계산은 시뮬레이션의 '평가 실행'이 같은 서버 계산을 씁니다.
- 외부 AI(Claude) 전송 허용·민감 식별정보 목록은 운영자 명령으로 바꿉니다: `.venv/bin/python manage.py ai_settings --external on|off`

## 2. 인증 방식

- 서버: Django 표준 `authenticate()`·`login()` (비밀번호는 PBKDF2 해시), 세션 쿠키(HttpOnly, SameSite=Lax, 8시간), 모든 쓰기 요청과 로그인 요청에 CSRF 토큰 검사.
- 로그인 실패는 사번 존재 여부와 상관없이 같은 문구("사번 또는 비밀번호를 확인해 주세요"). 실패 횟수 제한: 같은 IP+사번 5회, 같은 IP 20회 / 15분 → 429 (서버 프로세스 메모리 기준).
- 로그인하지 않은 요청 401, 역할에 맞지 않는 요청 403, **권한표에 없는 API 는 기본 거부(403)** — 새 API 를 만들면 `accounts/policy.py` 에 등록해야 열립니다 (테스트가 누락을 잡음).
- 화면: `/api/auth/me/` 로 로그인 상태를 확인(새로고침 복원)하고, 확인 중에는 메뉴·데이터 없이 로딩 화면만. 역할에 없는 주소는 '접근할 수 없는 화면' + 시작 화면 버튼. 로그인·로그아웃·만료 때 페이지를 새로 불러와 이전 계정의 화면 데이터·진행 중 요청을 버리고, 브라우저의 사용자별 저장값(대화 위치·케이스 선택·끊김 기록)을 지웁니다.
- 로그인 후 원래 주소로 돌아가기: 그 주소가 로그인한 역할에 허용될 때만, 아니면 시작 화면.
- 플랜트 챗봇 응답에서는 검색 점수·순위·용어 매핑·소요 시간·검색 설정을 빼고 출처·문단만 보냅니다(DB 에는 그대로 저장). `/api/rag/info/` 도 플랜트에는 답변 가능 여부·문헌 수만.
- 정적 자료: 프런트엔드 `public` 폴더 없음. 개발 서버에서 공식 corpus·임베딩 캐시·`.env` 직접 경로는 403 (확인함).

## 3. 데모 계정

```bash
cd explorer/backend
.venv/bin/python manage.py create_demo_accounts                 # 없는 계정만 만들고 새 비밀번호를 터미널에 한 번 표시
.venv/bin/python manage.py create_demo_accounts --output FILE   # 터미널 대신 FILE(권한 600)에 저장 — 확인 후 삭제
.venv/bin/python manage.py create_demo_accounts --reset 사번     # 그 계정만 새 비밀번호로 재설정
```

| 역할 | 사번 (가상) | 이름 |
|---|---|---|
| 플랜트 엔지니어 | 90010417 | 데모 플랜트 엔지니어 |
| AI 관리자 | 90020833 | 데모 AI 관리자 |

다시 실행해도 계정이 중복되지 않고 비밀번호도 바뀌지 않습니다. 앱 시작 때 자동으로 만들지 않으며, 운영 환경에 자동 생성·배포하지 않습니다. 비밀번호는 소스·문서·로그에 남기지 않습니다.

화면 테스트(e2e)는 시작 때 테스트 전용 계정(`e2e-plant`, `e2e-admin`, 매번 새 난수 비밀번호)을 만들고 끝나면 지웁니다 (`manage.py e2e_accounts`).

## 4. AI 관리자: 조회와 차단

| 조회 (허용) | 차단 (권한표 BLOCKED — 화면에서도 숨김) |
|---|---|
| 공식 corpus 문헌·청크, 업로드 문헌 목록·청크·작업 상태, 업로드 문헌 검색 | PDF 업로드, 메타데이터 수정, 재처리, **재임베딩**, 삭제, 전체 재색인 |
| 저장된 검색 평가 기록(dev/test), 질문별 검색 비교(읽기 전용 검색) | **새 dev 평가 실행** |
| 정답 라벨 목록, 사용자 피드백 내보내기(JSON) | 정답 라벨 추가·상태 변경·삭제 |
| — | 시스템 설정(외부 AI 전송·민감어) 조회·변경 |

페이지에 들어가거나 로그인할 때 임베딩·튜닝·test 평가를 실행하지 않습니다 (저장된 결과만 읽음).

## 5. API 권한표 (`accounts/policy.py` 에서 생성)

| API 이름 | 주소 | 메서드 → 허용 역할 |
|---|---|---|
| `health` | `/api/health/` | GET: 공개 |
| `auth-me` | `/api/auth/me/` | GET: 공개 |
| `auth-login` | `/api/auth/login/` | POST: 공개 |
| `auth-logout` | `/api/auth/logout/` | POST: 공개 |
| `case-list` | `/api/cases/` | GET: 플랜트<br>POST: 플랜트 |
| `case-detail` | `/api/cases/<case_id>/` | GET: 플랜트<br>PATCH: 플랜트<br>DELETE: 플랜트 |
| `case-clone` | `/api/cases/<case_id>/clone/` | POST: 플랜트 |
| `case-overview` | `/api/cases/<case_id>/overview/` | GET: 플랜트 |
| `input-schema` | `/api/inputs/schema/` | GET: 플랜트 |
| `case-inputs` | `/api/cases/<case_id>/inputs/` | GET: 플랜트<br>PUT: 플랜트 |
| `inputs-reset` | `/api/cases/<case_id>/inputs/reset/` | POST: 플랜트 |
| `evaluate` | `/api/cases/<case_id>/evaluate/<kind>/` | POST: 플랜트 |
| `case-results` | `/api/cases/<case_id>/results/` | GET: 플랜트 |
| `snapshots` | `/api/cases/<case_id>/snapshots/` | GET: 플랜트<br>POST: 플랜트 |
| `snapshot-detail` | `/api/cases/<case_id>/snapshots/<sid>/` | GET: 플랜트 |
| `snapshot-restore` | `/api/cases/<case_id>/snapshots/<sid>/restore/` | POST: 플랜트 |
| `checklist` | `/api/cases/<case_id>/checklist/` | GET: 플랜트<br>PATCH: 플랜트 |
| `checklist-export` | `/api/cases/<case_id>/checklist/export/` | GET: 플랜트 |
| `checklist-import` | `/api/cases/<case_id>/checklist/import/` | POST: 플랜트 |
| `checklist-template` | `/api/checklist/template/` | GET: 플랜트 |
| `checklist-request-text` | `/api/cases/<case_id>/checklist/request-text/` | POST: 플랜트 |
| `checklist-attachments` | `/api/cases/<case_id>/checklist/<item_id>/attachments/` | GET: 플랜트<br>POST: 플랜트 |
| `attachment-detail` | `/api/attachments/<aid>/` | DELETE: 플랜트 |
| `attachment-file` | `/api/attachments/<aid>/file/` | GET: 플랜트 |
| `measurements` | `/api/cases/<case_id>/measurements/` | GET: 플랜트<br>POST: 플랜트 |
| `measurement-detail` | `/api/cases/<case_id>/measurements/<mid>/` | PATCH: 플랜트<br>DELETE: 플랜트 |
| `public-smp` | `/api/public/smp/` | GET: 플랜트 |
| `public-sources` | `/api/public/sources/` | GET: 플랜트 |
| `glossary` | `/api/glossary/` | GET: 플랜트 |
| `conversations` | `/api/cases/<case_id>/conversations/` | GET: 플랜트<br>POST: 플랜트 |
| `conversation-detail` | `/api/conversations/<conv_id>/` | GET: 플랜트<br>PATCH: 플랜트<br>DELETE: 플랜트 |
| `conversation-ask` | `/api/conversations/<conv_id>/messages/` | POST: 플랜트 |
| `message-feedback` | `/api/messages/<msg_id>/feedback/` | POST: 플랜트 |
| `ai-context` | `/api/cases/<case_id>/ai-context/` | GET: 플랜트 |
| `case-questions` | `/api/cases/<case_id>/questions/` | POST: 플랜트 |
| `notifications` | `/api/notifications/` | GET: 플랜트 |
| `notifications-read-all` | `/api/notifications/read-all/` | POST: 플랜트 |
| `notifications-client-event` | `/api/notifications/client-event/` | POST: 플랜트 |
| `notification-read` | `/api/notifications/<nid>/read/` | POST: 플랜트 |
| `rag-info` | `/api/rag/info/` | GET: 플랜트 · AI 관리자 |
| `rag-experiments` | `/api/rag/experiments/` | GET: AI 관리자 |
| `rag-compare` | `/api/rag/compare/` | POST: AI 관리자 |
| `rag-search` | `/api/rag/search/` | POST: AI 관리자 |
| `rag-labels` | `/api/rag/labels/` | GET: AI 관리자<br>POST: ⛔ 차단 (모든 역할) |
| `rag-label-detail` | `/api/rag/labels/<label_id>/` | PATCH: ⛔ 차단 (모든 역할)<br>DELETE: ⛔ 차단 (모든 역할) |
| `rag-feedback-export` | `/api/rag/feedback/export/` | GET: AI 관리자 |
| `rag-run-dev` | `/api/rag/experiments/run-dev/` | POST: ⛔ 차단 (모든 역할) |
| `kb-papers` | `/api/knowledge/papers/` | GET: AI 관리자 |
| `kb-chunks` | `/api/knowledge/chunks/` | GET: AI 관리자 |
| `kb-uploads` | `/api/knowledge/uploads/` | GET: AI 관리자<br>POST: ⛔ 차단 (모든 역할) |
| `kb-upload-detail` | `/api/knowledge/uploads/<pid>/` | GET: AI 관리자<br>PATCH: ⛔ 차단 (모든 역할)<br>DELETE: ⛔ 차단 (모든 역할) |
| `kb-upload-chunks` | `/api/knowledge/uploads/<pid>/chunks/` | GET: AI 관리자 |
| `kb-upload-reprocess` | `/api/knowledge/uploads/<pid>/reprocess/` | POST: ⛔ 차단 (모든 역할) |
| `kb-upload-reembed` | `/api/knowledge/uploads/<pid>/reembed/` | POST: ⛔ 차단 (모든 역할) |
| `kb-upload-search` | `/api/knowledge/upload-search/` | POST: AI 관리자 |
| `kb-jobs` | `/api/knowledge/jobs/` | GET: AI 관리자 |
| `kb-reindex` | `/api/knowledge/reindex/` | POST: ⛔ 차단 (모든 역할) |
| `app-settings` | `/api/settings/` | GET: ⛔ 차단 (모든 역할)<br>PATCH: ⛔ 차단 (모든 역할) |
