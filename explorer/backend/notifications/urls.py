from django.urls import path

from . import views

urlpatterns = [
    path("notifications/", views.notification_list, name="notifications"),
    path("notifications/read-all/", views.notification_read_all, name="notifications-read-all"),
    path("notifications/client-event/", views.client_event, name="notifications-client-event"),
    path("notifications/<int:nid>/read/", views.notification_read, name="notification-read"),
]
