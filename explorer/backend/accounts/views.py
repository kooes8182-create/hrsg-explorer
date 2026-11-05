"""로그인 · 로그아웃 · 현재 사용자.

- 사번(username)·비밀번호는 Django 표준 인증으로 검사합니다 (비밀번호는 Django 해시로 저장).
- 실패하면 사번 존재 여부와 상관없이 같은 문구. 실패가 많으면 잠시 막습니다 (사번+IP 5회, IP 20회 / 15분).
- 로그인 요청에도 CSRF 토큰을 검사합니다 (화면은 먼저 /auth/me/ 로 토큰 쿠키를 받음).
"""

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from system.errors import api_error

from .auth import SessionAuth401
from .policy import role_of

HOME = {"PLANT_ENGINEER": "/dashboard", "AI_ADMIN": "/rag-evaluation"}
ROLE_LABEL = {"PLANT_ENGINEER": {"ko": "플랜트 엔지니어", "en": "Plant engineer"}, "AI_ADMIN": {"ko": "AI 관리자", "en": "AI administrator"}}
WINDOW = 15 * 60
MAX_PER_ID, MAX_PER_IP = 5, 20
FAIL = ("사번 또는 비밀번호를 확인해 주세요.", "Check your employee ID or password.")


def user_payload(user):
    role = role_of(user)
    if not role:
        return None
    name = user.profile.display_name or user.get_full_name() or user.username
    return {"employee_id": user.username, "name": name, "role": role, "role_label": ROLE_LABEL[role], "home": HOME[role]}


def _ip(request):
    return request.META.get("REMOTE_ADDR", "?")


def _hits(key):
    return cache.get(key, 0)


def _bump(key):
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, WINDOW)


@api_view(["GET"])
@ensure_csrf_cookie
def me(request):
    """현재 로그인 상태 (새로고침 시 화면이 이 값으로 복원). CSRF 쿠키도 여기서 받습니다."""
    u = user_payload(request.user) if request.user.is_authenticated else None
    return Response({"authenticated": bool(u), "user": u})


@api_view(["POST"])
def login_view(request):
    try:
        SessionAuth401().enforce_csrf(request)  # 로그인 전에도 CSRF 토큰 확인
    except PermissionDenied:
        return api_error("CSRF_FAILED", 403, "보안 토큰이 없습니다. 화면을 새로고침한 뒤 다시 시도하세요.", "Missing security token. Reload and retry.")
    data = request.data if isinstance(request.data, dict) else {}
    emp = str(data.get("employee_id") or "").strip()[:64]
    pw = str(data.get("password") or "")
    k_id, k_ip = f"login-fail:{_ip(request)}:{emp.lower()}", f"login-fail-ip:{_ip(request)}"
    if _hits(k_id) >= MAX_PER_ID or _hits(k_ip) >= MAX_PER_IP:
        return api_error("TOO_MANY_ATTEMPTS", 429, "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요.", "Too many attempts. Try again in 15 minutes.")
    user = authenticate(request, username=emp, password=pw) if emp and pw else None
    if user is None or not role_of(user):  # 사번 없음·비밀번호 틀림·역할 없음·비활성 모두 같은 문구
        _bump(k_id)
        _bump(k_ip)
        return api_error("LOGIN_FAILED", 401, *FAIL)
    cache.delete(k_id)
    login(request, user)  # 세션 키·CSRF 토큰을 새로 발급 (세션 고정 방지)
    return Response({"authenticated": True, "user": user_payload(user)})


@api_view(["POST"])
def logout_view(request):
    if request.user.is_authenticated:
        try:
            SessionAuth401().enforce_csrf(request)
        except PermissionDenied:
            return api_error("CSRF_FAILED", 403, "보안 토큰이 없습니다.", "Missing security token.")
    logout(request)  # 서버 세션 삭제
    return Response({"authenticated": False})
