<script setup>
import { t } from '../i18n/index.js'
import { num, txt, unit } from '../format.js'

// 결과 값 1개: 큰 숫자 + 단위. 값이 없으면 '산출 불가' + 서버가 준 사유. 가려진(stale) 상태면 숫자를 숨깁니다.
defineProps({
  label: String,
  item: Object, // { value, unit, reason }
  hidden: Boolean,
  size: { type: String, default: 'big' }, // 'big' | 'mid' | 'sm'
  digits: Number,
})
const SIZE = { big: 'big-number', mid: 'mid-number', sm: 'sm-number' }
</script>

<template>
  <div class="result-value" :class="{ 'd-inline-block': size === 'sm' }">
    <div v-if="label" class="small text-body-secondary">{{ label }}</div>
    <div v-if="hidden" class="text-warning-emphasis fw-semibold">— {{ size === 'sm' ? '' : t('views.evaluate.stale') }}</div>
    <template v-else-if="item && item.value !== null && item.value !== undefined">
      <div :class="SIZE[size]" :data-negative="Number(item.value) < 0 || null">
        {{ num(item.value, digits) }}<small>{{ unit(item.unit) }}</small>
      </div>
    </template>
    <template v-else-if="item && item.reason">
      <div class="fw-semibold text-body-secondary">— {{ t('views.evaluate.unavailable') }}</div>
      <div class="small text-body-secondary">{{ txt(item.reason) }}</div>
    </template>
    <div v-else-if="item" class="text-body-secondary">—</div>
    <div v-else class="text-body-secondary">—</div>
  </div>
</template>
