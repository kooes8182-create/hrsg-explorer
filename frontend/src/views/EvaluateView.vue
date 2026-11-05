<script setup>
import { provideEvaluation } from '../composables/useEvaluation.js'
import { store, setPressureUnit } from '../store.js'
import { t } from '../i18n/index.js'
import CaseGate from '../components/CaseGate.vue'
import SummaryStrip from '../components/evaluate/SummaryStrip.vue'
import PerformanceSection from '../components/evaluate/PerformanceSection.vue'
import ReferenceSection from '../components/evaluate/ReferenceSection.vue'
import EconomicsSection from '../components/evaluate/EconomicsSection.vue'
import PinchSection from '../components/evaluate/PinchSection.vue'
import SourceList from '../components/evaluate/SourceList.vue'

// 화면은 입력을 저장하고 서버 계산 결과를 그리기만 합니다. 계산·판정은 모두 서버(backend/calculators)에서 합니다.
const ev = provideEvaluation()
const SECTIONS = [
  { id: 'sec-perf', key: 'perf' },
  { id: 'sec-reference', key: 'reference' },
  { id: 'sec-econ', key: 'econ' },
  { id: 'sec-pinch', key: 'pinch' },
  { id: 'sec-sources', key: 'sources' },
]
const UNITS = [{ key: 'kPa', label: 'kPa' }, { key: 'inH2O', label: 'in H2O' }, { key: 'mbar', label: 'mbar' }]
const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
</script>

<template>
  <CaseGate title-key="menu.evaluate" lead-key="views.evaluate.lead">
    <div v-if="ev.loadError.value" class="alert alert-danger d-flex align-items-center gap-2">
      <span>{{ t('common.loadFailed') }}</span>
      <button class="btn btn-sm btn-light ms-auto" @click="ev.load">{{ t('server.retry') }}</button>
    </div>
    <div v-else-if="!ev.shown.value" class="text-body-secondary py-3">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
    </div>

    <template v-else>
      <SummaryStrip />

      <nav class="section-nav" :aria-label="t('menu.evaluate')">
        <div class="section-links">
          <button v-for="s in SECTIONS" :key="s.id" type="button" class="section-link" @click="jump(s.id)">
            {{ t('views.evaluate.nav.' + s.key) }}
          </button>
        </div>
        <div class="unit-switch" role="group" :aria-label="t('views.evaluate.pressureUnit')">
          <span class="small text-body-secondary">{{ t('views.evaluate.pressureUnit') }}</span>
          <button v-for="u in UNITS" :key="u.key" type="button" class="btn btn-sm"
            :class="store.pressureUnit === u.key ? 'btn-primary' : 'btn-outline-secondary'" @click="setPressureUnit(u.key)">{{ u.label }}</button>
        </div>
      </nav>

      <section id="sec-perf" class="eval-section">
        <h2 class="h5 section-title">{{ t('views.evaluate.perfTitle') }}</h2>
        <PerformanceSection />
      </section>
      <section id="sec-reference" class="eval-section">
        <h2 class="h5 section-title">{{ t('views.evaluate.refTitle') }}</h2>
        <ReferenceSection />
      </section>
      <section id="sec-econ" class="eval-section">
        <h2 class="h5 section-title">{{ t('views.evaluate.econTitle') }}</h2>
        <EconomicsSection />
      </section>
      <section id="sec-pinch" class="eval-section">
        <h2 class="h5 section-title">{{ t('views.evaluate.pinchTitle') }}</h2>
        <PinchSection />
      </section>
      <section id="sec-sources" class="eval-section">
        <SourceList />
      </section>
    </template>
  </CaseGate>
</template>
