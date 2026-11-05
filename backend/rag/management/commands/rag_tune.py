from itertools import product
from pathlib import Path

from django.core.management.base import BaseCommand

from rag import evalrun, paths
from rag.retrieval.hybrid import SearchConfig
from rag.retrieval.metrics import evaluate, summarize

CANDIDATES = (30, 40, 50)
RRF_KS = (30, 60, 90)
BASE = SearchConfig()  # 50 / 50 / 60, 최종 8, 문헌당 2


class Command(BaseCommand):
    help = ("dev 질문만으로 하이브리드 설정(BM25·벡터 후보 수 30/40/50, RRF 상수 30/60/90)을 비교합니다. "
            "최종 8개·문헌당 2개는 고정. test 질문은 읽지 않습니다.")

    def add_arguments(self, parser):
        parser.add_argument("--file", default=None)

    def handle(self, *args, **o):
        w = self.stdout.write
        path = Path(o["file"]) if o["file"] else paths.EVAL_FILE
        corpus, questions, warnings = evalrun.load_questions(path, "dev")
        for x in warnings:
            w(self.style.WARNING(x))
        retriever, meta = evalrun.build_retriever(corpus)
        cache = {}
        # 후보는 최대 개수(50)로 질문마다 한 번만 구하고, 설정별로 잘라 씁니다.
        base_rows = evaluate(retriever, questions, SearchConfig(bm25_k=max(CANDIDATES), vector_k=max(CANDIDATES),
                                                                rrf_k=BASE.rrf_k), cache=cache)
        results = []
        for bk, vk, rk in product(CANDIDATES, CANDIDATES, RRF_KS):
            cfg = SearchConfig(bm25_k=bk, vector_k=vk, rrf_k=rk)
            rows = evaluate(retriever, questions, cfg, modes=("bm25", "hybrid"), cache=cache)
            results.append({"config": cfg.as_dict(), "hybrid": summarize(rows, "hybrid")})
        base = next(r for r in results if r["config"] == BASE.as_dict())["hybrid"]

        def key(r):  # 한국어 Recall 우선 → 전체 Recall → 전체 MRR
            h = r["hybrid"]
            return (-(h["ko"].get("recall") or 0), -(h["all"].get("recall") or 0), -(h["all"].get("mrr") or 0))

        results.sort(key=key)
        w(f"dev 질문 {len(questions)}개, 정렬: 한국어 Recall@8 → 전체 Recall@8 → MRR. 기준 = 초기 설정 50/50/60")
        w("BM25k 벡터k RRFk | 한국어 R@8  MRR | 영어 R@8  MRR | 전체 R@8  MRR | 기준 대비 (한R, 영R, 전체MRR)")
        for r in results:
            c, h = r["config"], r["hybrid"]
            d = lambda part, m: (h[part].get(m) or 0) - (base[part].get(m) or 0)
            w(f"{c['bm25_k']:5} {c['vector_k']:5} {c['rrf_k']:4} | {h['ko'].get('recall', 0):7.3f} {h['ko'].get('mrr', 0):5.3f}"
              f" | {h['en'].get('recall', 0):7.3f} {h['en'].get('mrr', 0):5.3f} | {h['all'].get('recall', 0):7.3f}"
              f" {h['all'].get('mrr', 0):5.3f} | {d('ko', 'recall'):+.3f} {d('en', 'recall'):+.3f} {d('all', 'mrr'):+.3f}")
        best = results[0]
        h = best["hybrid"]
        warn = [n for n, part, m in (("영어 Recall", "en", "recall"), ("전체 MRR", "all", "mrr"), ("영어 MRR", "en", "mrr"))
                if (h[part].get(m) or 0) < (base[part].get(m) or 0)]
        w(f"\n한국어 Recall 기준 1위: {best['config']}" + (f"  ⚠ 기준보다 낮아진 지표: {', '.join(warn)}" if warn else ""))
        w("  dev 질문 수가 적으면 차이가 우연일 수 있습니다. 설정을 정했으면:")
        c = best["config"]
        w(f"  python manage.py rag_eval --bm25-k {c['bm25_k']} --vector-k {c['vector_k']} --rrf-k {c['rrf_k']} --lock")
        w("\n" + evalrun.NOT_COMPARABLE)
        out = evalrun.save_run("dev_tune", {"eval_file": str(path), "eval_hash": evalrun.file_hash(path),
                                            "corpus_hash": corpus.hash, "embedding": meta["embedding"],
                                            "base": base, "grid": results,
                                            "three_modes_at_50": {m: summarize(base_rows, m) for m in ("bm25", "vector", "hybrid")}})
        w(f"기록: {out}")
