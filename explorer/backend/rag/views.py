import re

from django.db import transaction
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from cases.models import CalculationSnapshot, EvaluationCase
from system.errors import api_error

from . import answer as A
from accounts.policy import role_of
from notifications import engine as notify
from notifications.models import Notification

from . import context as ctx
from . import experiments, masking, template_qa
from . import official as O
from .models import AnswerFeedback, Conversation, ConversationMessage, EvidenceLabel, SystemConfiguration

MODES = ("bm25", "dense", "hybrid")
_HANGUL = re.compile(r"[가-힣]")


def _case(cid):
    try:
        return EvaluationCase.objects.get(pk=cid)
    except EvaluationCase.DoesNotExist:
        raise NotFound()


def _question(request, max_len=1000):
    q = (request.data.get("question") if isinstance(request.data, dict) else "") or ""
    q = str(q).strip()
    if not q:
        return None, api_error("VALIDATION_ERROR", 400, "질문을 입력하세요.", "Enter a question.", fields={"question": {"ko": "필수", "en": "Required"}})
    if len(q) > max_len:
        return None, api_error("VALIDATION_ERROR", 400, f"질문은 {max_len}자 이내로 입력하세요.", f"Keep the question under {max_len} characters.")
    return q, None


def _opt(request, key, allowed, default):
    v = request.data.get(key, default) if isinstance(request.data, dict) else default
    return v if v in allowed else default


def ai_state():
    enabled = bool(SystemConfiguration.read("ai_external_enabled"))
    return {"key_configured": bool(A.api_key()), "external_enabled": enabled, "model": A.model_name(),
            "ready": bool(A.api_key()) and enabled}


# ---------------------------------------------------------------- 검색
@api_view(["GET"])
def rag_info(request):
    full = {**O.info(), "ai": ai_state()}
    if role_of(request.user) == "AI_ADMIN":
        return Response(full)
    # 플랜트 엔지니어(챗봇): 답변 가능 여부·모델·문헌 수만 — 코퍼스 경로·해시·검색 가중치·평가 설정은 보내지 않음
    c = full["corpus"]
    return Response({"ai": {k: full["ai"][k] for k in ("ready", "model", "key_configured", "external_enabled")},
                     "vector": {"status": full["vector"]["status"]},
                     "corpus": None if c is None else {"documents": c["documents"], "passages": c["passages"]}})


def _evidence(r, mode):
    entries = r[mode]["final"] if r.get(mode) else []
    return [O.passage_payload(e["i"], {"rank": e["rank"], "bm25_rank": e["bm25_rank"], "dense_rank": e["dense_rank"],
                                       "bm25_score": e["bm25_score"], "cosine": e["cosine"], "rrf": e["rrf"]}) for e in entries]


def _search(question, mode, config):
    r = O.run(question, config)
    used = mode if r.get(mode) else "bm25"
    return r, used, _evidence(r, used)


@api_view(["POST"])
def rag_search(request):
    q, err = _question(request)
    if err:
        return err
    mode = _opt(request, "mode", MODES, "hybrid")
    config = _opt(request, "config", tuple(O.CONFIGS), "locked")
    try:
        r, used, ev = _search(q, mode, config)
    except RuntimeError as e:
        return api_error("SEARCH_UNAVAILABLE", 503, str(e), "Search is unavailable.")
    return Response({"mode": used, "requested_mode": mode, "config": config, "fallback_reason": r.get("fallback_reason") if used != mode else None,
                     "terms": r["terms"], "timing": r["timing"], "results": ev})


@api_view(["POST"])
def rag_compare(request):
    q, err = _question(request)
    if err:
        return err
    config = _opt(request, "config", tuple(O.CONFIGS), "locked")
    try:
        r = O.run(q, config)
    except RuntimeError as e:
        return api_error("SEARCH_UNAVAILABLE", 503, str(e), "Search is unavailable.")
    return Response({"config": config, "settings": O.CONFIGS[config], "terms": r["terms"], "timing": r["timing"],
                     "fallback_reason": r.get("fallback_reason"),
                     "modes": {m: None if not r.get(m) else {"results": _evidence(r, m), "candidates": r[m]["candidates"],
                                                              "skipped_by_cap": r[m]["skipped_by_cap"]} for m in MODES}})


# ---------------------------------------------------------------- 실험 기록
@api_view(["GET"])
def rag_experiments(request):
    return Response({**experiments.records(), "configs": O.CONFIGS})


@api_view(["POST"])
def rag_run_dev(request):
    config = _opt(request, "config", tuple(O.CONFIGS), None)
    if not config:
        return api_error("VALIDATION_ERROR", 400, "설정을 고르세요.", "Choose a config.")
    try:
        return Response(experiments.run_dev(config))
    except Exception as e:  # node 없음·임베딩 불가 등
        return api_error("EXPERIMENT_FAILED", 500, f"dev 실험을 실행하지 못했습니다 ({type(e).__name__}).", "Could not run the dev experiment.")


# ---------------------------------------------------------------- 대화
def _snapshot_lines(snap, lang):
    """계산 스냅샷 → AI 에 넘기는 서버 계산값 (DEMO 표시 포함). 값이 없으면 'not computed' 로 적습니다."""
    p, e = snap.results.get("performance"), snap.results.get("economics")

    def f(x):
        return "not computed" if x is None else x

    lines = [f"snapshot #{snap.id} ({snap.created_at:%Y-%m-%d %H:%M}), mode {snap.mode}, scenario {snap.scenario}, engine {snap.engine_version} — DEMO values, not plant measurements"]
    v = snap.values
    lines += [f"current back pressure = {v['currentBP']} mmH2O", f"baseline back pressure = {v['baselineBP']} mmH2O",
              f"stack temperature = {v['stackTempC']} °C", f"capacity = {v['capacityMW']} MW, load factor = {v['loadFactor']} %",
              f"SMP = {v['smpWonPerKWh']} KRW/kWh, target recovered output = {v['targetRecoveryMW']} MW"]
    if p:
        lines += [f"excess back pressure = {f(p['excessBP']['value'])} mmH2O", f"output loss (DEMO kit formula) = {f(p['lossMW']['value'])} MW",
                  f"monthly loss = {f(p['lossWonMonth']['value'])} KRW", f"cleaning-need index (DEMO heuristic) = {f(p['cleaningScore']['value'])}"]
    if e:
        for m in e["methods"]:
            lines.append(f"{m['name']['en']}: initial cost {f(m['initialCost']['value'])} KRW, monthly benefit {f(m['monthlyBenefit']['value'])} KRW, "
                         f"payback {f(m['paybackMonths']['value'])} months")
    return lines


def _notification_lines(case, nid):
    """'AI에게 설명 요청': 서버에 저장된 알림 내용(서버가 만든 문구)만 덧붙입니다. 다른 케이스의 알림이면 None."""
    n = Notification.objects.filter(pk=nid).first() if str(nid).isdigit() else None
    if not n or (n.case_id not in (None, case.id)):
        return None
    state = "resolved" if n.resolved_at else ("open" if n.kind == "STATE" else "event")
    return [f"notification [{n.severity}, {n.category}, {state}]: {n.title['en']} — {n.message['en']} "
            f"(source: {n.source}; {'DEMO data, not a real plant alarm' if n.is_demo else 'not DEMO'}; at {n.created_at:%Y-%m-%d %H:%M})"]


def _page_context(case, page, notification=None):
    """화면 맥락 줄 목록 (서버 DB 값) + 민감 식별정보 마스킹. 잘못된 page·알림은 None."""
    c = ctx.build(case, page)
    if c and notification:
        extra = _notification_lines(case, notification)
        if extra is None:
            return None
        c["lines"] = extra + c["lines"]
        c["notification"] = int(notification)
    if c:
        terms = SystemConfiguration.read("sensitive_terms") or []
        c["lines"] = [masking.mask(x, terms)[0] for x in c["lines"]]
    return c


@api_view(["GET"])
def ai_context(request, case_id):
    """질문 전에 화면에서 '무엇이 AI 에 함께 전달되는지' 미리 보여 주기 위한 조회."""
    c = _page_context(_case(case_id), request.query_params.get("page"), request.query_params.get("notification"))
    if not c:
        return api_error("VALIDATION_ERROR", 400, "지원하지 않는 화면입니다.", "Unsupported page.", fields={"page": {"ko": "가능한 값: " + ", ".join(ctx.PAGES), "en": "One of: " + ", ".join(ctx.PAGES)}})
    return Response(c)


def _conv_payload(c, with_messages=False):
    out = {"id": c.id, "case": c.case_id, "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at,
           "message_count": c.messages.count()}
    if with_messages:
        out["messages"] = [_msg_payload(m) for m in c.messages.all()]
    return out


# 챗봇(플랜트 엔지니어) 응답에 넣는 근거 필드 — 검색 점수·순위·용어 매핑·소요 시간·내부 설정은 빼고 출처와 문단만
EVIDENCE_FIELDS = ("i", "ref", "title", "authors", "year", "doi", "venue", "page", "kind", "text", "rank", "cited", "scope")
GENERATION_FIELDS = ("status", "model", "text", "citations", "warnings", "message", "lang")


def chat_payload(p):
    """대화 메시지 payload → 챗봇 화면용 (관리용 검색 디버그 정보 제거)"""
    if not isinstance(p, dict) or "evidence" not in p:
        return p
    out = {k: p[k] for k in ("mode", "requested_mode", "evidence", "generation", "lang", "snapshot", "context", "verification") if k in p}
    out["evidence"] = [{k: e[k] for k in EVIDENCE_FIELDS if k in e} for e in p.get("evidence", [])]
    out["generation"] = {k: v for k, v in (p.get("generation") or {}).items() if k in GENERATION_FIELDS}
    out["fallback_reason"] = "dense_unavailable" if p.get("fallback_reason") else None  # 내부 오류 문구 대신 사실만
    out["terms"] = []
    return out


def _msg_payload(m):
    fb = m.feedback.order_by("-id").first()
    return {"id": m.id, "role": m.role, "text": m.text, "payload": chat_payload(m.payload), "created_at": m.created_at,
            "feedback": None if not fb else {"rating": fb.rating, "comment": fb.comment}}


@api_view(["GET", "POST"])
def conversations(request, case_id):
    case = _case(case_id)
    if request.method == "GET":
        q = (request.query_params.get("q") or "").strip()
        qs = case.conversations.all()
        if q:
            qs = qs.filter(title__icontains=q) | qs.filter(messages__text__icontains=q)
        return Response([_conv_payload(c) for c in qs.distinct()])
    c = Conversation.objects.create(case=case, title=str((request.data or {}).get("title") or "")[:120])
    return Response(_conv_payload(c, True), status=201)


def _conv(cid):
    try:
        return Conversation.objects.get(pk=cid)
    except Conversation.DoesNotExist:
        raise NotFound()


@api_view(["GET", "PATCH", "DELETE"])
def conversation_detail(request, conv_id):
    c = _conv(conv_id)
    if request.method == "DELETE":
        c.delete()
        return Response(status=204)
    if request.method == "PATCH":
        c.title = str(request.data.get("title") or c.title)[:120]
        c.save()
    return Response(_conv_payload(c, True))


@api_view(["POST"])
def conversation_ask(request, conv_id):
    """질문 → 마스킹 → 로컬 검색(확정 설정) → (허용 시) Claude → 저장. 키가 없거나 꺼져 있으면 근거만 돌려줍니다."""
    c = _conv(conv_id)
    q, err = _question(request)
    if err:
        return err
    mode = _opt(request, "mode", MODES, "hybrid")
    lang = "ko" if _HANGUL.search(q) else "en"
    masked, findings = masking.mask(q, SystemConfiguration.read("sensitive_terms") or [])
    snap, calc_lines = None, None
    sid = request.data.get("snapshot_id")
    if sid:
        snap = CalculationSnapshot.objects.filter(pk=sid, case=c.case).first()
        if not snap:
            return api_error("NOT_FOUND", 404, "이 케이스의 스냅샷이 아닙니다.", "Snapshot not found for this case.")
        calc_lines = _snapshot_lines(snap, lang)
    page_ctx = None
    if request.data.get("context"):
        page_ctx = _page_context(c.case, request.data.get("context"), request.data.get("notification_id"))
        if not page_ctx:
            return api_error("VALIDATION_ERROR", 400, "지원하지 않는 화면입니다.", "Unsupported page.", fields={"context": {"ko": "가능한 값: " + ", ".join(ctx.PAGES), "en": "One of: " + ", ".join(ctx.PAGES)}})
        calc_lines = (calc_lines or []) + page_ctx["lines"]
    try:
        r, used, evidence = _search(q, mode, "locked")  # 검색은 로컬이라 원문으로 (외부 전송 없음)
    except RuntimeError as e:
        return api_error("SEARCH_UNAVAILABLE", 503, str(e), "Search is unavailable.")
    for e in evidence:
        e["scope"] = "OFFICIAL"
    include_uploads = bool(request.data.get("include_uploads"))
    if include_uploads:  # 업로드 범위(측정되지 않음) 상위 3개를 공식 근거 뒤에 덧붙임
        from knowledge import search as upload_search
        evidence += upload_search.search(q, 3)
    st = ai_state()
    if not evidence:
        gen = {"status": "no_passages"}
    elif not st["key_configured"]:
        gen = {"status": "not_configured"}
    elif not st["external_enabled"]:
        gen = {"status": "disabled"}
    else:
        gen = A.generate(masked, evidence, lang, calc_lines)
    notify.safe(notify.on_search, r.get("fallback_reason") if used != mode else None, used)
    notify.safe(notify.on_generation, gen)
    cited = set(gen.get("citations") or [])
    for n, e in enumerate(evidence, 1):
        e["cited"] = n in cited
    payload = {"mode": used, "requested_mode": mode, "fallback_reason": r.get("fallback_reason") if used != mode else None,
               "config": "locked", "include_uploads": include_uploads, "terms": r["terms"], "timing": r["timing"], "evidence": evidence, "generation": gen, "lang": lang,
               "snapshot": None if not snap else {"id": snap.id, "label": snap.label, "created_at": snap.created_at.isoformat(), "lines": _snapshot_lines(snap, lang)},
               "context": page_ctx,
               "verification": {"kind": "AUTOMATIC", "note": {"ko": "자동 검토 결과입니다 (사람 검토 아님).", "en": "Automatic check, not human review."}}}
    with transaction.atomic():
        user = ConversationMessage.objects.create(conversation=c, role="user", text=masked,
                                                  payload={"masking": findings, "snapshot_id": snap.id if snap else None,
                                                           "context": page_ctx["page"] if page_ctx else None})
        bot = ConversationMessage.objects.create(conversation=c, role="assistant", text=gen.get("text", ""), payload=payload)
        if not c.title:
            c.title = masked[:60]
        c.save()
    return Response({"user": _msg_payload(user), "assistant": _msg_payload(bot)}, status=201)


@api_view(["POST"])
def message_feedback(request, msg_id):
    try:
        m = ConversationMessage.objects.get(pk=msg_id, role="assistant")
    except ConversationMessage.DoesNotExist:
        raise NotFound()
    rating = request.data.get("rating")
    if rating not in ("up", "down"):
        return api_error("VALIDATION_ERROR", 400, "평가는 up 또는 down 입니다.", "Rating must be up or down.")
    AnswerFeedback.objects.create(message=m, rating=rating, comment=str(request.data.get("comment") or "")[:1000])
    return Response(_msg_payload(m), status=201)


@api_view(["GET"])
def feedback_export(request):
    """사람 피드백 → 평가셋 v2 후보 (공식 평가셋 파일은 건드리지 않음)."""
    out = []
    for fb in AnswerFeedback.objects.select_related("message").order_by("id"):
        bot = fb.message
        user = bot.conversation.messages.filter(role="user", id__lt=bot.id).order_by("-id").first()
        out.append({"question": user.text if user else None, "rating": fb.rating, "comment": fb.comment,
                    "answer_status": bot.payload.get("generation", {}).get("status"),
                    "evidence": [{"ref": e["ref"], "page": e["page"], "i": e["i"], "cited": e.get("cited")} for e in bot.payload.get("evidence", [])],
                    "created_at": fb.created_at.isoformat()})
    return Response({"format": "hrsg-eval-v2-candidates", "note": "사람 검토 전 후보입니다. 공식 평가셋 v1 과 섞지 마세요.", "items": out})


@api_view(["POST"])
def case_template_question(request, case_id):
    q, err = _question(request, 500)
    if err:
        return err
    lang = "ko" if _HANGUL.search(q) else "en"
    return Response(template_qa.answer(_case(case_id), q, lang))


# ---------------------------------------------------------------- 정답 라벨 (평가셋 v2 준비)
LABEL_FIELDS = ("question", "lang", "expected_refs", "evidence", "reviewer", "status", "memo")


def _label_payload(l):
    return {f: getattr(l, f) for f in ("id", *LABEL_FIELDS, "created_at", "updated_at")}


@api_view(["GET", "POST"])
def labels(request):
    if request.method == "GET":
        return Response([_label_payload(l) for l in EvidenceLabel.objects.all()])
    data = {k: request.data.get(k) for k in LABEL_FIELDS if k in request.data}
    if not str(data.get("question") or "").strip():
        return api_error("VALIDATION_ERROR", 400, "질문을 입력하세요.", "Enter a question.")
    if data.get("status", "DRAFT") not in ("DRAFT", "REVIEWED", "APPROVED"):
        return api_error("VALIDATION_ERROR", 400, "알 수 없는 상태입니다.", "Unknown status.")
    refs = O.get(load_model=False)["corpus"]["refs"]
    bad = [r for r in data.get("expected_refs") or [] if r not in refs]
    if bad:
        return api_error("VALIDATION_ERROR", 400, f"corpus 에 없는 문헌: {', '.join(bad)}", "Unknown reference(s).")
    return Response(_label_payload(EvidenceLabel.objects.create(**data)), status=201)


@api_view(["PATCH", "DELETE"])
def label_detail(request, label_id):
    try:
        l = EvidenceLabel.objects.get(pk=label_id)
    except EvidenceLabel.DoesNotExist:
        raise NotFound()
    if request.method == "DELETE":
        l.delete()
        return Response(status=204)
    for k in LABEL_FIELDS:
        if k in request.data:
            setattr(l, k, request.data[k])
    if l.status not in ("DRAFT", "REVIEWED", "APPROVED"):
        return api_error("VALIDATION_ERROR", 400, "알 수 없는 상태입니다.", "Unknown status.")
    l.save()
    return Response(_label_payload(l))


# ---------------------------------------------------------------- 지식베이스 (공식 corpus 조회)
@api_view(["GET"])
def kb_papers(request):
    st = O.get(load_model=False)
    c = st["corpus"]
    if c is None:
        return api_error("SEARCH_UNAVAILABLE", 503, st["error"], "Corpus unavailable.")
    counts, kinds = {}, {}
    for p in c["passages"]:
        counts[p["ref"]] = counts.get(p["ref"], 0) + 1
        kinds.setdefault(p["ref"], set()).add(p["kind"])
    embedded = st["P"] is not None
    return Response({"papers": [{"ref": k, **r, "chunks": counts.get(k, 0), "kinds": sorted(kinds.get(k, [])),
                                 "embedding": "EMBEDDED" if embedded else "MISSING", "scope": "OFFICIAL", "version": "v1"}
                                for k, r in c["refs"].items()],
                     "index": {"documents": len(c["refs"]), "chunks": len(c["passages"]), "corpus_sha256": st["corpus_sha"][:12],
                               "vectors": None if st["P"] is None else list(st["P"].shape),
                               "embedding_created_at": (st.get("meta") or {}).get("created_at"),
                               "model": (st.get("meta") or {}).get("settings", {}).get("model"),
                               "revision": ((st.get("meta") or {}).get("settings", {}).get("revision") or "")[:8],
                               "vector_status": st["vector"], "vector_reason": st["vector_reason"]},
                     "readonly": True,
                     "note": {"ko": "공식 평가셋 corpus 는 읽기 전용입니다 (수정·삭제·원본 PDF 다운로드 없음). 새 문헌은 아래 업로드로 별도 범위에 추가합니다.",
                              "en": "The official corpus is read-only (no edits, deletion or PDF download). New documents go to a separate upload scope below."}})


@api_view(["GET"])
def kb_chunks(request):
    st = O.get(load_model=False)
    ref = request.query_params.get("ref")
    if st["corpus"] is None or ref not in st["corpus"]["refs"]:
        raise NotFound()
    return Response([O.passage_payload(i) for i, p in enumerate(st["corpus"]["passages"]) if p["ref"] == ref])


# ---------------------------------------------------------------- 설정
@api_view(["GET", "PATCH"])
def app_settings(request):
    if request.method == "PATCH":
        if "ai_external_enabled" in request.data:
            if not isinstance(request.data["ai_external_enabled"], bool):
                return api_error("VALIDATION_ERROR", 400, "참/거짓 값이어야 합니다.", "Must be true/false.")
            SystemConfiguration.write("ai_external_enabled", request.data["ai_external_enabled"])
        if "sensitive_terms" in request.data:
            terms = request.data["sensitive_terms"]
            if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
                return api_error("VALIDATION_ERROR", 400, "문자열 목록이어야 합니다.", "Must be a list of strings.")
            SystemConfiguration.write("sensitive_terms", sorted({t.strip()[:80] for t in terms if t.strip()}))
    return Response({"ai": ai_state(), "sensitive_terms": SystemConfiguration.read("sensitive_terms") or [],
                     "search": {"configs": O.CONFIGS, "default": "locked"}})
