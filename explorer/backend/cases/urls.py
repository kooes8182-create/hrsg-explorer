from django.urls import path

from . import views

urlpatterns = [
    path("cases/", views.case_list, name="case-list"),
    path("cases/<int:case_id>/", views.case_detail, name="case-detail"),
    path("cases/<int:case_id>/clone/", views.case_clone, name="case-clone"),
    path("cases/<int:case_id>/overview/", views.case_overview, name="case-overview"),
    path("inputs/schema/", views.input_schema, name="input-schema"),
    path("cases/<int:case_id>/inputs/", views.case_inputs, name="case-inputs"),
    path("cases/<int:case_id>/inputs/reset/", views.inputs_reset, name="inputs-reset"),
    path("cases/<int:case_id>/evaluate/<str:kind>/", views.evaluate, name="evaluate"),
    path("cases/<int:case_id>/results/", views.case_results, name="case-results"),
    path("cases/<int:case_id>/snapshots/", views.snapshots, name="snapshots"),
    path("cases/<int:case_id>/snapshots/<int:sid>/", views.snapshot_detail, name="snapshot-detail"),
    path("cases/<int:case_id>/snapshots/<int:sid>/restore/", views.snapshot_restore, name="snapshot-restore"),
    path("cases/<int:case_id>/checklist/", views.checklist, name="checklist"),
    path("cases/<int:case_id>/checklist/export/", views.checklist_export, name="checklist-export"),
    path("cases/<int:case_id>/checklist/import/", views.checklist_import, name="checklist-import"),
    path("checklist/template/", views.checklist_template, name="checklist-template"),
    path("cases/<int:case_id>/checklist/request-text/", views.checklist_request_text, name="checklist-request-text"),
    path("cases/<int:case_id>/checklist/<str:item_id>/attachments/", views.checklist_attachments, name="checklist-attachments"),
    path("attachments/<int:aid>/", views.attachment_detail, name="attachment-detail"),
    path("attachments/<int:aid>/file/", views.attachment_file, name="attachment-file"),
    path("cases/<int:case_id>/measurements/", views.measurements, name="measurements"),
    path("cases/<int:case_id>/measurements/<int:mid>/", views.measurement_detail, name="measurement-detail"),
    path("public/smp/", views.public_smp, name="public-smp"),
    path("public/sources/", views.public_sources, name="public-sources"),
    path("glossary/", views.glossary_view, name="glossary"),
]
