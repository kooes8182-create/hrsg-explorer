from django.urls import path

from . import views

urlpatterns = [
    path("rag/info/", views.rag_info, name="rag-info"),
    path("rag/search/", views.rag_search, name="rag-search"),
    path("rag/compare/", views.rag_compare, name="rag-compare"),
    path("rag/experiments/", views.rag_experiments, name="rag-experiments"),
    path("rag/experiments/run-dev/", views.rag_run_dev, name="rag-run-dev"),
    path("rag/labels/", views.labels, name="rag-labels"),
    path("rag/labels/<int:label_id>/", views.label_detail, name="rag-label-detail"),
    path("rag/feedback/export/", views.feedback_export, name="rag-feedback-export"),
    path("cases/<int:case_id>/conversations/", views.conversations, name="conversations"),
    path("conversations/<int:conv_id>/", views.conversation_detail, name="conversation-detail"),
    path("conversations/<int:conv_id>/messages/", views.conversation_ask, name="conversation-ask"),
    path("messages/<int:msg_id>/feedback/", views.message_feedback, name="message-feedback"),
    path("cases/<int:case_id>/ai-context/", views.ai_context, name="ai-context"),
    path("cases/<int:case_id>/questions/", views.case_template_question, name="case-questions"),
    path("knowledge/papers/", views.kb_papers, name="kb-papers"),
    path("knowledge/chunks/", views.kb_chunks, name="kb-chunks"),
    path("settings/", views.app_settings, name="app-settings"),
]
