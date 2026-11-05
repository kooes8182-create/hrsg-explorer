"""테스트용 로그인 도우미. 실제 화면과 같은 세션 로그인(force_login)을 씁니다."""

import itertools
from contextlib import contextmanager
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from . import policy
from .models import UserProfile

_seq = itertools.count(1)


def make_user(role, username=None, password=None):  # 비밀번호 없으면 해시 계산 생략 (force_login 용)
    user = get_user_model().objects.create_user(username=username or f"t{next(_seq):05d}", password=password)
    if role:
        UserProfile.objects.create(user=user, role=role, display_name=f"테스트 {role}")
    return user


def client_for(role="PLANT_ENGINEER", user=None):
    c = APIClient()
    c.force_login(user or make_user(role))
    return c


def plant_client():
    return client_for(UserProfile.PLANT_ENGINEER)


def admin_client():
    return client_for(UserProfile.AI_ADMIN)


@contextmanager
def unlock(*names, role="AI_ADMIN"):
    """권한표에서 차단(BLOCKED)해 둔 기능의 '내부 동작'을 시험할 때만 잠깐 엽니다. 실제 서비스 권한은 바뀌지 않습니다."""
    table = {k: dict(v) for k, v in policy.POLICY.items()}
    for n in names:
        table[n] = {m: ({role} if r == policy.BLOCKED else r) for m, r in table[n].items()}
    with mock.patch.dict(policy.POLICY, table):
        yield
