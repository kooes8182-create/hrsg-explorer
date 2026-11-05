"""공통 오류 형식.

모든 API 오류는 같은 모양으로 돌려줍니다:
    {"error": {"code": "NOT_FOUND", "message": {"ko": "...", "en": "..."}, "fields": {...}}}
fields 는 입력 검증 오류일 때만 들어갑니다 (필드 이름 → 메시지 목록).
"""

from django.http import JsonResponse
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler

MESSAGES = {
    "VALIDATION_ERROR": ("입력값을 확인하세요.", "Check the input values."),
    "NOT_FOUND": ("요청한 대상을 찾을 수 없습니다.", "The requested item was not found."),
    "METHOD_NOT_ALLOWED": ("허용되지 않은 요청 방식입니다.", "Method not allowed."),
    "PARSE_ERROR": ("요청 형식(JSON)이 올바르지 않습니다.", "The request body is not valid JSON."),
    "UNSUPPORTED_MEDIA_TYPE": ("JSON 형식으로 보내야 합니다.", "Send the request as JSON."),
    "SERVER_ERROR": ("서버 오류가 발생했습니다.", "A server error occurred."),
}

_DRF_CODES = [
    (exceptions.ValidationError, "VALIDATION_ERROR"),
    (exceptions.NotFound, "NOT_FOUND"),
    (exceptions.MethodNotAllowed, "METHOD_NOT_ALLOWED"),
    (exceptions.ParseError, "PARSE_ERROR"),
    (exceptions.UnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE"),
]


def error_body(code, ko=None, en=None, fields=None):
    default_ko, default_en = MESSAGES.get(code, MESSAGES["SERVER_ERROR"])
    body = {"code": code, "message": {"ko": ko or default_ko, "en": en or default_en}}
    if fields:
        body["fields"] = fields
    return {"error": body}


def api_error(code, status, ko=None, en=None, fields=None):
    return Response(error_body(code, ko, en, fields), status=status)


def api_exception_handler(exc, context):
    """DRF 기본 오류 응답을 공통 형식으로 바꿉니다."""
    response = exception_handler(exc, context)
    if response is None:
        return None
    code = next((c for cls, c in _DRF_CODES if isinstance(exc, cls)), "SERVER_ERROR")
    fields = response.data if code == "VALIDATION_ERROR" and isinstance(response.data, dict) else None
    response.data = error_body(code, fields=fields)
    return response


def _json(code, status):
    return JsonResponse(error_body(code), status=status, json_dumps_params={"ensure_ascii": False})


def not_found(request, exception=None):
    """없는 주소: Django 기본 오류 화면 대신 짧은 JSON (내부 URL 목록 노출 방지)."""
    return _json("NOT_FOUND", 404)


def server_error(request):
    """처리하지 못한 서버 오류: 내부 상세 없이 안내만."""
    return _json("SERVER_ERROR", 500)
