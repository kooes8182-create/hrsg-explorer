# 공식 평가셋 v1 · dev 검색 실험 (BM25 × 로컬 임베딩 가중 RRF)

원본 `hrsg_eval_set_v1/` 은 읽기만 합니다. 채점은 공식 지표 그대로이고, **test 는 실행하지 않습니다.**

## 파일
| 파일 | 역할 |
|---|---|
| `experiment_config.json` | 결과를 보기 전에 고정한 설정·모델 선택 기준 |
| `make_dev_set.mjs` | 원본 SHA256 확인 후 dev 68문항 사본 → `.cache/official/eval_questions.dev.json` |
| `eval_retrieval_dev.mjs` | 공식 채점 스크립트 복사본. 원본과 차이는 경로 2곳(`official` 기준 경로, `--retriever` 옵션)뿐 — `diff` 로 확인 가능 |
| `bm25_candidates.mjs` | 원본 `retrieve.js` 로 cap 적용 전 BM25 순위 추출(passage 마다 임시 ref 를 붙인 사본 사용). 원본 search() 상위 8개와 전 문항 일치 검증 |
| `embed_official.py` | 공식 passage·dev 질문 로컬 임베딩 → `.cache/official/<모델>/` (corpus 해시 + 배열 인덱스 + ref·page·kind·본문 SHA1 로 대조) |
| `lookup_retrieve.js` | 채점 복사본이 불러 쓰는 검색 함수: 미리 계산한 결합 순위 + 원본과 같은 cap() |
| `run_experiments.py` | 가중 RRF 실험, 공식 채점 호출, CSV·요약표·그래프·실패 분석 생성 |

## 재실행 (HRSG 폴더에서, 백엔드 서버는 꺼 두기 — 메모리 8GB)
```bash
node tools/official_eval/make_dev_set.mjs
node tools/official_eval/bm25_candidates.mjs
backend/.venv/bin/python tools/official_eval/embed_official.py --model bge-m3     # 약 6분 (캐시 있으면 질문만)
backend/.venv/bin/python tools/official_eval/embed_official.py --model e5-base    # 약 2분
backend/.venv/bin/python tools/official_eval/run_experiments.py                   # 채점 결과는 캐시 재사용
backend/.venv/bin/python tools/official_eval/compare_baseline.py                  # 기준선 대비 비교표·그래프
# test (설정 확정 후 한 번만 — 2026-10-29 실행 완료. 다시 돌리지 말 것)
#   설정: locked_config.json  /  실행: run_test_locked.py  /  표·그래프만 다시 만들기: report_test_locked.py
# 공식 BM25 dev 기준선 확인
node tools/official_eval/eval_retrieval_dev.mjs --questions .cache/official/eval_questions.dev.json
```
corpus·질문 파일·모델이 바뀌면 해시가 달라져 캐시를 쓰지 않고 다시 계산합니다.

## 결과 (`data/official_eval/`)
`experiments_dev.csv`(전체), `best_settings_dev.md`(모델별 최적·검증), `stage2_candidates_rrf_dev.md`(후보 수·RRF k),
`failures_ko_dev.md`(한국어 문항 변화·원인), `ko_recall_alpha`·`ko_mrr_alpha`·`en_recall_alpha` (.png/.svg), `versions.json`
