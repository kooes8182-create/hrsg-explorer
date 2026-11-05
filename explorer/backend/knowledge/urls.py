from django.urls import path

from . import views

urlpatterns = [
    path("knowledge/uploads/", views.uploads, name="kb-uploads"),
    path("knowledge/uploads/<int:pid>/", views.upload_detail, name="kb-upload-detail"),
    path("knowledge/uploads/<int:pid>/chunks/", views.upload_chunks, name="kb-upload-chunks"),
    path("knowledge/uploads/<int:pid>/reprocess/", views.upload_reprocess, name="kb-upload-reprocess"),
    path("knowledge/uploads/<int:pid>/reembed/", views.upload_reembed, name="kb-upload-reembed"),
    path("knowledge/upload-search/", views.upload_search, name="kb-upload-search"),
    path("knowledge/jobs/", views.jobs, name="kb-jobs"),
    path("knowledge/reindex/", views.reindex, name="kb-reindex"),
]
