# 07. Render 배포 절차 (무료 플랜, 2026-11-05)

HRSG Explorer 를 **비공개 GitHub 저장소 → Render 무료 플랜**으로 배포하는 순서입니다.

## 0. 구성 한눈에 보기

```
GitHub (비공개 저장소, 루트 = HRSG/)
   │  push 하면 자동 배포
   ▼
Render 웹 서비스 1개 "hrsg-explorer" (무료, 512MB)
   ├─ /api/...  → Django (gunicorn)
   └─ 그 밖의 주소 → React 화면 (frontend/dist, 휴대폰 화면 켬)
   │
   ▼
Render PostgreSQL 1개 "hrsg-explorer-db" (무료, 1GB)
```

| 파일 | 역할 |
|---|---|
| `HRSG/render.yaml` | Render 설정 (Blueprint). 서비스·DB·환경 변수 |
| `explorer/backend/requirements-render.txt` | 배포용 패키지 목록 (torch 등 AI 검색 패키지 제외, gunicorn 추가) |
| `explorer/backend/config/settings.py` | `RENDER_EXTERNAL_HOSTNAME`·`DATABASE_URL` 이 있을 때만 배포 설정 켜짐 |
| `explorer/backend/config/urls.py` | 배포판에서만 React 화면 파일 제공 |
| `create_demo_accounts --from-env` | 데모 계정 비밀번호를 Render 환경 변수에서 읽음 |

GitHub 에 **올라가지 않는 것** (`.gitignore`): `.env`, 비밀번호 메모 파일, PDF 원문, 공식 평가셋(`hrsg_eval_set_v1/`), 임베딩 캐시(`.cache/`), `node_modules`, `.venv`

## 1. GitHub 저장소 만들기 (웹에서)

1. github.com 에 새 계정으로 로그인 → 오른쪽 위 **+ → New repository**
2. Repository name: `hrsg-explorer`
3. **Private** 선택 (팀 1 키트는 외부 재배포 금지라 반드시 비공개)
4. README·.gitignore·license 는 **모두 체크하지 않음** (빈 저장소로)
5. **Create repository**

## 2. 올리기용 토큰 만들기 (비밀번호 대신 씀)

GitHub 은 터미널에서 계정 비밀번호를 받지 않습니다. 토큰(PAT)을 비밀번호 칸에 넣습니다.

1. 오른쪽 위 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Repository access: **Only select repositories → hrsg-explorer**
3. Permissions → Repository permissions → **Contents: Read and write**
4. 만든 토큰은 한 번만 보이므로 바로 복사해 둡니다 (채팅·파일에 붙여 넣지 않기)

## 3. 내 컴퓨터에서 올리기 (터미널)

로컬 커밋은 이미 만들어져 있습니다. `<내아이디>` 를 새 GitHub 아이디로 바꿔 실행합니다.

```bash
cd ~/hr_system/HRSG
git remote add origin https://<내아이디>@github.com/<내아이디>/hrsg-explorer.git
git push -u origin main
```

- Password 를 물으면 **2단계 토큰**을 붙여 넣습니다 (화면에 안 보이는 게 정상).
- 주소에 `<내아이디>@` 를 넣은 이유: 이 컴퓨터에는 예전 계정(hr-system 저장소)의 로그인 정보가 저장돼 있어서, 새 계정으로 올리도록 구분하려는 것입니다.
- 끝나면 GitHub 저장소 화면에 `explorer/`, `hrsg_calc_kit_team1/`, `render.yaml` 등이 보이면 성공입니다.

## 4. Render 에 배포하기 (웹에서)

1. render.com 로그인 → **Account Settings → GitHub** 연결 (Render GitHub App 설치 시 `hrsg-explorer` 저장소 접근 허용)
2. 대시보드 **New + → Blueprint** → `hrsg-explorer` 저장소 선택
3. `render.yaml` 을 읽어 서비스 `hrsg-explorer` 와 DB `hrsg-explorer-db` 가 표시됩니다
4. 직접 입력 칸 2개에 **새 비밀번호**를 넣습니다 (10자 이상, 로컬 비밀번호와 다르게 권장)
   - `DEMO_ENGINEER_PASSWORD` — 플랜트 엔지니어 계정 (사번 90010417)
   - `DEMO_ADMIN_PASSWORD` — AI 관리자 계정 (사번 90020833)
5. **Apply** → 처음 배포는 5~10분 걸립니다 (패키지 설치 + 화면 빌드)
6. 서비스 화면의 Logs 에 `사번 90010417: 새로 만듦` 이 보이고 상태가 **Live** 가 되면 완료
7. 서비스 화면 위쪽 주소(예: `https://hrsg-explorer.onrender.com`)로 접속 → 사번·비밀번호로 로그인

이름이 이미 쓰이고 있으면 Render 가 주소 뒤에 글자를 붙입니다. 실제 주소는 서비스 화면에서 확인하세요.

## 5. 이후 수정 반영

```bash
cd ~/hr_system/HRSG
git add -A
git commit -m "수정 내용"
git push
```

push 하면 Render 가 자동으로 다시 배포합니다 (약 5분).
비밀번호를 바꾸려면 Render 서비스 → **Environment** 에서 값을 바꾸고 저장하면 재시작 때 반영됩니다.

## 6. 무료 플랜에서 알아 둘 점

| 항목 | 내용 | 대처 |
|---|---|---|
| 잠자기 | 15분 동안 접속이 없으면 서버가 멈추고, 다음 첫 접속 때 약 1분 기다림 | 발표 직전 한 번 미리 열어 두기 |
| DB 만료 | 무료 PostgreSQL 은 **만든 날부터 30일 뒤 만료**, 14일 안에 유료 전환하지 않으면 삭제 | 만료 후 DB 를 새로 만들고 다시 배포 (데모 케이스·계정은 시작 때 자동 생성) |
| 파일 저장 | 업로드한 PDF·현장 사진은 서버 재시작·재배포 때 사라짐 (무료는 디스크 유지 불가) | 시연용으로만 사용 |
| AI 근거 검색 | 512MB 로 BGE-M3 불가 → corpus 를 Secret File 로 올리면 **BM25 단독(축소판)** 으로 동작 (§8) | 최종 모델(BGE-M3 혼합) 시연은 로컬(8002) |
| Shell 없음 | 무료는 서버 터미널을 쓸 수 없음 | DB 준비·데모 데이터·계정은 `startCommand` 에서 자동 처리 |

## 7. 배포 전 로컬 검증 (2026-11-05)

- `manage.py check` 이상 없음, 백엔드 테스트 124개 통과
- `VITE_MOBILE_UI=1 npm run build` 성공
- 배포 모드 흉내(8003, `RENDER_EXTERNAL_HOSTNAME=localhost`, `DATABASE_URL`, corpus 없음): `/`, `/checklist`, `/calculator`, `/assets/*.js`, `/api/health/` 모두 200, 검색 상태 `unavailable`
- **미실행**: 실제 Render 배포, HTTPS 에서의 로그인(보안 쿠키는 HTTPS 에서만 동작해 로컬 http 로는 확인 불가), torch 를 뺀 환경에서의 실행

## 8. 배포판 AI 채팅 켜기 (2026-11-07 사용자 승인)

corpus.json 은 GitHub 에 올리지 않고 **Render Secret Files** 로만 서버에 둡니다. 코드 수정 없이 환경 변수로 경로만 바꿉니다.

1. Render 서비스 `hrsg-explorer` → **Environment**
2. **Secret Files → Add Secret File**: 파일 이름 `corpus.json`, 내용 = `hrsg_eval_set_v1/App/web-server/data/corpus.json` 전체 (서버에서는 `/etc/secrets/corpus.json` 이 됨)
3. **Environment Variables** 에 추가
   - `RAG_OFFICIAL_CORPUS` = `/etc/secrets/corpus.json`
   - `ANTHROPIC_API_KEY` = 내 키 (직접 입력, 채팅·파일에 붙여 넣지 않기)
4. **Save, rebuild, and deploy** → Live 가 되면 `/api/health/` 에서 search `ready`, vector `unavailable`(BM25 대체) 확인
5. AI 관리자 계정(90020833)으로 로그인 → **설정 → 외부 AI 전송 허용** 켜기 (DB 기본값은 꺼짐. 무료 DB 를 새로 만들면 다시 켜야 함)

주의: 배포판 검색은 BM25 단독이라 최종 모델(BGE-M3 70% + BM25 30%, test Recall@8 0.864)과 결과가 다릅니다. 발표에서 최종 모델 성능을 보여 줄 때는 로컬 결과를 씁니다.
