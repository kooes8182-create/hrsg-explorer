<script setup>
import { t } from '../i18n/index.js'
import PageHeader from '../components/PageHeader.vue'
</script>

<template>
  <!-- 검색 성능 실험: 공식 평가셋 실험 기록(저장된 결과) / 질문별 검색 비교(개인 프로토타입 코퍼스) -->
  <PageHeader title-key="menu.lab" lead-key="views.lab.lead" eyebrow-key="menu.group.tools" />
  <nav class="tabs-line" :aria-label="t('menu.lab')">
    <RouterLink to="/lab/records" class="tab-link" active-class="active">{{ t('views.lab.tabRecords') }}</RouterLink>
    <RouterLink to="/lab/compare" class="tab-link" active-class="active">{{ t('views.lab.tabCompare') }}</RouterLink>
  </nav>
  <RouterView />
</template>
