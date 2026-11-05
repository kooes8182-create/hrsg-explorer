"""외부 AI(Claude) 전송 허용·민감 식별정보 목록 — 서버 운영자용. (이번 역할 구성에서 '설정' 화면·API 는 모두 차단)

    .venv/bin/python manage.py ai_settings                       # 현재 값 보기
    .venv/bin/python manage.py ai_settings --external on         # 켜기 (off 로 끄기)
    .venv/bin/python manage.py ai_settings --terms '["가상발전소"]'  # 민감 식별정보 목록 바꾸기 (JSON 문자열 목록)
    .venv/bin/python manage.py ai_settings --json                # 기계용 출력 (화면 테스트에서 사용)
"""

import json

from django.core.management.base import BaseCommand, CommandError

from rag.models import SystemConfiguration


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--external", choices=["on", "off"])
        parser.add_argument("--terms", help="JSON 문자열 목록")
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **opts):
        if opts.get("external"):
            SystemConfiguration.write("ai_external_enabled", opts["external"] == "on")
        if opts.get("terms") is not None:
            try:
                terms = json.loads(opts["terms"])
                assert isinstance(terms, list) and all(isinstance(t, str) for t in terms)
            except (ValueError, AssertionError):
                raise CommandError("--terms 는 JSON 문자열 목록이어야 합니다.")
            SystemConfiguration.write("sensitive_terms", sorted({t.strip()[:80] for t in terms if t.strip()}))
        ext = bool(SystemConfiguration.read("ai_external_enabled"))
        terms = SystemConfiguration.read("sensitive_terms") or []
        if opts.get("json"):
            self.stdout.write(json.dumps({"ai_external_enabled": ext, "sensitive_terms": terms}, ensure_ascii=False))
            return
        self.stdout.write(f"외부 AI 전송 허용: {'켜짐' if ext else '꺼짐'}")
        self.stdout.write(f"민감 식별정보 목록: {len(terms)}개")
