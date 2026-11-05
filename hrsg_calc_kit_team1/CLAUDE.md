# HRSG 계산기·체크리스트 키트 (두 팀 공통 코어) — 작업 규칙

이 폴더의 계산기·체크리스트 로직과 임시 데이터를 내 웹페이지에 붙인다. 아래 규칙을 지킨다.

- 먼저 내 프로젝트의 언어·프레임워크를 확인한다.
  - JavaScript/TypeScript → `calc.js`, `checklist.js` 를 그대로 쓴다.
  - Python (Streamlit, Flask, Django 등) → `calc.py`, `checklist.py` 를 그대로 쓴다. 함수 이름은 snake_case (README 「함수 이름」 표).
  - 그 밖의 언어 → `calc.js`, `checklist.js` 를 기준으로 옮기고, 테스트 파일과 같은 입력에서 같은 기대값이 나오는지 확인한다.
- `calc.*`, `checklist.*`, `data/`, 테스트는 두 팀 공통이다. 고치지 않는다.
  내 화면의 필드 이름·단위가 다르면 어댑터 함수 하나에서 바꾼다(README 의 연결표 참고).
- 어댑터 결과는 `validateInputs` / `validate_inputs`, `validateProgress` / `validate_progress` 로 검사해 오류·경고가 0개인지 확인한다.
- 압력은 키 이름 끝에 단위를 붙여 넣는다(`gt_bp_mmh2o`, `hrsg_dp_kpa`, `gt_bp_mbar` …). 직접 단위를 변환하지 않는다.
- 체크리스트 상태는 화면 글자가 아니라 영문 키(`received`, `na` …)로 저장한다.
- 숫자와 항목은 코드에 직접 쓰지 않고 `data/calculator.json`, `data/checklist.json` 에서 읽는다.
- 모든 숫자는 DEMO 값이다. 화면에 DEMO·가상 값 표시를 유지하고 실제 설비·가격처럼 보이게 쓰지 않는다.
- 공법은 「회수기간이 가장 짧은 공법 (가정 기준, 추천 아님)」 또는 「순편익 최대」로 표시한다. 「권장」·「추천」이라고 쓰지 않는다.
- 발전소 이름·측정값·메모는 LLM 에 보내지 않는다.
- 작업 뒤에는 테스트가 모두 통과하는지 확인한다.
  - JavaScript: `node --test calc.test.mjs checklist.test.mjs` (15개)
  - Python: `python -m unittest discover -s <키트 폴더> -p "test_*.py"` (16개, 추가 설치 없음)
