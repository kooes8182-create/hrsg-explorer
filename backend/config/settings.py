"""
HRSG 레퍼런스 앱 — Django 설정 (로컬 단일 사용자 데모)

비밀값(SECRET_KEY, DB 비밀번호, API 키)은 backend/.env 에서 읽습니다.
.env 는 Git에 올리지 않으며, 형식은 .env.example 을 참고합니다.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name, default=None):
    return os.environ.get(name, default)


SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("backend/.env 에 DJANGO_SECRET_KEY 를 설정하세요. (.env.example 참고)")

DEBUG = env("DJANGO_DEBUG", "False") == "True"

# 로컬에서만 실행
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "rag",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
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
        "NAME": env("DB_NAME", "hrsg_ref"),
        "USER": env("DB_USER", ""),
        "PASSWORD": env("DB_PASSWORD", ""),
        "HOST": env("DB_HOST", "localhost"),
        "PORT": env("DB_PORT", "5432"),
        "CONNECT_TIMEOUT": 3,
    }
}

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

# 정적 파일: reference/ 의 원문 PDF는 어떤 경로로도 제공하지 않습니다.
STATIC_URL = "static/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# 로그인·권한 없음 (로컬 단일 사용자 PoC). JSON만 주고받습니다.
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

# 개발 중 Vite(5173)가 직접 호출하는 경우를 위해 허용 (보통은 Vite 프록시를 거침)
CORS_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
