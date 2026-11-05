"""HRSG Explorer URL. 모든 API는 /api/ 아래에 있습니다."""

from django.conf import settings
from django.http import FileResponse, Http404
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    path("api/", include("system.urls")),
    path("api/", include("accounts.urls")),
    path("api/", include("cases.urls")),
    path("api/", include("knowledge.urls")),  # rag 의 501 reindex 보다 먼저
    path("api/", include("rag.urls")),
    path("api/", include("notifications.urls")),
]



# Render 배포에서만: React 빌드 결과(frontend/dist)를 같은 주소로 제공. 파일이 있으면 그 파일, 없으면 index.html (화면 주소 새로고침 대응)
def spa(request, rest=""):
    dist = settings.FRONTEND_DIST.resolve()
    target = (dist / rest).resolve()
    if rest and target.is_file() and target.is_relative_to(dist):
        return serve(request, rest, document_root=dist)
    index = dist / "index.html"
    if not index.is_file():
        raise Http404
    return FileResponse(index.open("rb"), content_type="text/html")


if settings.RENDER_HOST:
    urlpatterns.append(re_path(r"^(?!api/)(?P<rest>.*)$", spa))

# DEBUG=False 일 때 오류 응답을 짧은 JSON 으로 (내부 정보 노출 방지)
handler404 = "system.errors.not_found"
handler500 = "system.errors.server_error"
