<script setup>
import { computed, ref } from 'vue'
import { num } from '../format.js'

// 공개 SMP 월평균 막대 (실제 공개 통계). 연평균은 같은 축의 점선으로 표시합니다. 한 계열이라 범례 대신 제목으로 설명.
const props = defineProps({ monthly: Array, annual: Array, unit: String })

const W = 640, H = 200, L = 40, R = 12, T = 14, B = 28
const maxV = computed(() => Math.ceil(Math.max(...props.monthly.map((m) => m.value)) / 50) * 50)
const y = (v) => T + (1 - v / maxV.value) * (H - T - B)
const bw = computed(() => (W - L - R) / props.monthly.length)
const x = (i) => L + i * bw.value
const grid = computed(() => [0, maxV.value / 2, maxV.value])
const annualLines = computed(() => props.annual
  .map((a) => {
    const idx = props.monthly.map((m, i) => [m, i]).filter(([m]) => m.month.startsWith(a.year)).map(([, i]) => i)
    return idx.length ? { ...a, x1: x(idx[0]), x2: x(idx[idx.length - 1]) + bw.value } : null
  })
  .filter(Boolean))
const hover = ref(null)
</script>

<template>
  <figure class="smp-chart mb-0">
    <div class="diagram-scroll">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`SMP ${monthly[0].month}–${monthly[monthly.length - 1].month}`"
        @mouseleave="hover = null">
        <g v-for="gv in grid" :key="gv">
          <line :x1="L" :x2="W - R" :y1="y(gv)" :y2="y(gv)" class="chart-grid" />
          <text :x="L - 6" :y="y(gv) + 4" text-anchor="end" class="chart-axis">{{ gv }}</text>
        </g>
        <g v-for="(m, i) in monthly" :key="m.month" @mouseenter="hover = { ...m, i }">
          <rect :x="x(i)" :y="T" :width="bw" :height="H - T - B" fill="transparent" />
          <rect :x="x(i) + 2" :y="y(m.value)" :width="Math.max(bw - 4, 2)" :height="y(0) - y(m.value)" rx="3"
            class="smp-bar" :class="{ dim: hover && hover.i !== i }" />
          <text v-if="m.month.endsWith('-01') || i === monthly.length - 1" :x="x(i) + bw / 2" :y="H - 10" text-anchor="middle"
            class="chart-axis">{{ m.month }}</text>
        </g>
        <g v-for="a in annualLines" :key="a.year">
          <line :x1="a.x1" :x2="a.x2" :y1="y(a.value)" :y2="y(a.value)" class="smp-annual" />
          <text :x="a.x2 - 2" :y="y(a.value) - 5" text-anchor="end" class="chart-value">{{ a.year }} {{ num(a.value, 2) }}</text>
        </g>
      </svg>
    </div>
    <figcaption class="small text-body-secondary chart-hover" aria-live="polite">
      <template v-if="hover"><strong>{{ hover.month }}</strong> {{ num(hover.value, 2) }} {{ unit }}</template>
      <template v-else>&nbsp;</template>
    </figcaption>
  </figure>
</template>
