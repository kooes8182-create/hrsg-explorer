# 평가 질문 (data/eval/)

> 현재 **평가 파일이 없습니다.** 협업안의 평가 질문 100개(정답 문헌·근거 페이지·dev/test)는 이 폴더에 제공되지 않았습니다.
> 그래서 이 앱에서 측정한 Recall@8·MRR 수치는 아직 **없습니다.**

## 작성 방법
1. `eval_questions.template.csv` 를 `eval_questions.csv` 로 복사합니다. (Excel 에서 열어도 됩니다. 저장은 **CSV UTF-8**)
2. 한 줄에 질문 하나씩 채웁니다. `#` 으로 시작하는 qid 행은 무시됩니다(형식 예시).

| 열 | 값 |
|---|---|
| `qid` | 질문 ID (중복 불가) |
| `split` | `dev`(설정 조정용) 또는 `test`(최종 확인용, 설정 확정 뒤 한 번만) |
| `lang` | `ko` 또는 `en` |
| `question` | 질문 문장 — **검색에는 이 칸만 들어갑니다** |
| `answerable` | `Y`(문헌에 답이 있음) / `N`(답이 없음 → Recall·MRR 평균에서 제외, 따로 기록) |
| `gold_doc_ids` | 정답 문헌 ID, `;` 로 구분. ID 는 `data/prototype/documents.json` 의 `doc_id` (예: `IAPWS-IF97-Rev2007`) |
| `evidence_pages` | 근거 PDF 페이지 `문헌ID:3,5;문헌ID:12-13` (실패 분석 참고용) |
| `note` | 메모 |

## 판정 기준 (문헌 단위, 협업안 p.7)
- Recall@8 = 최종 8문단에 들어온 **서로 다른** 정답 문헌 수 ÷ 정답 문헌 수 (같은 문헌 문단 여러 개 = 1개)
- MRR = 1 ÷ (최종 8문단 중 정답 문헌 문단이 처음 나온 위치), 없으면 0
- 공식 협업 평가셋은 공식 `corpus.json` 의 문헌 ID 를 쓰므로, 이 프로토타입 코퍼스 ID 와 맞지 않을 수 있습니다.
  코퍼스·평가셋이 다르면 협업안의 BM25 기준선과 **직접 비교할 수 없습니다.**

## 실행 (backend 폴더에서)
```bash
.venv/bin/python manage.py rag_eval                 # dev: BM25 / 벡터 / 하이브리드 비교 + 실패 원인
.venv/bin/python manage.py rag_tune                 # dev: 후보 30·40·50 × RRF 30·60·90
.venv/bin/python manage.py rag_eval --bm25-k 40 --vector-k 50 --rrf-k 60 --lock   # 설정 확정
.venv/bin/python manage.py rag_eval --split test --confirm-test                  # test: 확정 설정으로 한 번만
```
실행 기록은 `runs/` 에 JSON 으로 남습니다.
