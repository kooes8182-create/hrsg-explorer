"""HRSG 레퍼런스 앱 URL. 모든 API는 /api/ 아래에 있습니다."""

from django.urls import include, path

urlpatterns = [
    path("api/rag/", include("rag.urls")),  # 논문 근거 검색 (core.urls 보다 먼저)
    path("api/", include("core.urls")),
]

# DEBUG=False 일 때 오류 응답을 짧은 JSON 으로 (내부 정보 노출 방지)
handler404 = "core.views.not_found"
handler500 = "core.views.server_error"
