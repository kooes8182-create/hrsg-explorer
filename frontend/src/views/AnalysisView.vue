<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ANALYSIS_TABS } from '../router.js'
import { useEvaluation } from '../composables/useEvaluation.js'
import { store, setPressureUnit } from '../store.js'
import { t } from '../i18n/index.js'
import PageHeader from '../components/PageHeader.vue'
import SummaryStrip from '../components/evaluate/SummaryStrip.vue'
import ReferenceSection from '../components/evaluate/ReferenceSection.vue'
import EconomicsSection from '../components/evaluate/EconomicsSection.vue'
import PinchSection from '../components/evaluate/PinchSection.vue'
import SourceList from '../components/evaluate/SourceList.vue'

// 분석: 핵심 요약(저장된 결과) → 탭별 상세 (세정 효과 추정 · 경제성 · 핀치·어프로치 · 근거 자료).
// 탭은 주소(/analysis/<탭>)에 남으므로 새로고침·뒤로 가기에도 같은 탭이 열립니다.
const ev = useEvaluation()
const route = useRoute()
const tab = computed(() => route.params.tab)
const SECTION = { reference: ReferenceSection, economics: EconomicsSection, pinch: PinchSection, sources: SourceList }
const UNITS = [{ key: 'kPa', label: 'kPa' }, { key: 'inH2O', label: 'in H2O' }, { key: 'mbar', label: 'mbar' }]
// 탭 옆 상태 점: 저장된 결과가 있으면 ●, 입력 변경으로 무효면 ▲
const RESULT = { reference: 'reference', economics: 'econ', pinch: 'pinch' }
const HIDDEN = { reference: 'referenceHidden', economics: 'econHidden', pinch: 'pinchHidden' }
function mark(k) {
  if (!RESULT[k] || !ev[RESULT[k]].value) return ''
  return ev[HIDDEN[k]].value ? '▲' : '●'
}
</script>

<template>
  <PageHeader title-key="menu.analysis" lead-key="views.analysis.lead" eyebrow-key="menu.group.work">
    <div class="seg" role="group" :aria-label="t('views.evaluate.pressureUnit')">
      <span class="seg-label">{{ t('views.evaluate.pressureUnit') }}</span>
      <button v-for="u in UNITS" :key="u.key" type="button" :class="{ on: store.pressureUnit === u.key }"
        :aria-pressed="store.pressureUnit === u.key" @click="setPressureUnit(u.key)">{{ u.label }}</button>
    </div>
  </PageHeader>

  <SummaryStrip />

  <nav class="tabs-line" :aria-label="t('menu.analysis')">
    <RouterLink v-for="k in ANALYSIS_TABS" :key="k" :to="'/analysis/' + k" class="tab-link"
      :class="{ active: tab === k }" :aria-current="tab === k ? 'page' : undefined">
      {{ t('views.analysis.tab.' + k) }}<span v-if="mark(k)" class="tab-mark" :class="{ stale: mark(k) === '▲' }">{{ mark(k) }}</span>
    </RouterLink>
  </nav>
  <p class="tab-lead">{{ t('views.analysis.tabLead.' + tab) }}</p>

  <Transition name="fade" mode="out-in">
    <component :is="SECTION[tab]" :key="tab" />
  </Transition>
</template>
