"""이식한 검색이 공식 recall 을 측정한 절차와 같은 순위를 내는지 100문항 전부 확인합니다 (채점은 다시 하지 않음).

비교 대상 (읽기만):
  BM25 : .cache/official/test_locked/bm25_candidates.all.json — 원본 retrieve.js 의 cap 전 순위 (상위 200)
  결합 : .cache/official/test_locked/locked.ranking.json      — 확정 설정으로 test 를 채점할 때 쓴 결합 순위
결과는 explorer/data/rag/verify_locked.json 에 저장하고 RAG 평가 화면에 표시합니다.
실행: .venv/bin/python manage.py rag_verify   (BGE-M3 를 불러오므로 1~2분, HRSG 백엔드 검색과 동시 실행 금지 — 메모리 8GB)
"""

import json
import platform
import time
from datetime import datetime, timezone

from django.conf import settings
from django.core.management.base import BaseCommand

from rag import official as O

CACHE = O.HRSG / ".cache/official/test_locked"
OUT = settings.BASE_DIR.parent / "data/rag/verify_locked.json"


class Command(BaseCommand):
    help = "공식 검색 재현 확인 (100문항 BM25·결합 순위 일치)"

    def handle(self, *args, **opts):
        st = O.get()
        if st["corpus"] is None or st["vector"] != "ready":
            self.stderr.write(f"검색 준비 실패: {st['error'] or st['vector_reason']}")
            return
        questions = json.loads(O.QUESTIONS.read_text(encoding="utf-8"))
        bm_ref = {r["question"]: [x["i"] for x in r["ranking"]] for r in json.loads((CACHE / "bm25_candidates.all.json").read_text())["questions"]}
        locked = json.loads((CACHE / "locked.ranking.json").read_text())
        assert locked["corpus_sha256"] == st["corpus_sha"], "결합 순위 파일의 corpus 해시가 다릅니다"
        cfg = O.CONFIGS["locked"]
        rows, times = [], []
        for q in questions:
            t0 = time.perf_counter()
            r = O.run(q["question"], "locked", modes=("hybrid",))
            times.append((time.perf_counter() - t0) * 1000)
            ours_bm = r["bm25_order"][:len(bm_ref[q["question"]])]
            ours_h = r["hybrid_order"]
            ref_h = locked["rankings"][q["question"]]
            top8_ours = O.cap(ours_h, st["corpus"]["passages"], 8, 2)[0]
            top8_ref = O.cap(ref_h, st["corpus"]["passages"], 8, 2)[0]
            rows.append({"id": q["id"], "split": q["split"], "lang": q["lang"],
                         "bm25_match": ours_bm == bm_ref[q["question"]], "hybrid_match": ours_h == ref_h,
                         "top8_match": top8_ours == top8_ref})
        n = len(rows)
        summary = {k: sum(r[k] for r in rows) for k in ("bm25_match", "hybrid_match", "top8_match")}
        report = {
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "questions": n, **summary,
            "config": cfg, "device": st.get("device"), "platform": platform.platform(),
            "corpus_sha256": st["corpus_sha"], "query_ms_median": round(sorted(times)[n // 2], 1),
            "note": "순위 일치만 확인합니다. test 점수는 다시 계산하지 않으며, 저장된 공식 결과(0.864)를 그대로 표시합니다.",
            "mismatches": [r for r in rows if not (r["bm25_match"] and r["hybrid_match"])],
        }
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        self.stdout.write(f"{n}문항: BM25 순위 일치 {summary['bm25_match']}/{n}, 결합 순위 일치 {summary['hybrid_match']}/{n}, "
                          f"최종 상위 8개 일치 {summary['top8_match']}/{n} (장치 {st.get('device')}, 질의 중앙값 {report['query_ms_median']} ms)")
