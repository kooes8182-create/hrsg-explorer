"""외부 AI 전송 전 민감정보 마스킹 (질문 문장에만 적용).

- 정규식: 이메일, 전화번호(국내·국제), 주민등록번호 형식
- 사용자 정의 목록: 발전소명·고객사명·개인 이름 등 (설정 화면에서 관리, 대소문자 무시)
- DB·로그에는 가린 문장만 저장합니다. 원문은 요청 처리 중에만 메모리에 있습니다.
"""

import re

PATTERNS = [
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("RRN", re.compile(r"\b\d{6}-?[1-4]\d{6}\b")),
    ("PHONE", re.compile(r"(?:\+82[-\s]?|\b0)(?:1[016789]|2|[3-6][1-5]|70)[-\s.]?\d{3,4}[-\s.]?\d{4}\b")),
]
LABEL = {"EMAIL": "[이메일]", "RRN": "[주민번호]", "PHONE": "[전화번호]", "TERM": "[식별정보]"}


def mask(text, terms=()):
    """→ (가린 문장, [{type, count}])"""
    found = {}
    out = text
    for kind, rx in PATTERNS:
        out, n = rx.subn(LABEL[kind], out)
        if n:
            found[kind] = n
    for term in sorted({t.strip() for t in terms if t and t.strip()}, key=len, reverse=True):
        out, n = re.subn(re.escape(term), LABEL["TERM"], out, flags=re.IGNORECASE)
        if n:
            found["TERM"] = found.get("TERM", 0) + n
    return out, [{"type": k, "count": v} for k, v in found.items()]
