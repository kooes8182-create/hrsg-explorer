"""API 권한표 (한곳에서 관리). URL 이름 × HTTP 메서드 → 허용 역할.

- 표에 없는 API·메서드는 **아무도 쓸 수 없습니다** (기본 거부, 403 NOT_CLASSIFIED).
- 로그인하지 않은 요청은 401, 로그인했지만 역할이 맞지 않으면 403.
- 역할은 서버의 UserProfile 에서만 읽습니다 (요청 파라미터·브라우저 값은 쓰지 않음).
- AI 관리자는 RAG 자료·평가 결과 '조회' 역할입니다. 업로드·삭제·재처리·재임베딩·새 평가 실행·정답 수정·시스템 설정 변경은
  BLOCKED 로 두어 어떤 역할에도 열지 않았습니다 (기능 코드는 남겨 둠).
"""

from django.http import JsonResponse
from rest_framework.permissions import BasePermission

PE, AA, PUBLIC = "PLANT_ENGINEER", "AI_ADMIN", "PUBLIC"
P, A, AUTH = {PE}, {AA}, {PE, AA}
BLOCKED = frozenset()  # 표에 적어 두되 아무 역할도 허용하지 않음 (보고용으로 이유를 남김)

POLICY = {
    # ---- 공개 · 공통
    "health": {"GET": {PUBLIC}},
    "auth-me": {"GET": {PUBLIC}},
    "auth-login": {"POST": {PUBLIC}},
    "auth-logout": {"POST": {PUBLIC}},
    # ---- 플랜트: 케이스·입력·계산
    "case-list": {"GET": P, "POST": P},
    "case-detail": {"GET": P, "PATCH": P, "DELETE": P},
    "case-clone": {"POST": P},
    "case-overview": {"GET": P},
    "input-schema": {"GET": P},
    "case-inputs": {"GET": P, "PUT": P},
    "inputs-reset": {"POST": P},
    "evaluate": {"POST": P},
    "case-results": {"GET": P},
    "snapshots": {"GET": P, "POST": P},
    "snapshot-detail": {"GET": P},
    "snapshot-restore": {"POST": P},
    # ---- 플랜트: 체크리스트·사진·실측
    "checklist": {"GET": P, "PATCH": P},
    "checklist-export": {"GET": P},
    "checklist-import": {"POST": P},
    "checklist-template": {"GET": P},
    "checklist-request-text": {"POST": P},
    "checklist-attachments": {"GET": P, "POST": P},
    "attachment-detail": {"DELETE": P},
    "attachment-file": {"GET": P},
    "measurements": {"GET": P, "POST": P},
    "measurement-detail": {"PATCH": P, "DELETE": P},
    # ---- 플랜트: 참고 자료
    "public-smp": {"GET": P},
    "public-sources": {"GET": P},
    "glossary": {"GET": P},
    # ---- 플랜트: AI 엔지니어링 도우미 (질문·답변만 — 관리 API 와 분리, 응답에서 검색 디버그 정보 제거)
    "conversations": {"GET": P, "POST": P},
    "conversation-detail": {"GET": P, "PATCH": P, "DELETE": P},
    "conversation-ask": {"POST": P},
    "message-feedback": {"POST": P},
    "ai-context": {"GET": P},
    "case-questions": {"POST": P},
    # ---- 플랜트: 알림
    "notifications": {"GET": P},
    "notifications-read-all": {"POST": P},
    "notifications-client-event": {"POST": P},
    "notification-read": {"POST": P},
    # ---- 공통: 검색·AI 상태 (플랜트에는 상태만, 관리자에는 설정까지 — rag_info 에서 역할별로 거름)
    "rag-info": {"GET": AUTH},
    # ---- AI 관리자: RAG 조회
    "rag-experiments": {"GET": A},          # 저장된 평가 결과 조회 (새로 계산하지 않음)
    "rag-compare": {"POST": A},             # 질문 1개 검색 비교 (읽기 전용 검색, 저장 없음)
    "rag-search": {"POST": A},
    "rag-labels": {"GET": A, "POST": BLOCKED},          # 평가 정답 조회만 / 추가 차단
    "rag-label-detail": {"PATCH": BLOCKED, "DELETE": BLOCKED},
    "rag-feedback-export": {"GET": A},
    "rag-run-dev": {"POST": BLOCKED},                    # 새 평가 실행 차단
    "kb-papers": {"GET": A},
    "kb-chunks": {"GET": A},
    "kb-uploads": {"GET": A, "POST": BLOCKED},           # 업로드 문헌 조회만 / PDF 업로드 차단
    "kb-upload-detail": {"GET": A, "PATCH": BLOCKED, "DELETE": BLOCKED},
    "kb-upload-chunks": {"GET": A},
    "kb-upload-reprocess": {"POST": BLOCKED},
    "kb-upload-reembed": {"POST": BLOCKED},              # 재임베딩(모델 계산) 차단
    "kb-upload-search": {"POST": A},
    "kb-jobs": {"GET": A},
    "kb-reindex": {"POST": BLOCKED},
    # ---- 시스템 설정 (외부 AI 전송·민감어 목록): 이번 메뉴 범위에 없어 화면·API 모두 차단 — 운영자는 manage.py ai_settings 사용
    "app-settings": {"GET": BLOCKED, "PATCH": BLOCKED},
}


def role_of(user):
    """서버에 저장된 역할. 로그인 안 함·비활성·역할 없음(superuser 포함) → None"""
    if not user or not user.is_authenticated or not user.is_active:
        return None
    prof = getattr(user, "profile", None)
    return prof.role if prof else None


def allowed(url_name, method, user):
    """→ 'ok' | 'unauthenticated' | 'forbidden' | 'unclassified'"""
    method = "GET" if method in ("HEAD", "OPTIONS") else method
    rule = POLICY.get(url_name, {}).get(method)
    if rule is None:
        return "unclassified"
    if PUBLIC in rule:
        return "ok"
    role = role_of(user)
    if role is None:
        return "unauthenticated" if not (user and user.is_authenticated) else "forbidden"
    return "ok" if role in rule else "forbidden"


class RolePolicy(BasePermission):
    """DRF 기본 권한 클래스. 모든 API 가 이 표를 거칩니다."""

    message = {"ko": "이 기능을 사용할 권한이 없습니다.", "en": "You do not have permission for this."}

    def has_permission(self, request, view):
        name = getattr(request.resolver_match, "url_name", None)
        verdict = allowed(name, request.method, request.user)
        if verdict == "unclassified":
            self.message = {"ko": "권한이 정해지지 않은 기능입니다.", "en": "This endpoint is not classified."}
        return verdict == "ok"  # 로그인 안 했으면 DRF 가 401 로 바꿈


def guard_plain_view(view):
    """DRF 를 거치지 않는 일반 Django 뷰(예: 사진 파일)에 같은 권한표를 적용"""

    def wrapped(request, *args, **kwargs):
        verdict = allowed(getattr(request.resolver_match, "url_name", None), request.method, request.user)
        if verdict == "ok":
            return view(request, *args, **kwargs)
        status = 401 if verdict == "unauthenticated" else 403
        code = {401: "NOT_AUTHENTICATED", 403: "FORBIDDEN"}[status]
        return JsonResponse({"error": {"code": code, "message": {"ko": "로그인이 필요하거나 권한이 없습니다.", "en": "Login required or not permitted."}}}, status=status)

    return wrapped
