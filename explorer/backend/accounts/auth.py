from rest_framework.authentication import SessionAuthentication


class SessionAuth401(SessionAuthentication):
    """Django 세션 로그인 + CSRF 검사. 로그인하지 않은 요청에 403 대신 401 을 돌려주도록 인증 방식 이름을 알려 줍니다."""

    def authenticate_header(self, request):
        return "Session"
