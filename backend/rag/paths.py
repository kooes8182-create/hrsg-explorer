"""RAG 자료 위치. 기본값은 HRSG 폴더 기준이며 backend/.env 로 바꿀 수 있습니다."""

import os
from pathlib import Path

from django.conf import settings

PROJECT_ROOT = Path(settings.BASE_DIR).parent


def _path(env_name, default):
    v = os.environ.get(env_name)
    return Path(v) if v else default


PAPERS_DIR = _path("RAG_PAPERS_DIR", PROJECT_ROOT / "reference" / "papers")
BIBLIOGRAPHY = _path("RAG_BIBLIOGRAPHY", PROJECT_ROOT / "reference" / "HRSG_RAG_참고문헌_목록.xlsx")
CORPUS_DIR = _path("RAG_CORPUS_DIR", PROJECT_ROOT / "data" / "prototype")
INDEX_DIR = CORPUS_DIR / "index"
TERM_EXPANSION = os.environ.get("RAG_TERM_EXPANSION") or None  # 한국어→영어 용어 목록 JSON (기본: 없음)

EVAL_DIR = PROJECT_ROOT / "data" / "eval"
EVAL_FILE = _path("RAG_EVAL_FILE", EVAL_DIR / "eval_questions.csv")
RUNS_DIR = EVAL_DIR / "runs"
LOCKED_CONFIG = EVAL_DIR / "locked_config.json"
