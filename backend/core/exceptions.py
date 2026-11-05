from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    """DRF 기본 오류 응답 {"detail": ...} 을 명세 형식 {"error": ...} 로 맞춥니다."""
    response = exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and "detail" in response.data:
        response.data = {"error": str(response.data["detail"])}
    return response
