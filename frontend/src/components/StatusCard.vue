<script setup>
import { computed } from 'vue'
import { t } from '../i18n/index.js'
import { txt } from '../format.js'

// 운전 상태: 색상 + 기호 + 글자. 값이 없으면 '판정 보류' + 사유.
const props = defineProps({ result: Object, hidden: Boolean })
const LOOK = {
  NORMAL: { cls: 'status-normal', mark: '●' },
  ALARM: { cls: 'status-alarm', mark: '▲' },
  TRIP: { cls: 'status-trip', mark: '■' },
}
const status = computed(() => (props.hidden ? null : props.result?.status?.value || null))
</script>

<template>
  <div class="status-card" :class="status ? LOOK[status].cls : 'status-pending'" role="status">
    <div class="small">{{ t('views.evaluate.status') }}</div>
    <div class="status-text">
      <template v-if="status">{{ LOOK[status].mark }} {{ t('views.evaluate.statusLabel.' + status) }}</template>
      <template v-else>— {{ hidden ? t('views.evaluate.stale') : t('views.evaluate.pending') }}</template>
    </div>
    <div v-if="!hidden" class="small">
      <template v-if="status">{{ t('views.evaluate.statusBasis') }}: {{ txt(result.status_basis) }}</template>
      <template v-else-if="result">{{ txt(result.status?.reason) }}</template>
    </div>
  </div>
</template>
