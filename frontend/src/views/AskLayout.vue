<script setup>
import { t } from '../i18n/index.js'
import PageHeader from '../components/PageHeader.vue'
</script>

<template>
  <!-- AI 도우미: 두 탭. 논문 근거 질문(RAG) / 평가 케이스 질문(기존 데모 답변) -->
  <PageHeader title-key="menu.ask" lead-key="views.askHub.lead" eyebrow-key="menu.group.tools" />
  <nav class="tabs-line" :aria-label="t('menu.ask')">
    <RouterLink to="/ask/papers" class="tab-link" active-class="active">{{ t('views.papers.tabPapers') }}</RouterLink>
    <RouterLink to="/ask/case" class="tab-link" active-class="active">{{ t('views.papers.tabCase') }}</RouterLink>
  </nav>
  <RouterView />
</template>
