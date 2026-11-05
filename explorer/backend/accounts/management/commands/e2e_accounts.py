"""화면 테스트(e2e) 전용 임시 계정. 테스트 시작 때 만들고(--create, 새 난수 비밀번호를 JSON 으로 테스트 프로그램에만 전달),
끝날 때 지웁니다(--delete). 데모 계정과 별개이며 사번은 e2e- 로 시작합니다.
--cleanup-cases 1,2,3 : 이번 테스트가 만든 케이스 번호 중 이름이 "E2E" 로 시작하는 것만 지웁니다 (로그인 만료로 화면 정리가 실패해도 남지 않게)."""

import json
import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from accounts.models import UserProfile

ACCOUNTS = {"plant": ("e2e-plant", UserProfile.PLANT_ENGINEER, "E2E 플랜트"), "admin": ("e2e-admin", UserProfile.AI_ADMIN, "E2E AI 관리자")}


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--create", action="store_true")
        parser.add_argument("--delete", action="store_true")
        parser.add_argument("--cleanup-cases", default=None)

    def handle(self, *args, **opts):
        User = get_user_model()
        if opts["cleanup_cases"] is not None:
            from cases.models import EvaluationCase
            ids = [int(x) for x in opts["cleanup_cases"].split(",") if x.strip().isdigit()]
            n, _ = EvaluationCase.objects.filter(id__in=ids, name__startswith="E2E").delete()
            self.stdout.write(json.dumps({"deleted": n}))
            return
        if opts["delete"]:
            User.objects.filter(username__in=[a[0] for a in ACCOUNTS.values()]).delete()
            return
        out = {}
        for key, (emp, role, name) in ACCOUNTS.items():
            pw = secrets.token_urlsafe(12)
            user, _ = User.objects.get_or_create(username=emp)
            user.set_password(pw)
            user.is_active, user.is_staff, user.is_superuser = True, False, False
            user.save()
            UserProfile.objects.update_or_create(user=user, defaults={"role": role, "display_name": name})
            out[key] = {"employee_id": emp, "password": pw}
        self.stdout.write(json.dumps(out))
