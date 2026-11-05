<script setup>
import { computed } from 'vue'
import { t } from '../i18n/index.js'
import { num } from '../format.js'

// 반원 게이지: 바늘 위치만 표시합니다. 경보·트립 구간은 그리지 않습니다 (실제 운전 한계 미확보).
// max 는 표시용 눈금 범위이며 운전 한계가 아닙니다.
const props = defineProps({ label: String, value: [Number, String], unit: String, max: Number, virtual: Boolean })

const v = computed(() => (props.value === null || props.value === undefined || props.value === '' ? null : Number(props.value)))
const ratio = computed(() => (v.value === null ? null : Math.min(Math.max(v.value / props.max, 0), 1)))
const off = computed(() => v.value !== null && (v.value > props.max || v.value < 0))
// 각도: 왼쪽(180°) → 오른쪽(0°)
const needle = computed(() => {
  if (ratio.value === null) return null
  const a = Math.PI * (1 - ratio.value)
  return { x: 60 + 44 * Math.cos(a), y: 62 - 44 * Math.sin(a) }
})
const ticks = computed(() => [0, 0.5, 1].map((r) => {
  const a = Math.PI * (1 - r)
  return { r, x: 60 + 58 * Math.cos(a), y: 66 - 58 * Math.sin(a), label: num(props.max * r, props.max >= 10 ? 0 : 1) }
}))
</script>

<template>
  <figure class="gauge mb-0">
    <svg viewBox="0 0 120 78" role="img" :aria-label="`${label}: ${v === null ? '—' : num(v)} ${unit}`">
      <path d="M 10 62 A 50 50 0 0 1 110 62" class="gauge-track" />
      <path v-if="ratio !== null" :d="`M 10 62 A 50 50 0 0 1 ${60 + 50 * Math.cos(Math.PI * (1 - ratio))} ${62 - 50 * Math.sin(Math.PI * (1 - ratio))}`"
        class="gauge-fill" />
      <line v-if="needle" x1="60" y1="62" :x2="needle.x" :y2="needle.y" class="gauge-needle" />
      <circle cx="60" cy="62" r="3.5" class="gauge-hub" />
      <text v-for="tk in ticks" :key="tk.r" :x="tk.x" :y="tk.y" class="gauge-tick" text-anchor="middle">{{ tk.label }}</text>
    </svg>
    <figcaption class="text-center">
      <div class="small text-body-secondary">{{ label }}</div>
      <div class="mid-number">{{ v === null ? '—' : num(v, unit === 'kPa' ? 2 : 1) }}<small>{{ unit }}</small></div>
      <div v-if="off" class="small text-warning-emphasis">{{ t('views.evaluate.outOfScale') }}</div>
      <div v-if="virtual && v !== null" class="small text-body-secondary">({{ t('views.evaluate.diagram.virtual') }})</div>
    </figcaption>
  </figure>
</template>
