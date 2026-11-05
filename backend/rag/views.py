from rest_framework.decorators import api_view
from rest_framework.response import Response

from qa.intents import detect_lang

from . import answer, experiments, service
from .retrieval.hybrid import MODES, SearchConfig

MAX_QUESTION = 500
INPUT_ERROR = "입력값을 확인하세요."


def _question(request):
    q = request.data.get("question") if isinstance(request.data, dict) else None
    q = q.strip() if isinstance(q, str) else ""
    if not q:
        return None, Response({"error": INPUT_ERROR, "fields": {"question": ["질문을 입력하세요."]}}, status=400)
    if len(q) > MAX_QUESTION:
        return None, Response({"error": INPUT_ERROR,
                               "fields": {"question": [f"질문은 {MAX_QUESTION}자 이하로 입력하세요."]}}, status=400)
    return q, None


def _unavailable(result):
    return Response({"error": result["error"]}, status=503)


@api_view(["GET"])
def rag_info(request):
    """코퍼스·벡터·답변 생성 설정 상태."""
    return Response({**service.info(), "llm": answer.status()})


@api_view(["POST"])
def rag_search(request):
    """질문 → 최종 근거 문단 (기본: 하이브리드). 정답 정보가 없으므로 Recall 등은 돌려주지 않습니다."""
    q, err = _question(request)
    if err:
        return err
    mode = request.data.get("mode", "hybrid")
    if mode not in MODES:
        return Response({"error": INPUT_ERROR, "fields": {"mode": [f"mode 는 {', '.join(MODES)} 중 하나"]}}, status=400)
    result = service.search(q, mode)
    if "error" in result:
        return _unavailable(result)
    return Response({**result, "question": q, "lang": detect_lang(q)})


@api_view(["POST"])
def rag_answer(request):
    """질문 + 검색된 문단 ID → Gemini 답변. 문단 본문은 서버 코퍼스에서 다시 읽습니다."""
    q, err = _question(request)
    if err:
        return err
    ids = request.data.get("chunk_ids")
    if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids) or len(ids) > SearchConfig.final_k:
        return Response({"error": INPUT_ERROR,
                         "fields": {"chunk_ids": [f"문단 ID 목록(최대 {SearchConfig.final_k}개)이 필요합니다."]}}, status=400)
    passages, unknown = service.chunks_by_ids(ids)
    if passages is None:
        return _unavailable({"error": service.info()["corpus_error"]})
    if unknown:
        return Response({"error": INPUT_ERROR, "fields": {"chunk_ids": [f"코퍼스에 없는 문단 ID: {unknown[:3]}"]}},
                        status=400)
    return Response(answer.generate(q, passages, detect_lang(q)))


def _int(data, key, default, lo, hi):
    v = data.get(key, default)
    if not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"{key} 는 {lo}~{hi} 정수")
    return v


@api_view(["POST"])
def rag_compare(request):
    """개발용: BM25 / 벡터 / 하이브리드의 후보 순위, RRF 결합 순위, 최종 포함 여부와 제외 이유.
    최종 개수(8)와 문헌당 최대 문단(2)은 바꿀 수 없습니다."""
    q, err = _question(request)
    if err:
        return err
    d = service.DEFAULT_CONFIG
    try:
        cfg = SearchConfig(bm25_k=_int(request.data, "bm25_k", d.bm25_k, 1, 200),
                           vector_k=_int(request.data, "vector_k", d.vector_k, 1, 200),
                           rrf_k=_int(request.data, "rrf_k", d.rrf_k, 1, 500))
    except ValueError as e:
        return Response({"error": INPUT_ERROR, "fields": {"config": [str(e)]}}, status=400)
    result = service.compare(q, cfg)
    if "error" in result:
        return _unavailable(result)
    return Response({**result, "question": q, "lang": detect_lang(q)})


@api_view(["GET"])
def rag_experiments(request):
    """공식 평가셋 v1 검색 실험 기록 (저장된 dev·test 결과 파일만 읽음. 검색·채점을 실행하지 않음)."""
    return Response(experiments.records())
