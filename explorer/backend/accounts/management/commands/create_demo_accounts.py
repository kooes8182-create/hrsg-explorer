"""로컬 개발·발표용 데모 계정 2개 (플랜트 엔지니어 1, AI 관리자 1). 앱 시작 때 자동으로 만들지 않습니다 — 이 명령을 직접 실행.

    .venv/bin/python manage.py create_demo_accounts                 # 없는 계정만 만들고 새 비밀번호를 터미널에 한 번 표시
    .venv/bin/python manage.py create_demo_accounts --output FILE   # 터미널 대신 FILE(권한 600)에 저장 — 확인 후 지우세요
    .venv/bin/python manage.py create_demo_accounts --reset 90020833  # 이 사번만 새 비밀번호로 재설정
    python manage.py create_demo_accounts --from-env                # Render 배포용: 비밀번호를 환경 변수에서 읽음 (아래 참고)

--from-env (Render 배포, 2026-11-05): 무료 플랜은 Shell 이 없어 서버 시작 때 실행합니다. 비밀번호는 Render 화면에서 직접 넣은
DEMO_ENGINEER_PASSWORD · DEMO_ADMIN_PASSWORD 에서 읽고, 로그에는 비밀번호를 쓰지 않습니다. 값이 바뀌면 그 값으로 재설정합니다.

- 다시 실행해도 계정이 중복되지 않고, 이미 있는 계정의 비밀번호는 바꾸지 않습니다 (--reset 을 준 사번만 재설정).
- 비밀번호는 안전한 난수(secrets)로 만들고 Django 해시로만 저장합니다. 소스·로그에는 남기지 않습니다.
- 사번은 가상 번호이며 역할과 관계없는 숫자입니다 (역할은 UserProfile 에만 저장).
"""

import os
import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import UserProfile

DEMO = [
    {"employee_id": "90010417", "name": "데모 플랜트 엔지니어", "role": UserProfile.PLANT_ENGINEER},
    {"employee_id": "90020833", "name": "데모 AI 관리자", "role": UserProfile.AI_ADMIN},
]


def new_password():
    return secrets.token_urlsafe(12)  # 약 16자, 추측 불가


class Command(BaseCommand):
    help = "데모 계정 2개를 만들거나(없을 때만), 지정한 사번의 비밀번호를 재설정합니다."

    def add_arguments(self, parser):
        parser.add_argument("--reset", metavar="사번", help="이 데모 계정의 비밀번호만 새로 만듭니다")
        parser.add_argument("--from-env", action="store_true", help="비밀번호를 환경 변수에서 읽습니다 (Render 배포용)")
        parser.add_argument("--output", metavar="FILE", help="새 비밀번호를 터미널 대신 이 파일(권한 600)에 적습니다")

    @transaction.atomic
    def handle(self, *args, **opts):
        User = get_user_model()
        if opts.get("from_env"):
            return self.from_env(User)
        reset = opts.get("reset")
        if reset and reset not in {d["employee_id"] for d in DEMO}:
            raise CommandError("데모 계정 사번이 아닙니다.")
        lines = []
        for d in DEMO:
            user = User.objects.filter(username=d["employee_id"]).first()
            if user is None:
                pw = new_password()
                user = User.objects.create_user(username=d["employee_id"], password=pw, is_staff=False, is_superuser=False)
                UserProfile.objects.create(user=user, role=d["role"], display_name=d["name"])
                lines.append((d, pw, "새로 만듦"))
            else:
                if not hasattr(user, "profile"):
                    UserProfile.objects.create(user=user, role=d["role"], display_name=d["name"])
                if reset == d["employee_id"]:
                    pw = new_password()
                    user.set_password(pw)
                    user.save(update_fields=["password"])
                    lines.append((d, pw, "비밀번호 재설정"))
                else:
                    lines.append((d, None, "이미 있음 — 비밀번호 그대로"))
        text = "\n".join(f"{d['name']} ({d['role']}) 사번 {d['employee_id']}: " + (f"비밀번호 {pw}  [{why}]" if pw else why) for d, pw, why in lines)
        if opts.get("output") and any(pw for _, pw, _ in lines):
            path = opts["output"]
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text + "\n")
            self.stdout.write("\n".join(f"{d['name']} 사번 {d['employee_id']}: {why}" for d, _, why in lines))
            self.stdout.write(f"새 비밀번호는 {path} (권한 600) 에 저장했습니다. 확인한 뒤 파일을 지우세요.")
        else:
            self.stdout.write(text)
            if any(pw for _, pw, _ in lines):
                self.stdout.write("위 비밀번호는 다시 표시되지 않습니다. 잊으면 --reset 사번 으로 재설정하세요.")

    def from_env(self, User):
        envs = {UserProfile.PLANT_ENGINEER: "DEMO_ENGINEER_PASSWORD", UserProfile.AI_ADMIN: "DEMO_ADMIN_PASSWORD"}
        for d in DEMO:
            pw = os.environ.get(envs[d["role"]], "")
            if len(pw) < 10:
                self.stdout.write(f"사번 {d['employee_id']}: {envs[d['role']]} 가 비었거나 10자 미만이라 건너뜀")
                continue
            user = User.objects.filter(username=d["employee_id"]).first()
            if user is None:
                user = User.objects.create_user(username=d["employee_id"], password=pw, is_staff=False, is_superuser=False)
                state = "새로 만듦"
            elif not user.check_password(pw):
                user.set_password(pw)
                user.save(update_fields=["password"])
                state = "비밀번호를 환경 변수 값으로 재설정"
            else:
                state = "이미 있음"
            if not hasattr(user, "profile"):
                UserProfile.objects.create(user=user, role=d["role"], display_name=d["name"])
            self.stdout.write(f"사번 {d['employee_id']}: {state}")
