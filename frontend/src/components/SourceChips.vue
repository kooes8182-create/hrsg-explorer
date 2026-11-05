<script setup>
import { txt } from '../format.js'

// 결과 옆에 붙는 짧은 출처 표시. 마우스를 올리면 자료명·쪽·적용 한계가 보입니다(링크·파일 없음).
defineProps({ sources: Array })
const SHORT = {
  GE_GER3567H: 'GE GER-3567H', IST_2000: 'IST 2000', POWER_2015: 'POWER 2015',
  ASME_PTC44: 'ASME PTC 4.4', IAPWS_IF97: 'IAPWS-IF97', KPX_SMP: 'KPX·EPSIS',
}
const short = (s) => SHORT[s.key] || s.title
</script>

<template>
  <span class="source-chips">
    <span v-for="s in sources" :key="s.key" class="source-chip" :title="`${s.title} — ${s.where}\n${txt(s.scope)}`">
      {{ short(s) }}
    </span>
  </span>
</template>
