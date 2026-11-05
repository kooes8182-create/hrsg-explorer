<script setup>
import { t } from '../i18n/index.js'

// 모든 화면 공통 머리말: 작은 위치 표시(eyebrow) + 큰 제목 + 한 줄 설명 + 오른쪽 보조 조작(slot)
defineProps({ titleKey: String, leadKey: String, eyebrowKey: String })
</script>

<template>
  <header class="page-header">
    <div class="page-header-text">
      <div v-if="eyebrowKey" class="eyebrow">{{ t(eyebrowKey) }}</div>
      <h1 class="page-title">{{ t(titleKey) }}</h1>
      <p v-if="leadKey" class="page-lead">{{ t(leadKey) }}</p>
    </div>
    <div v-if="$slots.default" class="page-header-actions"><slot /></div>
  </header>
</template>
