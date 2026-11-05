from django.core.management.base import BaseCommand, CommandError

from rag import paths
from rag.prototype.build_corpus import build


class Command(BaseCommand):
    help = "reference/papers 의 PDF 로 개인 프로토타입 코퍼스(data/prototype/)를 만듭니다. 원본 PDF 는 수정하지 않습니다."

    def handle(self, *args, **opts):
        if not paths.PAPERS_DIR.is_dir():
            raise CommandError(f"논문 폴더가 없습니다: {paths.PAPERS_DIR}")
        if not (paths.CORPUS_DIR / "access_status.csv").exists():
            raise CommandError(f"{paths.CORPUS_DIR / 'access_status.csv'} 가 없습니다 (문헌별 사용 가능 여부 표).")
        r = build(paths.PAPERS_DIR, paths.BIBLIOGRAPHY, paths.CORPUS_DIR)
        t = r["totals"]
        w = self.stdout.write
        w(f"[프로토타입 코퍼스] {r['label']}")
        w(f"PDF {t['pdf_files']}개 → 포함 문헌 {t['documents_included']}개, 문단 {t['chunks']}개 "
          f"(언어별 {t['chunks_by_lang']}, 출처별 {t['chunks_by_source']})")
        w(f"중복 파일 {t['duplicates']}개: " + ", ".join(f"{d['file_name']} = {d['same_as']}" for d in r["duplicates"]))
        w(f"제외 {t['excluded']}개:")
        for e in r["excluded"]:
            w(f"  - {e['file_name']} [{e['status']}] {e['reason']}")
        if r["missing_files"]:
            w(f"참고문헌 목록에는 있지만 폴더에 없는 파일: {', '.join(r['missing_files'])}")
        if r["not_in_bibliography"]:
            w(f"참고문헌 목록에 없는 파일: {', '.join(r['not_in_bibliography'])}")
        if r["empty_pages"]:
            w("텍스트 없는 페이지(누락, OCR 안 함):")
            for f, pages in r["empty_pages"].items():
                w(f"  - {f}: {pages}")
        w(f"빈 문단 {r['empty_chunks']}개, 문단 ID 중복 {len(r['duplicate_chunk_ids'])}개, "
          f"내용이 똑같은 문단 {r['identical_text_chunks']}개")
        w(self.style.SUCCESS(f"저장: {paths.CORPUS_DIR}/corpus.jsonl, documents.json, build_report.json"))
        w("다음: python manage.py rag_build_embeddings")
