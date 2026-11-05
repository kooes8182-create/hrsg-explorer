"""알림 규칙. 실제 저장된 값(입력·계산 결과·체크리스트·실측값·검색 상태)에서만 알림을 만듭니다.

- 상태형(STATE): sync_case()/sync_system() 이 '지금 참인 조건' 목록을 만들고, DB 의 미해결 알림과 비교해
  새 조건은 만들고(raise), 사라진 조건은 해결 처리(resolve, 필요하면 복구 사건 기록)합니다. 같은 조건이 이어지는 동안 새로 만들지 않습니다.
- 사건형(EVENT): 계산 완료·저장·수급 변경처럼 API 가 성공한 시점에 event() 로 한 번 기록합니다.
승인된 운전 한계값이 없으므로 '경보 판정'을 만들지 않습니다. 배압은 공개 참고 범위와의 비교, 운전 상태는 DEMO 시나리오 라벨입니다.
"""

import zlib

from django.db import connection, transaction
from django.utils import timezone

from cases import checklist_registry as reg
from cases import services as S

from .models import Notification


def msg(ko, en):
    return {"ko": ko, "en": en}


def _d(ko, en, value):
    """알림 상세의 '관련 수치·기준값' 한 줄"""
    return {"label": msg(ko, en), "value": str(value)}


# ---------------------------------------------------------------- 기본 동작
def _lock(case, key):
    """같은 (케이스, 알림 키)의 '확인 후 생성'을 한 번에 하나씩만 (동시에 들어온 조회가 각각 만들어 중복되는 것 방지).
    PostgreSQL advisory lock — 트랜잭션이 끝나면 자동으로 풀립니다."""
    with connection.cursor() as c:
        c.execute("SELECT pg_advisory_xact_lock(%s)", [zlib.crc32(f"{case.id if case else 0}:{key}".encode())])


@transaction.atomic
def raise_state(case, key, *, category, severity, title, message, source, is_demo=False, route="", item="", data=None):
    """미해결 상태 알림이 없으면 만들고, 있으면 내용만 갱신합니다 (중복 생성 없음). 심각도가 바뀌면 새 알림."""
    _lock(case, key)
    # 가장 먼저 생긴 1건을 갱신 (목록도 같은 1건을 보여 줌 — 예전 중복 행이 남아 있어도 같은 행)
    cur = Notification.objects.filter(case=case, kind="STATE", event_key=key, resolved_at__isnull=True).order_by("created_at", "id").first()
    if cur and cur.severity == severity:
        changed = cur.message != message or cur.title != title or cur.target_route != route or cur.target_item_id != item or cur.data != (data or [])
        if changed:
            cur.title, cur.message, cur.target_route, cur.target_item_id, cur.data = title, message, route, item, data or []
            cur.save(update_fields=["title", "message", "target_route", "target_item_id", "data"])
        return None
    if cur:
        cur.resolved_at = timezone.now()
        cur.save(update_fields=["resolved_at"])
    return Notification.objects.create(case=case, kind="STATE", event_key=key, category=category, severity=severity, title=title,
                                       message=message, source=source, is_demo=is_demo, target_route=route, target_item_id=item, data=data or [])


@transaction.atomic
def resolve_state(case, key, recovery=None):
    """미해결 상태 알림을 해결 처리합니다. recovery = 복구 사건으로 남길 내용(dict) 또는 None."""
    _lock(case, key)
    n = Notification.objects.filter(case=case, kind="STATE", event_key=key, resolved_at__isnull=True).update(resolved_at=timezone.now())
    if n and recovery:
        event(case, f"{key}:recovered:{timezone.now().timestamp():.0f}", dedup=False, **recovery)
    return n


@transaction.atomic
def event(case, key, *, dedup=True, category, severity, title, message, source, is_demo=False, route="", item="", created_at=None, data=None):
    """사건 기록. dedup=True 면 같은 key 가 이미 있으면 다시 만들지 않습니다 (예: 같은 입력으로 다시 계산)."""
    _lock(case, key)
    if dedup and Notification.objects.filter(case=case, kind="EVENT", event_key=key).exists():
        return None
    return Notification.objects.create(case=case, kind="EVENT", event_key=key, category=category, severity=severity, title=title,
                                       message=message, source=source, is_demo=is_demo, target_route=route, target_item_id=item, data=data or [],
                                       **({"created_at": created_at} if created_at else {}))


def _sync(case, desired, families):
    """desired = {key: raise_state 인자}, families = {접두어: 해결 시 복구 사건을 돌려주는 함수(n, desired) 또는 None}."""
    for key, spec in desired.items():
        raise_state(case, key, **spec)
    open_ = Notification.objects.filter(case=case, kind="STATE", resolved_at__isnull=True)
    for n in open_:
        fam = next((f for f in families if n.event_key == f or n.event_key.startswith(f + ".")), None)
        if fam is None or n.event_key in desired:
            continue
        rec = families[fam]
        resolve_state(case, n.event_key, rec(n, desired) if rec else None)


# ---------------------------------------------------------------- 케이스 상태 규칙
_STATUS_LABEL = {"ALARM": msg("주의 — 오염 진행", "Caution — fouling building up"), "TRIP": msg("위험 — 세정 필요", "Danger — cleaning needed")}


def _case_rules(case):
    ci = S.get_input(case)
    demo = ci.mode == "DEMO"
    src_calc = "DEMO 계산 엔진" if demo else "사용자 입력 계산"
    res = S.results(case)["results"]
    desired, families = {}, {}

    # 계산·분석: 저장된 결과와 현재 입력 불일치
    # 세정 전후 비교(comparison)는 대시보드·세정 전후 화면이 열릴 때 자동으로 다시 계산되므로 제외 (overview 의 재평가 기준과 같음)
    stale = sorted(k for k, r in res.items() if r["stale"] and k != "comparison")
    v = ci.values
    families["calc.stale"] = None
    if stale:
        desired["calc.stale"] = dict(category="CALC", severity="WARNING", is_demo=demo, source=f"{src_calc} · 입력 비교", route="/simulation",
                                     data=[_d("재평가 필요 결과", "Stale results", ", ".join(stale)), _d("현재 배압 입력", "Current BP input", f"{v.get('currentBP')} mmH₂O")],
                                     title=msg("재평가 필요 — 저장된 결과와 현재 입력 불일치", "Re-evaluation needed — results differ from current inputs"),
                                     message=msg(f"입력이 바뀌어 이전 결과({', '.join(stale)})는 현재 값이 아닙니다. 계산을 다시 실행하세요.",
                                                 f"Inputs changed; previous results ({', '.join(stale)}) are not current. Run the calculation again."))

    # 운전 상태: 최신(재평가 불필요) 성능 결과가 있을 때만 판단. 재평가가 필요하면 기존 알림을 그대로 둡니다 (알 수 없음).
    perf = res.get("performance")
    if perf and not perf["stale"]:
        p = perf["payload"]
        # 경보→트립처럼 다른 상태로 바뀌면 새 상태 알림이 '변경'을 알리므로, 정상으로 돌아올 때만 복구 사건을 남깁니다.
        families["op.status"] = lambda n, d: None if any(k.startswith("op.status.") for k in d) else dict(category="OPERATION", severity="INFO", is_demo=True, source="DEMO 시나리오", route="/simulation",
                                               title=msg("DEMO 시나리오 상태 변경 — 정상", "DEMO scenario state changed — normal"),
                                               message=msg("가상 시나리오 상태가 정상으로 바뀌었습니다 (실제 설비 경보 아님).", "The virtual scenario state is now normal (not a real plant alarm)."))
        code = (p.get("status") or {}).get("code")
        if code in _STATUS_LABEL and demo:
            label = _STATUS_LABEL[code]
            desired[f"op.status.{code}"] = dict(
                category="OPERATION", severity="CRITICAL" if code == "TRIP" else "WARNING", is_demo=True, source="DEMO 시나리오", route="/simulation",
                data=[_d("시나리오 상태", "Scenario state", code), _d("현재 배압", "Current BP", f"{(p.get('currentBP') or {}).get('value')} mmH₂O"),
                      _d("기준 배압", "Baseline BP", f"{(p.get('baselineBP') or {}).get('value')} mmH₂O")],
                title=msg(f"DEMO 시나리오 상태: {label['ko']} (가상)", f"DEMO scenario state: {label['en']} (virtual)"),
                message=msg("DEMO 시나리오에 지정된 상태입니다. 임계값 판정이나 실제 설비 경보가 아닙니다.",
                            "Assigned by the DEMO scenario — not a threshold judgment or a real plant alarm."))
        families["op.bp_ref"] = lambda n, d: dict(category="OPERATION", severity="INFO", is_demo=n.is_demo, source=n.source, route="/simulation",
                                               title=msg("배압이 공개 참고 세정 기준 이내로 돌아옴", "Back pressure back within the public reference"),
                                               message=msg("현재 입력 기준 배압 증가분이 공개 참고 범위 아래입니다 (판정 아님).", "Excess back pressure is below the public reference (not a judgment)."))
        band = p.get("referenceBand") or {}
        if band.get("position") == "ABOVE":
            ex = (p.get("excessBP") or {}).get("value")
            desired["op.bp_ref"] = dict(
                category="OPERATION", severity="WARNING", is_demo=demo, source=f"{src_calc} · 공개 참고(POWER 2015)", route="/simulation", item="in-currentBP",
                data=[_d("현재 배압", "Current BP", f"{(p.get('currentBP') or {}).get('value')} mmH₂O"), _d("기준 배압", "Baseline BP", f"{(p.get('baselineBP') or {}).get('value')} mmH₂O"),
                      _d("초과 배압", "Excess BP", f"{ex} mmH₂O ({(p.get('excessBP_inH2O') or {}).get('value')} inH₂O)"),
                      _d("공개 참고 범위", "Public reference", "+3~4 inH₂O (≈ +76~102 mmH₂O, 판정 아님)")],
                title=msg("배압이 공개 참고 세정 기준보다 높음", "Back pressure above the public cleaning reference"),
                message=msg(f"기준 대비 +{ex} mmH₂O — 공개 사례의 참고 범위(청정 대비 3~4 inH₂O)보다 큽니다. 승인된 운전 한계가 아니므로 판정이 아닙니다.",
                            f"+{ex} mmH₂O over baseline — above the public rule of thumb (3–4 inH₂O over clean). Not an approved limit, so not a judgment."))
    comp = res.get("comparison")
    if comp and not comp["stale"]:
        families["op.deviation"] = None
        if comp["payload"].get("deviation"):
            desired["op.deviation"] = dict(
                category="OPERATION", severity="WARNING", is_demo=False, source="사용자 실측값 비교", route="/before-after",
                title=msg("세정 전후 운전 조건 편차", "Operating-condition deviation before/after cleaning"),
                message=msg("세정 전후 실측의 부하율(>5%p) 또는 외기 온도(>5 °C) 차이가 커서 직접 비교가 어렵습니다.",
                            "Load (>5 pp) or ambient (>5 °C) differs between measurements, so a direct comparison is unreliable."))

    # 데이터 관리
    rows = list(case.checklist.all())
    sm = S.checklist_summary(rows)
    families["data.missing_required"] = lambda n, d: dict(category="DATA", severity="SUCCESS", source="데이터 요청 체크리스트", route="/checklist",
                                                       title=msg("필수 데이터 충족", "Required data complete"),
                                                       message=msg("필수 항목이 모두 수령되었습니다.", "All required items have been received."))
    if sm["missingRequired"]:
        ids = sm["missingRequired"]
        desired["data.missing_required"] = dict(
            category="DATA", severity="WARNING", source="데이터 요청 체크리스트", route=f"/checklist?item={ids[0]}", item=ids[0],
            data=[_d("미수신 필수", "Missing required", f"{len(ids)} / {sm['requiredCount']}"), _d("항목", "Items", ", ".join(ids[:12]) + (" …" if len(ids) > 12 else ""))],
            title=msg(f"필수 데이터 {len(ids)}개 미수신", f"{len(ids)} required items not received"),
            message=msg(f"{', '.join(ids[:5])}{' 외' if len(ids) > 5 else ''} — 받기 전에는 DEMO 값으로 계산합니다.",
                        f"{', '.join(ids[:5])}{' …' if len(ids) > 5 else ''} — DEMO values are used until received."))
    check = [r.item_id for r in rows if r.supply_status == "NEEDS_CHECK" or r.verify_status == "FAILED"]
    families["data.needs_check"] = lambda n, d: dict(category="DATA", severity="SUCCESS", source="데이터 요청 체크리스트", route="/checklist",
                                                  title=msg("데이터 검증 필요 항목 없음", "No items need verification"),
                                                  message=msg("검증 필요·검증 실패 항목이 모두 정리되었습니다.", "All needs-check / failed items are cleared."))
    if check:
        desired["data.needs_check"] = dict(
            category="DATA", severity="WARNING", source="데이터 요청 체크리스트", route=f"/checklist?item={check[0]}", item=check[0],
            data=[_d("검증 필요·실패", "Needs check / failed", str(len(check))), _d("항목", "Items", ", ".join(check[:12]))],
            title=msg(f"데이터 검증 필요 {len(check)}개", f"{len(check)} items need verification"),
            message=msg(f"{', '.join(check[:5])}{' 외' if len(check) > 5 else ''} — 값·단위·측정 조건을 확인하세요.",
                        f"{', '.join(check[:5])}{' …' if len(check) > 5 else ''} — check value, unit and conditions."))
    return desired, families


@transaction.atomic
def sync_case(case):
    desired, families = _case_rules(case)
    _sync(case, desired, families)


# ---------------------------------------------------------------- 시스템 상태 규칙 (case = None)
def sync_system():
    from rag import official

    st = official.get(load_model=False)
    if st["corpus"] is not None and st["vector"] == "unavailable":
        raise_state(None, "sys.embedding", category="SYSTEM", severity="WARNING", source="검색 서비스 (BGE-M3)", route="/rag-evaluation",
                    title=msg("임베딩(의미 검색) 서비스 사용 불가", "Embedding (dense search) unavailable"),
                    message=msg(f"BGE-M3 를 쓸 수 없어 BM25 로만 검색합니다. 사유: {st['vector_reason']}", "Dense search is unavailable; BM25 only."))
    elif st["corpus"] is not None and st["vector"] == "ready":
        resolve_state(None, "sys.embedding", dict(category="SYSTEM", severity="SUCCESS", source="검색 서비스 (BGE-M3)", route="/rag-evaluation",
                                                  title=msg("임베딩 서비스 연결 복구", "Embedding service restored"),
                                                  message=msg("의미 검색(BGE-M3)을 다시 사용할 수 있습니다.", "Dense search is available again.")))


# ---------------------------------------------------------------- 사건 (API 성공 시점)
def on_evaluated(case, kinds, prev_score):
    ci = S.get_input(case)
    demo = ci.mode == "DEMO"
    h = S.current_hash(ci)
    resolve_state(case, "calc.failed")
    event(case, f"calc.done:{h}:{','.join(sorted(kinds))}", category="CALC", severity="INFO", is_demo=demo,
          source="DEMO 계산 엔진" if demo else "사용자 입력 계산", route="/simulation",
          title=msg("계산 완료", "Calculation complete"), message=msg(f"현재 입력으로 {', '.join(kinds)} 계산을 마쳤습니다.", f"Computed {', '.join(kinds)} for the current inputs."))
    perf = case.results.filter(kind="performance").first()
    new = ((perf.payload.get("cleaningScore") or {}).get("value")) if perf else None
    if prev_score is not None and new is not None and new > prev_score:
        event(case, f"op.cleaning_up:{h}", category="OPERATION", severity="INFO", is_demo=True, source="DEMO 휴리스틱 지표", route="/dashboard",
              title=msg("세정 필요도 참고 지표 상승", "Cleaning-need index increased"),
              message=msg(f"{prev_score} → {new} (DEMO 휴리스틱, 실제 세정 판정 기준 아님)", f"{prev_score} → {new} (DEMO heuristic, not a real criterion)"))
    sync_case(case)


def on_calc_failed(case, fields, where):
    names = ", ".join(sorted(fields))[:200] or "-"
    raise_state(case, "calc.failed", category="CALC", severity="WARNING", source=where, route="/simulation", item=f"in-{sorted(fields)[0]}" if fields else "",
                data=[_d("오류 입력 항목", "Invalid fields", names), _d("검사 위치", "Checked by", where)],
                title=msg("계산 실패 — 입력값 확인 필요", "Calculation failed — check inputs"),
                message=msg(f"입력값 오류로 계산하지 못했습니다: {names}", f"Could not calculate because of invalid inputs: {names}"))


def on_checklist_changed(case, before, after):
    """수급 상태가 바뀐 항목만 사건으로 남깁니다 (같은 요청의 여러 항목은 1건)."""
    changed = [(i, before.get(i), s) for i, s in after.items() if before.get(i) != s]
    if changed:
        lab = reg.SUPPLY_LABELS
        ko = ", ".join(f"{i} {lab[b]['ko']}→{lab[a]['ko']}" for i, b, a in changed[:5])
        en = ", ".join(f"{i} {lab[b]['en']}→{lab[a]['en']}" for i, b, a in changed[:5])
        more = len(changed) - 5
        event(case, f"data.supply_change:{timezone.now().timestamp()}", dedup=False, category="DATA", severity="INFO", source="데이터 요청 체크리스트",
              route=f"/checklist?item={changed[0][0]}", item=changed[0][0],
              title=msg(f"체크리스트 수급 상태 변경 {len(changed)}건", f"Checklist supply status changed ({len(changed)})"),
              message=msg(ko + (f" 외 {more}건" if more > 0 else ""), en + (f" +{more}" if more > 0 else "")))
    sync_case(case)


def on_snapshot(case, snap):
    event(case, f"calc.snapshot:{snap.id}", category="CALC", severity="INFO", is_demo=snap.mode == "DEMO", source="계산 스냅샷", route="/simulation",
          title=msg("분석 결과 저장 완료", "Result saved"), message=msg(f"스냅샷 #{snap.id} {snap.label}".strip(), f"Snapshot #{snap.id} {snap.label}".strip()))


def on_search(fallback_reason, mode_used):
    if fallback_reason:
        raise_state(None, "sys.bm25_fallback", category="SYSTEM", severity="WARNING", source="검색 서비스", route="/ai-assistant",
                    title=msg("BM25 대체 검색 사용 중", "BM25 fallback active"),
                    message=msg(f"의미 검색을 쓸 수 없어 BM25 로 검색했습니다: {fallback_reason}", "Dense search was unavailable; BM25 was used instead."))
    elif mode_used in ("dense", "hybrid"):
        resolve_state(None, "sys.bm25_fallback", dict(category="SYSTEM", severity="SUCCESS", source="검색 서비스", route="/ai-assistant",
                                                      title=msg("의미 검색 복구", "Dense search restored"), message=msg("Hybrid/Dense 검색이 다시 동작합니다.", "Hybrid/dense search works again.")))


def on_generation(gen):
    if gen.get("status") == "error":
        raise_state(None, "sys.llm", category="SYSTEM", severity="WARNING", source="Claude API (Anthropic)", route="/ai-assistant",
                    title=msg("Claude API 오류", "Claude API error"),
                    message=msg(f"답변 생성에 실패했습니다 (근거 문단은 제공). {gen.get('message') or ''}".strip(), "Answer generation failed (evidence still shown)."))
    elif gen.get("status") == "ok":
        resolve_state(None, "sys.llm", dict(category="SYSTEM", severity="SUCCESS", source="Claude API (Anthropic)", route="/ai-assistant",
                                               title=msg("Claude API 정상 응답", "Claude API responding"), message=msg("답변 생성이 다시 동작합니다.", "Answer generation works again.")))


# ---------------------------------------------------------------- 브라우저가 감지한 사건 (서버가 기록할 수 없던 동안의 일)
def on_outage(kind, since, until):
    """서버·DB 연결이 끊겼던 구간을 복구 뒤에 기록합니다 (끊긴 동안에는 서버에 쓸 수 없음)."""
    title = msg("서버 연결 끊김", "Server unreachable") if kind == "server_down" else msg("데이터베이스 연결 실패", "Database connection failed")
    a, b = timezone.localtime(since), timezone.localtime(until)
    n = Notification.objects.create(case=None, kind="STATE", event_key=f"sys.{kind}:{since.timestamp():.0f}", category="SYSTEM", severity="CRITICAL",
                                    title=title, message=msg(f"{a:%m-%d %H:%M:%S} ~ {b:%H:%M:%S} 동안 연결되지 않았습니다 (30초 간격 점검).",
                                                             f"No connection from {a:%m-%d %H:%M:%S} to {b:%H:%M:%S} (30-second checks)."),
                                    source="연결 점검 (/api/health/)", created_at=since, resolved_at=until, target_route="/ai-assistant")
    event(None, f"sys.{kind}:{since.timestamp():.0f}:recovered", category="SYSTEM", severity="SUCCESS", source="연결 점검 (/api/health/)", route="/ai-assistant",
          title=msg("서버 연결 복구", "Server connection restored") if kind == "server_down" else msg("데이터베이스 연결 복구", "Database connection restored"),
          message=msg("연결이 다시 정상입니다.", "The connection is back to normal."), created_at=until)
    return n


def on_autosave(case, ok, where=""):
    if ok:
        resolve_state(case, "sys.autosave", dict(category="SYSTEM", severity="SUCCESS", source="자동 저장", route="",
                                                 title=msg("자동 저장 복구", "Autosave restored"), message=msg("저장이 다시 정상입니다.", "Saving works again.")))
    else:
        raise_state(case, "sys.autosave", category="SYSTEM", severity="WARNING", source="자동 저장", route=where,
                    title=msg("자동 저장 실패", "Autosave failed"), message=msg("변경 내용을 서버에 저장하지 못했습니다. 화면은 서버 값으로 되돌렸습니다.",
                                                                                 "Could not save changes; the screen was reset to server values."))


def safe(fn, *args):
    """알림 기록이 실패해도 본 작업(저장·계산·검색)은 막지 않습니다."""
    import logging

    try:
        return fn(*args)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("notification failed")
        return None
