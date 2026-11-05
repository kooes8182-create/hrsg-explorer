<script setup>
import { t } from '../i18n/index.js'

// 결과 근거 표시. stale 이면 서버 basis 보다 '재평가 필요'를 우선합니다.
defineProps({ basis: String, stale: Boolean })
const LOOK = {
  DEMO_FIXED: 'basis-demo',
  USER_ASSUMPTION: 'basis-user',
  UNAVAILABLE: 'basis-na',
  REEVALUATION_REQUIRED: 'basis-stale',
}
</script>

<template>
  <span v-if="stale" class="badge basis-stale">▲ {{ t('views.evaluate.basis.REEVALUATION_REQUIRED') }}</span>
  <span v-else-if="basis" class="badge" :class="LOOK[basis]">{{ t('views.evaluate.basis.' + basis) }}</span>
</template>
