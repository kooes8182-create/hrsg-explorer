<script setup>
import { computed, ref } from 'vue'
import { t } from '../i18n/index.js'
import { num, txt, unit } from '../format.js'

// 가상 공법 A/B 비용·편익 비교 (가로 막대, 0 기준선). 값은 모두 서버 결과 그대로이며 화면에서 계산하지 않습니다.
// 음수 순편익은 0 기준선 왼쪽으로 그립니다. 값이 없으면 막대 대신 '산출 불가'.
const props = defineProps({ methods: Array })

const MEASURES = [
  { key: 'revenue', label: 'views.evaluate.revenue', get: (m) => m.revenue },
  { key: 'cleaning_cost', label: 'views.evaluate.cleaningCost', get: (m) => m.inputs.cleaning_cost },
  { key: 'extra_cost', label: 'views.evaluate.extraCost', get: (m) => m.inputs.extra_cost },
  { key: 'net_benefit', label: 'views.evaluate.netBenefit', get: (m) => m.net_benefit },
]
// LEFT: 항목 이름 칸, PAD: 막대 끝 값 라벨이 잘리지 않도록 양쪽 여백
const W = 640, LEFT = 170, RIGHT = 10, PAD = 52, BAR = 14, GAP = 2, GROUP = 2 * BAR + GAP + 22
const M = 1e6 // 표시 단위: 백만 원

const rows = computed(() => MEASURES.map((ms) => ({
  ...ms,
  bars: props.methods.map((m, i) => {
    const item = ms.get(m)
    const included = ms.key === 'extra_cost' && m.inputs.extra_cost_included
    return { method: m, i, value: item?.value ?? null, item, included }
  }),
})))

const domain = computed(() => {
  const vals = rows.value.flatMap((r) => r.bars.map((b) => b.value)).filter((v) => v !== null)
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  return hi === lo ? [lo, lo + 1] : [lo, hi]
})
const x = (v) => LEFT + PAD + ((v - domain.value[0]) / (domain.value[1] - domain.value[0])) * (W - LEFT - RIGHT - 2 * PAD)
const height = computed(() => rows.value.length * GROUP + 10)
const hover = ref(null)

function barRect(v) {
  const x0 = x(0), x1 = x(v)
  return { x: Math.min(x0, x1), w: Math.max(Math.abs(x1 - x0), 1) }
}
const fmt = (v) => num(v / M, 1)
</script>

<template>
  <figure class="compare-bars mb-0">
    <figcaption class="d-flex flex-wrap align-items-center gap-3 mb-2">
      <span class="fw-semibold">{{ t('views.evaluate.chartTitle') }}</span>
      <span class="legend-item"><span class="swatch series-1"></span>{{ txt(methods[0].name) }}</span>
      <span class="legend-item"><span class="swatch series-2"></span>{{ txt(methods[1].name) }}</span>
      <span class="small text-body-secondary ms-auto">{{ t('views.evaluate.chartUnit') }}</span>
    </figcaption>
    <div class="diagram-scroll">
      <svg :viewBox="`0 0 ${W} ${height}`" role="img" :aria-label="t('views.evaluate.chartTitle')">
        <line :x1="x(0)" :x2="x(0)" y1="0" :y2="height - 6" class="axis-zero" />
        <g v-for="(r, ri) in rows" :key="r.key" :transform="`translate(0, ${ri * GROUP + 6})`">
          <text x="0" :y="BAR + 4" class="chart-label">{{ t(r.label) }}</text>
          <g v-for="b in r.bars" :key="b.i" :transform="`translate(0, ${b.i * (BAR + GAP)})`"
            @mouseenter="hover = { r, b }" @mouseleave="hover = null">
            <!-- 마우스 영역은 막대보다 넓게 -->
            <rect :x="LEFT" y="-1" :width="W - LEFT" :height="BAR + 2" fill="transparent" />
            <template v-if="b.value !== null">
              <rect :x="barRect(b.value).x" y="0" :width="barRect(b.value).w" :height="BAR" rx="3"
                :class="'series-' + (b.i + 1)" :opacity="hover && hover.b !== b ? 0.45 : 1" />
              <text :x="b.value < 0 ? barRect(b.value).x - 4 : barRect(b.value).x + barRect(b.value).w + 4" :y="BAR - 3"
                :text-anchor="b.value < 0 ? 'end' : 'start'" class="chart-value">{{ fmt(b.value) }}</text>
            </template>
            <text v-else :x="x(0) + 4" :y="BAR - 3" class="chart-value muted">
              {{ b.included ? t('views.evaluate.extraIncludedShort') : '— ' + t('views.evaluate.unavailable') }}
            </text>
            <title>{{ txt(b.method.name) }} · {{ t(r.label) }}: {{ b.value === null ? '—' : num(b.value) + ' ' + (b.item?.unit || '') }}</title>
          </g>
        </g>
      </svg>
    </div>
    <div class="small text-body-secondary chart-hover" aria-live="polite">
      <template v-if="hover">
        {{ txt(hover.b.method.name) }} · {{ t(hover.r.label) }}:
        <strong>{{ hover.b.value === null ? '—' : num(hover.b.value) }}</strong> {{ hover.b.value === null ? '' : unit(hover.b.item?.unit) }}
      </template>
      <template v-else>&nbsp;</template>
    </div>
  </figure>
</template>
