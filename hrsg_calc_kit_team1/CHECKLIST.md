# 데이터 요청 체크리스트 — 두 팀 공통 (common-0.2, 임시 예시)

- 데이터: `data/checklist.json` — 카테고리 5개, 항목 49개 (필수 16), 계산기 입력 22개
- 로직: `checklist.js` (JavaScript) / `checklist.py` (Python, 함수 이름은 snake_case — README 「함수 이름」 표)
- 테스트: `node --test checklist.test.mjs` / `python -m unittest test_checklist.py`

두 팀이 같은 항목과 같은 상태 값을 씁니다. 화면 글자(예: 「실측 미입력」/「대기」)는 팀마다 달라도 되지만, 저장하는 값은 아래 영문 키입니다.

## 항목

| 카테고리 | 개수 | 필수 |
|---|---|---|
| A. 가스터빈/운전 | 6 (A-01~A-06) | A-01~A-05 |
| B. HRSG 열역학/설계 | 13 (B-01~B-13) | B-01, B-02, B-05~B-08 |
| C. 세정/유지보수 | 9 (C-01~C-09) | — |
| D. 경제성 | 3 (D-01~D-03) | D-01, D-03 |
| E. 확장 | 18 (E-01~E-18) | E-01, E-13, E-16 |

| 필드 | 뜻 |
|---|---|
| `id`, `category` | A-01 … E-18 |
| `name`, `unit`, `reason` | 항목명, 단위, 왜 필요한지(설명 줄) |
| `kind` | `design` 설계 / `operation` 운전 / `document` 문서 (문서는 측정값 칸에 「문서」) |
| `required`, `priority` | 필수 여부, 우선순위 `high`/`medium`/`low` |
| `calc_input` | 계산기 입력 경로 (값이 있으면 「계산기 입력에 사용됨」) |

배지 글자는 `priorityLabel(C, item, style)`: `'level'` → 「필수 · 높음」, `'simple'` → 「필수 / 권장 / 선택」.

## 상태 (`progress`)

`{ "A-01": { supply, verify, reviewed, value, note } }` — 항목 파일과 따로 저장합니다(브라우저 localStorage 등).

| 필드 | 값 (화면 글자 예) |
|---|---|
| `supply` 수급 상태 | `not_entered` 실측 미입력·대기 (기본) · `requested` 요청 필요·요청함 · `received` 수령 완료 · `verify_needed` 검증 필요 · `na` 해당 없음 |
| `verify` 검증 상태 | `unverified` 미검증 (기본) · `in_progress` 검증 진행 중 · `verified` 검증 완료 · `failed` 검증 실패 |
| `reviewed` | 검토 체크 (true/false) |
| `value`, `note` | 측정값, 메모 |

계산 기준(임시):
- **수령** = `received` + `verify_needed`. 왼쪽 동그라미 체크 하나만 쓰는 화면은 체크 = `received`.
- **해당 없음**(`na`)은 모든 비율의 분모에서 뺍니다.
- **필수 충족** = 수령했고 검증 실패가 아님.

## 함수

| 화면 요소 | 함수 | 처음 상태 |
|---|---|---|
| 진행률 카드 | `kpis()` — 수령률 · 검토 진행률 · 검증 완료율 · 필수 충족률 / `summary()` — 전체 · 필수 · 카테고리별 | 0% (0/49), 필수 0/16 |
| 카테고리별 막대·탭 | `byCategory()` | A 0/6 · B 0/13 · C 0/9 · D 0/3 · E 0/18 |
| 상태 분포 · 미수령 필수 | `distribution()` | 실측 미입력 49, 미수령 필수 16개 |
| 카테고리 × 상태 표 | `matrix()` | |
| 검색·필터 | `filterItems({ query, category, supply, requiredOnly, incompleteOnly })` | 49 |
| 설명 줄 · 측정값 칸 | `detailLine()`, `measureCell()` | |
| 메일 문구 | `emailDraft(C, prog, { ids })` — ids 를 주면 선택 항목, 안 주면 미수령 전체 | |
| Excel | `exportRows()` (표준 양식은 `{ template: true }`), `importReply()` (회신 값 → 「검증 필요」) | |
| 상태 검사 | `validateProgress()` — 모르는 ID, 화면 글자를 그대로 저장한 상태 값 | |
| 초기화 | `resetProgress()` | |

## 규칙

- 메일은 보내지 않고 문구만 만듭니다(복사). Excel 읽기·쓰기는 각자 라이브러리(SheetJS 등)로 하고, 키트는 행 배열만 다룹니다.
- 발전소 이름·측정값·메모는 LLM(챗봇)에 보내지 않습니다.
