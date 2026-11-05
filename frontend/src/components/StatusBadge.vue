<script setup>
import { t } from '../i18n/index.js'

defineProps({ status: String })

// 체크리스트 상태: 색상 + 기호 + 글자
const LOOK = {
  MISSING: { cls: 'text-bg-secondary', mark: '○' },
  RECEIVED: { cls: 'text-bg-primary', mark: '◐' },
  VERIFIED: { cls: 'text-bg-success', mark: '●' },
}
</script>

<template>
  <span class="badge fw-normal" :class="LOOK[status].cls">{{ LOOK[status].mark }} {{ t('status.' + status) }}</span>
</template>
