from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    """계정 역할. 기존 Django 사용자 테이블(auth_user)은 그대로 두고, 사번 = username, 역할은 이 표에만 저장합니다.
    역할은 서버가 정하며 화면·요청 값으로 바뀌지 않습니다. 역할이 없는 계정(예: superuser)은 업무 API 를 쓸 수 없습니다."""

    PLANT_ENGINEER = "PLANT_ENGINEER"
    AI_ADMIN = "AI_ADMIN"
    ROLES = [(PLANT_ENGINEER, "플랜트 엔지니어"), (AI_ADMIN, "AI 관리자")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=ROLES)
    display_name = models.CharField(max_length=60, blank=True, default="")

    def __str__(self):
        return f"{self.user.username} ({self.role})"
