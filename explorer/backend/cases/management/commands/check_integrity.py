"""데이터 정합성 검사 (읽기 전용 — 아무것도 고치지 않습니다).

검사 항목
- 케이스: 입력값 존재·검증 통과, 체크리스트 40개·알 수 없는 항목 없음, 검증 완료 항목에 값 있음, 결과 종류·해시 형식, 실측값 범위
- 업로드 문헌: READY 문헌의 청크·벡터(1024차원) 존재, 원본 파일 존재, 연결되지 않은 파일 없음
- 공식 검색: corpus 해시 = 확정 기록의 해시, 벡터 파일 대조 통과, 재현 확인 기록(100/100)
실행: .venv/bin/python manage.py check_integrity   (문제가 있으면 종료 코드 1)
"""

import hashlib
import json
import sys

from django.core.management.base import BaseCommand

from cases import checklist_registry as reg
from cases.models import EvaluationCase
from cases.services import KINDS, _has_value, CHECKLIST_FIELDS
from engine import fields
from engine.comparison import MEASUREMENT_FIELDS
from knowledge.models import Paper
from knowledge.storage import UPLOAD_DIR, file_path
from rag import official
from rag.experiments import DATA, OFFICIAL_DIR


class Command(BaseCommand):
    help = "데이터 정합성 검사 (읽기 전용)"

    def handle(self, *args, **opts):
        problems, notes = [], []
        P = problems.append

        for case in EvaluationCase.objects.all():
            tag = f"케이스 #{case.id} '{case.name}'"
            ci = getattr(case, "calc_input", None)
            if ci is None:
                notes.append(f"{tag}: 입력값 없음 (처음 열 때 기본값으로 만들어짐)")
            else:
                _, errs, _ = fields.clean_inputs(ci.values)
                if errs:
                    P(f"{tag}: 저장된 입력값이 규격에 맞지 않음 {sorted(errs)}")
                if ci.mode not in ("DEMO", "USER") or ci.scenario not in (*fields.SCENARIOS, "CUSTOM"):
                    P(f"{tag}: 모드·시나리오 값 오류 ({ci.mode}, {ci.scenario})")
            rows = list(case.checklist.all())
            ids = {r.item_id for r in rows}
            if rows and ids != set(reg.BY_ID):
                missing, unknown = set(reg.BY_ID) - ids, ids - set(reg.BY_ID)
                (P if unknown else notes.append)(f"{tag}: 체크리스트 항목 차이 (빠짐 {len(missing)}, 알 수 없음 {sorted(unknown)})")
            for r in rows:
                if r.item_id in reg.BY_ID and r.verify_status == "VERIFIED" and not _has_value(reg.BY_ID[r.item_id], {f: getattr(r, f) for f in CHECKLIST_FIELDS}):
                    P(f"{tag}: {r.item_id} 가 값 없이 검증 완료")
                if r.supply_status not in reg.SUPPLY or r.verify_status not in reg.VERIFY:
                    P(f"{tag}: {r.item_id} 상태값 오류")
            for res in case.results.all():
                if res.kind not in KINDS or len(res.inputs_hash) != 16:
                    P(f"{tag}: 결과 형식 오류 ({res.kind})")
            for m in case.measurements.all():
                for key, col in (("backPressure", "back_pressure"), ("loadFactor", "load_factor"), ("ambientTempC", "ambient_temp_c")):
                    v, spec = getattr(m, col), MEASUREMENT_FIELDS[key]
                    if v is not None and not spec["min"] <= v <= spec["max"]:
                        P(f"{tag}: 실측 D{m.day_offset} {key}={v} 범위 밖")
            for s in case.snapshots.all():
                if fields.clean_inputs(s.values)[1]:
                    notes.append(f"{tag}: 스냅샷 #{s.id} 입력이 현재 규격과 다름 (저장 당시 값 보존)")

        linked = set()
        for p in Paper.objects.all():
            linked.add(f"{p.file_sha256}.pdf")
            if not file_path(p).exists():
                P(f"업로드 문헌 #{p.id}: 원본 파일 없음")
            if p.status == "READY":
                chunks = list(p.chunks.all())
                bad = [c.idx for c in chunks if not c.vector or len(c.vector) != 1024 * 4]
                if not chunks or bad:
                    P(f"업로드 문헌 #{p.id}: 청크 {len(chunks)}개, 벡터 이상 {bad[:5]}")
        orphans = [f.name for f in UPLOAD_DIR.glob("*.pdf") if f.name not in linked] if UPLOAD_DIR.exists() else []
        if orphans:
            P(f"연결되지 않은 업로드 파일 {len(orphans)}개 (삭제하지 않음): {orphans[:3]}")

        st = official.get(load_model=False)
        if st["corpus"] is None:
            P(f"공식 corpus 없음: {st['error']}")
        else:
            meta = json.loads((OFFICIAL_DIR / "test_locked_meta.json").read_text(encoding="utf-8"))
            if meta["corpus_sha256"] != st["corpus_sha"]:
                P("공식 corpus 해시가 test 확정 기록과 다름 — recall 기록과 같은 자료가 아님")
            if st["vector"] == "unavailable":
                P(f"공식 벡터 파일 대조 실패: {st['vector_reason']}")
            q = official.QUESTIONS
            if hashlib.sha256(q.read_bytes()).hexdigest() != meta["eval_sha256"]:
                P("공식 평가 질문 파일 해시가 기록과 다름")
        v = DATA / "verify_locked.json"
        if not v.exists():
            notes.append("검색 재현 확인 기록 없음 (manage.py rag_verify 실행 권장)")
        else:
            r = json.loads(v.read_text(encoding="utf-8"))
            ok = r["bm25_match"] == r["hybrid_match"] == r["top8_match"] == r["questions"]
            (notes.append if ok else P)(f"검색 재현 확인: BM25 {r['bm25_match']}/{r['questions']}, 결합 {r['hybrid_match']}, 상위 8 {r['top8_match']} ({r['checked_at']})")

        n = EvaluationCase.objects.count()
        self.stdout.write(f"케이스 {n}개 · 업로드 문헌 {Paper.objects.count()}개 검사")
        for x in notes:
            self.stdout.write(f"  참고: {x}")
        for x in problems:
            self.stdout.write(f"  문제: {x}")
        self.stdout.write("결과: 문제 없음" if not problems else f"결과: 문제 {len(problems)}건")
        if problems:
            sys.exit(1)
