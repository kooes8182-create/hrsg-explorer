<script setup>
import { computed } from 'vue'
import { num } from '../format.js'

// 청정 대비 차압 증가(in H2O)를 세정 참고 기준(3~4 in H2O, POWER 2015) 구간과 나란히 보여줍니다. 판정이 아닌 참고 비교.
const props = defineProps({ incIn: Number, band: Array, caption: String })
const scaleMax = computed(() => Math.max(8, Math.ceil(((props.incIn ?? 0) * 1.15) / 2) * 2))
const pct = (v) => `${Math.min(Math.max((v / scaleMax.value) * 100, 0), 100)}%`
const ticks = computed(() => Array.from({ length: scaleMax.value / 2 + 1 }, (_, i) => i * 2))
</script>

<template>
  <figure class="trigger-scale mb-0">
    <div class="trigger-track">
      <div class="trigger-band" :style="{ left: pct(band[0]), width: `calc(${pct(band[1])} - ${pct(band[0])})` }"></div>
      <div v-if="incIn !== null && incIn !== undefined" class="trigger-marker" :style="{ left: pct(incIn) }">
        <span class="trigger-marker-label">{{ num(incIn, 2) }}</span>
      </div>
    </div>
    <div class="trigger-ticks">
      <span v-for="tk in ticks" :key="tk" :style="{ left: pct(tk) }">{{ tk }}</span>
    </div>
    <figcaption class="small text-body-secondary mt-3">{{ caption }}</figcaption>
  </figure>
</template>
