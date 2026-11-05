<script setup>
import { computed } from 'vue'
import { num } from '../format.js'

// 참고 범위 막대: 0 부터 눈금 끝까지의 축 위에 낮은 쪽~높은 쪽 구간을 칠합니다. 값은 서버 결과 그대로.
const props = defineProps({
  low: Number,
  high: Number,
  unit: String,
  lowLabel: String,
  highLabel: String,
  digits: { type: Number, default: 2 },
})

// 눈금 끝: 높은 쪽의 1.25배를 1·2·2.5·5 ×10^n 단위로 올림
const scaleMax = computed(() => {
  const target = Math.max((props.high ?? 0) * 1.25, 0.1)
  const p = 10 ** Math.floor(Math.log10(target))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= target)
})
const pct = (v) => `${Math.min(Math.max((v / scaleMax.value) * 100, 0), 100)}%`
</script>

<template>
  <div class="range-bar" role="img" :aria-label="`${num(low, digits)}–${num(high, digits)} ${unit}`">
    <div class="range-value">
      <span class="mid-number">{{ num(low, digits) }}<span class="range-dash">–</span>{{ num(high, digits) }}</span>
      <span class="range-unit">{{ unit }}</span>
    </div>
    <div class="range-track">
      <div class="range-fill" :style="{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }"></div>
      <div class="range-tick" :style="{ left: pct(low) }"></div>
      <div class="range-tick" :style="{ left: pct(high) }"></div>
    </div>
    <div class="range-scale">
      <span>0</span>
      <span>{{ num(scaleMax) }}</span>
      <span v-if="lowLabel" class="range-end-label" :style="{ left: pct(low) }">{{ lowLabel }}</span>
      <span v-if="highLabel" class="range-end-label" :style="{ left: pct(high) }">{{ highLabel }}</span>
    </div>
  </div>
</template>
