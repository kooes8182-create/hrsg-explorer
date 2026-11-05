import os

from django.db import connection
from django.db.utils import OperationalError
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from rag import official
from rag.models import SystemConfiguration

# 검색: 공식 corpus·BM25 는 바로, BGE-M3 는 첫 질문 때. AI: 키 + 설정의 '외부 전송 허용'이 모두 있어야 사용.
AI_NOT_CONFIGURED = {"ko": "ANTHROPIC_API_KEY 가 설정되지 않았습니다.", "en": "ANTHROPIC_API_KEY is not set."}
AI_DISABLED = {"ko": "외부 AI 전송이 꺼져 있습니다 (설정에서 켤 수 있음). 근거 검색만 제공합니다.",
               "en": "External AI sending is off (enable in Settings). Evidence search only."}
VECTOR_LAZY = {"ko": "BM25 사용 가능. 의미 검색(BGE-M3)은 첫 질문 때 불러옵니다.", "en": "BM25 ready. BGE-M3 loads on the first question."}


def _database_ok():
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return True
    except OperationalError:
        return False


@api_view(["GET"])
def health(request):
    """서버·DB·검색·AI 연결 상태. 화면은 30초마다 호출합니다.

    DB 연결이 안 되면 503 을 돌려줍니다. 검색·AI 가 꺼져 있는 것은 오류가 아니므로 200 입니다.
    """
    db_ok = _database_ok()
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    st = official.get(load_model=False)  # 모델은 여기서 불러오지 않음 (점검이 무거워지지 않게)
    if st["corpus"] is None:
        search = {"status": "unavailable", "reason": {"ko": st["error"], "en": "Official corpus not found."}, "vector": "unavailable"}
    else:
        search = {"status": "ready", "vector": st["vector"],
                  "reason": VECTOR_LAZY if st["vector"] == "not_loaded" else ({"ko": st["vector_reason"], "en": "Dense search unavailable; BM25 fallback."} if st["vector"] == "unavailable" else None)}
    enabled = db_ok and bool(SystemConfiguration.read("ai_external_enabled"))
    body = {
        "status": "ok" if db_ok else "error",
        "server": "ok",
        "database": "ok" if db_ok else "error",
        "search": search,
        "ai": {"status": "ready" if has_key and enabled else "not_connected",
               "reason": None if has_key and enabled else (AI_DISABLED if has_key else AI_NOT_CONFIGURED),
               "key_configured": has_key, "external_enabled": enabled},
        "checked_at": timezone.now().isoformat(),
    }
    return Response(body, status=200 if db_ok else 503)
