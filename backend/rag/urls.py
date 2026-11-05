from django.urls import path

from . import views

urlpatterns = [
    path("info/", views.rag_info, name="rag-info"),
    path("search/", views.rag_search, name="rag-search"),
    path("answer/", views.rag_answer, name="rag-answer"),
    path("compare/", views.rag_compare, name="rag-compare"),
    path("experiments/", views.rag_experiments, name="rag-experiments"),
]
