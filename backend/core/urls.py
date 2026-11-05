from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("demo/scenarios/", views.demo_scenarios, name="demo-scenarios"),
    path("public/smp/", views.public_smp, name="public-smp"),
    path("public/sources/", views.public_sources, name="public-sources"),
    path("cases/", views.case_list, name="case-list"),
    path("cases/<int:case_id>/", views.case_detail, name="case-detail"),
    path("cases/<int:case_id>/overview/", views.case_overview, name="case-overview"),
    path("cases/<int:case_id>/checklist/", views.checklist, name="checklist"),
    path("cases/<int:case_id>/checklist/request-text/", views.checklist_request_text, name="checklist-request-text"),
    path("cases/<int:case_id>/inputs/", views.case_inputs, name="case-inputs"),
    path("cases/<int:case_id>/evaluate/<str:kind>/", views.evaluate, name="evaluate"),
    path("cases/<int:case_id>/results/", views.case_results, name="case-results"),
    path("qa/info/", views.qa_info, name="qa-info"),
    path("cases/<int:case_id>/questions/", views.case_questions, name="case-questions"),
]
