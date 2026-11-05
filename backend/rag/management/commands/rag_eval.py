import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from rag import evalrun, paths
from rag.retrieval.hybrid import SearchConfig
from rag.retrieval.metrics import summarize, evaluate

DEFAULT = SearchConfig()


class Command(BaseCommand):
    help = ("BM25 단독 / BGE-M3 벡터 단독 / BM25+BGE-M3+RRF 를 같은 코퍼스·판정 기준으로 평가합니다. "
            "기본은 dev. test 는 설정을 확정(--lock)한 뒤 --split test --confirm-test 로 따로 실행합니다.")

    def add_arguments(self, parser):
        parser.add_argument("--split", choices=["dev", "test"], default="dev")
        parser.add_argument("--file", default=None, help="평가 CSV (기본 data/eval/eval_questions.csv)")
        parser.add_argument("--bm25-k", type=int, default=None)
        parser.add_argument("--vector-k", type=int, default=None)
        parser.add_argument("--rrf-k", type=int, default=None)
        parser.add_argument("--lock", action="store_true", help="(dev) 이번 설정을 test 용 확정 설정으로 저장")
        parser.add_argument("--confirm-test", action="store_true", help="test 평가 실행 확인 (설정 확정 후 한 번만)")
        parser.add_argument("--show", type=int, default=30, help="실패 질문을 몇 개까지 출력할지")

    def handle(self, *args, **o):
        w = self.stdout.write
        overrides = {k: o[k] for k in ("bm25_k", "vector_k", "rrf_k") if o[k] is not None}
        if o["split"] == "test":
            if overrides or o["lock"]:
                raise CommandError("test 평가는 확정된 설정(locked_config.json)으로만 실행합니다. 설정 옵션을 빼세요.")
            if not paths.LOCKED_CONFIG.exists():
                raise CommandError("확정 설정이 없습니다. dev 에서 설정을 정한 뒤 rag_eval --lock [설정] 으로 확정하세요.")
            if not o["confirm_test"]:
                raise CommandError("test 평가는 튜닝이 끝난 뒤 한 번만 실행합니다. 확인했다면 --confirm-test 를 붙이세요.")
            locked = json.loads(paths.LOCKED_CONFIG.read_text(encoding="utf-8"))
            cfg = SearchConfig(**locked["config"])
        else:
            cfg = SearchConfig(**{**DEFAULT.as_dict(), **overrides})

        path = Path(o["file"]) if o["file"] else paths.EVAL_FILE
        corpus, questions, warnings = evalrun.load_questions(path, o["split"])
        for x in warnings:
            w(self.style.WARNING(x))
        w(f"평가 파일 {path.name} (해시 {evalrun.file_hash(path)}), split={o['split']}, 질문 {len(questions)}개 — "
          f"모델을 불러오는 중…")
        retriever, meta = evalrun.build_retriever(corpus)
        w(f"코퍼스 {len(corpus)}문단 (해시 {corpus.hash[:12]}), 임베딩 {meta['embedding']['model']}@"
          f"{meta['embedding']['revision'][:8]}, 설정 {cfg.as_dict()}")

        rows = evaluate(retriever, questions, cfg)
        summaries = {m: summarize(rows, m) for m in ("bm25", "vector", "hybrid")}
        w("")
        evalrun.print_summary(w, summaries)

        unans = [r for r in rows if not r["answerable"]]
        if unans:
            w(f"\n답이 없는 질문 {len(unans)}개 (Recall·MRR 평균에서 제외, 관찰용 1위 점수):")
            for r in unans:
                top = r["modes"]["hybrid"]["top_score"] if r["modes"].get("hybrid") else None
                w(f"  {r['qid']} [{r['lang']}] 1위 BM25 점수 {(top or {}).get('bm25')}, 코사인 {(top or {}).get('vector')}"
                  f" — {r['question'][:50]}")

        failed = [r for r in rows if r["answerable"] and r["modes"].get("hybrid") and r["modes"]["hybrid"]["recall"] < 1]
        w(f"\n하이브리드에서 정답 문헌을 다 찾지 못한 질문: {len(failed)}개")
        for r in failed[:o["show"]]:
            h = r["modes"]["hybrid"]
            w(f"  {r['qid']} [{r['lang']}] recall {h['recall']:.2f} — {r['question'][:60]}")
            for f in r["failures"]:
                extra = " · BM25 단독은 찾았는데 하이브리드는 놓침" if f["found_by_bm25_only"] else ""
                w(f"      {f['doc_id']}: {evalrun.CAUSES[f['cause']]} (BM25 후보 {'O' if f['in_bm25_candidates'] else 'X'}, "
                  f"벡터 후보 {'O' if f['in_vector_candidates'] else 'X'}, 결합 후 최고 순위 {f['best_list_rank']}){extra}")
        lost = [r["qid"] for r in failed if any(f["found_by_bm25_only"] for f in r["failures"])]
        w(f"\n이 앱의 BM25 단독은 찾았는데 하이브리드가 놓친 질문: {lost or '없음'}"
          "  (공식 앱의 기존 BM25 결과는 없어 비교하지 못함)")
        w("\n" + evalrun.NOT_COMPARABLE)

        out = evalrun.save_run(o["split"], {
            "split": o["split"], "config": cfg.as_dict(), "eval_file": str(path), "eval_hash": evalrun.file_hash(path),
            "corpus_hash": corpus.hash, "embedding": meta["embedding"], "summaries": summaries, "rows": rows,
            "note": evalrun.NOT_COMPARABLE})
        w(f"기록: {out}")

        if o["lock"]:
            paths.LOCKED_CONFIG.write_text(json.dumps({"config": cfg.as_dict(), "locked_from_run": out.name,
                                                       "corpus_hash": corpus.hash}, ensure_ascii=False, indent=1),
                                           encoding="utf-8")
            w(self.style.SUCCESS(f"test 용 설정 확정: {paths.LOCKED_CONFIG}"))
