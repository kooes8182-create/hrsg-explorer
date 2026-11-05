"""
HRSG Explorer — Django 설정 (로컬 단일 사용자 데모, 127.0.0.1:8002)

비밀값(SECRET_KEY, DB 비밀번호, API 키)은 explorer/backend/.env 에서 읽습니다.
.env 는 Git에 올리지 않으며, 형식은 .env.example 을 참고합니다.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# 계산기·체크리스트 키트 (팀 1, 고치지 않고 불러 씀 — engine/kit.py)
HRSG_KIT_DIR = BASE_DIR.parent.parent / "hrsg_calc_kit_team1"


def env(name, default=None):
    return os.environ.get(name, default)


SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("explorer/backend/.env 에 DJANGO_SECRET_KEY 를 설정하세요. (.env.example 참고)")

DEBUG = env("DJANGO_DEBUG", "False") == "True"

# 로컬에서만 실행
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

# Render 배포 (2026-11-05 사용자 승인) — Render 가 넣어 주는 RENDER_EXTERNAL_HOSTNAME 이 있을 때만 켜짐. 로컬 실행은 영향 없음.
RENDER_HOST = env("RENDER_EXTERNAL_HOSTNAME")
if RENDER_HOST:
    ALLOWED_HOSTS.append(RENDER_HOST)

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "cases",
    "system",
    "rag",
    "knowledge",
    "notifications",
    "accounts",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME", "hrsg_explorer"),
        "USER": env("DB_USER", ""),
        "PASSWORD": env("DB_PASSWORD", ""),
        "HOST": env("DB_HOST", "localhost"),
        "PORT": env("DB_PORT", "5432"),
        "CONNECT_TIMEOUT": 3,
    }
}
# Render: DATABASE_URL(postgresql://user:pw@host:port/db) 하나로 접속 정보를 받음
if env("DATABASE_URL"):
    from urllib.parse import unquote, urlparse

    _u = urlparse(env("DATABASE_URL"))
    DATABASES["default"].update({"NAME": _u.path.lstrip("/"), "USER": unquote(_u.username or ""),
                                 "PASSWORD": unquote(_u.password or ""), "HOST": _u.hostname or "", "PORT": str(_u.port or 5432),
                                 "CONNECT_TIMEOUT": 10})

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# 로그인·권한 없음 (로컬 단일 사용자 데모). JSON만 주고받습니다.
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    # 사번·비밀번호 로그인 (Django 세션 + CSRF). 모든 API 는 accounts.policy 의 권한표를 거칩니다 (표에 없으면 거부).
    "DEFAULT_AUTHENTICATION_CLASSES": ["accounts.auth.SessionAuth401"],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.policy.RolePolicy"],
    "EXCEPTION_HANDLER": "system.errors.api_exception_handler",
}

# 개발 중 Vite(5174)가 직접 호출하는 경우를 위해 허용 (보통은 Vite 프록시를 거침)
CORS_ALLOWED_ORIGINS = ["http://localhost:5174", "http://127.0.0.1:5174"]

# 처리하지 못한 서버 오류의 상세(traceback)는 서버 터미널에만 남깁니다 (응답·화면에는 짧은 안내만).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False}},
}


# 로그인 세션: 8시간 뒤 만료 → 화면이 로그인 화면으로 안내. 쿠키는 JS 에서 읽을 수 없음(HttpOnly), 같은 사이트 요청에만.
SESSION_COOKIE_AGE = 8 * 3600
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# 로그인 실패 횟수 제한용 (이 서버 프로세스 메모리)
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "hrsgx"}}
# PC 개발 서버(5174)는 /api 를 127.0.0.1:8002 로 넘기며 Host 를 바꾸므로, 화면 주소를 CSRF 신뢰 출처로 등록 (토큰 검사는 그대로).
# 휴대폰 접속용 서버(5175)는 프록시에서 Origin 을 백엔드 주소로 맞춥니다 (vite.mobile.config.ts).
CSRF_TRUSTED_ORIGINS = ["http://localhost:5174", "http://127.0.0.1:5174"]

# Render 배포: 화면(React 빌드 결과)도 이 서버가 같은 주소로 제공 → 로그인 쿠키·CSRF 가 같은 출처에서 동작
FRONTEND_DIST = BASE_DIR.parent / "frontend/dist"
if RENDER_HOST:
    CSRF_TRUSTED_ORIGINS.append(f"https://{RENDER_HOST}")
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
