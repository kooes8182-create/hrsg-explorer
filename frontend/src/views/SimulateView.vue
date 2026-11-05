<script setup>
import { computed, ref, watch } from 'vue'
import { useEvaluation, norm } from '../composables/useEvaluation.js'
import { store, setPressureUnit } from '../store.js'
import { t, nameOf } from '../i18n/index.js'
import { txt, pressure } from '../format.js'
import PageHeader from '../components/PageHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import BasisBadge from '../components/BasisBadge.vue'
import ResultValue from '../components/ResultValue.vue'
import StatusCard from '../components/StatusCard.vue'
import Gauge from '../components/Gauge.vue'
import HrsgDiagram from '../components/HrsgDiagram.vue'
import CalcInfo from '../components/CalcInfo.vue'

// 조건 설정 → 평가 실행 → 핵심 결과 → (분석 화면에서) 상세. 계산·판정은 서버에서 합니다.
const ev = useEvaluation()
const GAUGE_MAX_KPA = 6 // 표시용 눈금 범위 (운전 한계 아님)
const PRESSURE_KEYS = ['gt_back_pressure', 'hrsg_dp']
const UNITS = [{ key: 'kPa', label: 'kPa' }, { key: 'inH2O', label: 'in H2O' }, { key: 'mbar', label: 'mbar' }]
// 입력 묶음 (화면 배치만 정함. 항목 정의·단위는 서버가 줍니다). 목록에 없는 항목은 '추가 조건'으로 갑니다.
const GROUPS = [
  { key: 'gt', fields: ['gt_load', 'gt_exhaust_temp', 'gt_exhaust_flow', 'gt_back_pressure'] },
  { key: 'hrsg', fields: ['hrsg_dp', 'stack_temp', 'steam_flow'] },
]

const fields = computed(() => ev.shown.value.fields)
const grouped = computed(() => GROUPS.map((g) => ({ ...g, items: g.fields.map((k) => fields.value.find((f) => f.key === k)).filter(Boolean) })))
const advanced = computed(() => fields.value.filter((f) => !GROUPS.some((g) => g.fields.includes(f.key))))
const advOpen = ref(false)
// 추가 조건에 오류나 저장 전 변경이 있으면 펼쳐서 보여 줍니다.
watch(() => advanced.value.some((f) => ev.errors.performance[f.key] || f.key in ev.draft.value.operating), (v) => {
  if (v) advOpen.value = true
}, { immediate: true })

const looselyEqual = (a, b) => {
  const x = norm(a), y = norm(b)
  if (x === null || y === null) return x === y
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) === Number(y) : x === y
}
const differs = (key) => ev.mode.value === 'DEMO' && ev.currentScenario.value
  && !looselyEqual(ev.op.value(key), ev.currentScenario.value.operating_values[key])
const anyDiffers = computed(() => fields.value.some((f) => differs(f.key)))
const gauge = (key) => pressure(ev.opDisplay.value[key])
const gaugeMax = computed(() => pressure(GAUGE_MAX_KPA).value)
const dirtyN = computed(() => Object.keys(ev.draft.value.operating).length)
const busy = computed(() => ev.busy.performance)
</script>

<template>
  <PageHeader title-key="menu.simulate" lead-key="views.sim.lead" eyebrow-key="menu.group.work">
    <div class="seg" role="group" :aria-label="t('views.evaluate.pressureUnit')">
      <span class="seg-label">{{ t('views.evaluate.pressureUnit') }}</span>
      <button v-for="u in UNITS" :key="u.key" type="button" :class="{ on: store.pressureUnit === u.key }"
        :aria-pressed="store.pressureUnit === u.key" @click="setPressureUnit(u.key)">{{ u.label }}</button>
    </div>
  </PageHeader>

  <div class="work-grid">
    <!-- 조건 설정 -->
    <section class="panel work-input" :aria-label="t('views.sim.inputTitle')">
      <div class="step-label"><span>1</span>{{ t('views.sim.inputTitle') }}</div>

      <div class="field-label">{{ t('views.sim.method') }}</div>
      <div class="seg seg-block mb-3" role="group" :aria-label="t('views.sim.method')">
        <button type="button" :class="{ on: ev.mode.value === 'DEMO' }" :aria-pressed="ev.mode.value === 'DEMO'"
          :disabled="busy" @click="ev.chooseDemo">{{ t('views.evaluate.modeDemo') }}</button>
        <button type="button" :class="{ on: ev.mode.value === 'REAL' }" :aria-pressed="ev.mode.value === 'REAL'"
          :disabled="busy" @click="ev.chooseReal">{{ t('views.evaluate.modeReal') }}</button>
      </div>

      <div v-if="ev.mode.value === 'DEMO'" class="mb-3">
        <div class="field-label">{{ t('views.evaluate.pickScenario') }}</div>
        <div class="chip-row">
          <button v-for="s in ev.scenarioList.value" :key="s.id" type="button" class="chip"
            :class="{ on: ev.currentScenario.value?.id === s.id }" :aria-pressed="ev.currentScenario.value?.id === s.id"
            :disabled="busy" @click="ev.chooseScenario(s)">{{ txt(s.label) }}</button>
        </div>
        <div class="hint">{{ t('views.evaluate.scenarioHelp') }}</div>
        <div v-if="ev.pickingDemo.value" class="hint text-warning-emphasis">▲ {{ t('views.sim.pickFirst') }}</div>
      </div>
      <div v-else class="note-box mb-3">{{ t('views.evaluate.modeRealHelp') }}</div>

      <fieldset v-for="g in grouped" :key="g.key" class="field-group">
        <legend>{{ t('views.sim.group.' + g.key) }}</legend>
        <div class="field-grid">
          <div v-for="f in g.items" :key="f.key">
            <label class="form-label" :for="'op-' + f.key">
              {{ nameOf(f) }}
              <span v-if="differs(f.key)" class="text-warning-emphasis small">▲ {{ t('views.evaluate.differsFromScenario') }}</span>
            </label>
            <div class="input-group input-group-sm">
              <input :id="'op-' + f.key" class="form-control num-input"
                :class="{ 'is-invalid': ev.errors.performance[f.key], 'item-dirty': f.key in ev.draft.value.operating }"
                :inputmode="f.type === 'number' ? 'decimal' : 'text'"
                :value="ev.op.value(f.key)" @input="ev.op.set(f.key, $event.target.value)" />
              <span class="input-group-text unit-label">{{ f.unit }}</span>
              <div v-if="ev.errors.performance[f.key]" class="invalid-feedback">{{ ev.errors.performance[f.key].join(' ') }}</div>
            </div>
            <div v-if="PRESSURE_KEYS.includes(f.key) && gauge(f.key).unit !== 'kPa' && gauge(f.key).value !== null"
              class="hint">≈ {{ gauge(f.key).text }} {{ gauge(f.key).unit }}</div>
          </div>
        </div>
      </fieldset>

      <details v-if="advanced.length" class="field-group disclosure" :open="advOpen" @toggle="advOpen = $event.target.open">
        <summary>{{ t('views.sim.advanced') }} <span class="hint d-inline">{{ t('views.sim.advancedHelp') }}</span></summary>
        <div class="field-grid mt-2">
          <div v-for="f in advanced" :key="f.key">
            <label class="form-label" :for="'op-' + f.key">{{ nameOf(f) }}
              <span v-if="differs(f.key)" class="text-warning-emphasis small">▲ {{ t('views.evaluate.differsFromScenario') }}</span>
            </label>
            <div class="input-group input-group-sm">
              <input :id="'op-' + f.key" class="form-control num-input"
                :class="{ 'is-invalid': ev.errors.performance[f.key], 'item-dirty': f.key in ev.draft.value.operating }"
                :inputmode="f.type === 'number' ? 'decimal' : 'text'"
                :value="ev.op.value(f.key)" @input="ev.op.set(f.key, $event.target.value)" />
              <span class="input-group-text unit-label">{{ f.unit }}</span>
              <div v-if="ev.errors.performance[f.key]" class="invalid-feedback">{{ ev.errors.performance[f.key].join(' ') }}</div>
            </div>
          </div>
        </div>
      </details>
      <div class="hint">{{ t('views.evaluate.operatingHelp') }}</div>
      <div v-if="ev.errors.performance.scenario_id" class="text-danger small">{{ ev.errors.performance.scenario_id.join(' ') }}</div>

      <div class="run-bar">
        <div class="run-state" aria-live="polite">
          <span v-if="busy"><span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>{{ t('views.sim.running') }}</span>
          <span v-else-if="ev.message.performance" class="text-danger">■ {{ ev.message.performance }}</span>
          <span v-else-if="dirtyN" class="text-warning-emphasis">▲ {{ t('views.sim.dirty', { n: dirtyN }) }}</span>
          <span v-else-if="ev.perf.value" class="text-body-secondary">● {{ t('views.sim.upToDate') }}</span>
        </div>
        <div class="d-flex gap-2">
          <button v-if="ev.mode.value === 'DEMO' && ev.currentScenario.value && (anyDiffers || dirtyN)"
            class="btn btn-outline-secondary" :disabled="busy"
            @click="ev.chooseScenario(ev.currentScenario.value)">{{ t('views.evaluate.revertScenario') }}</button>
          <button class="btn btn-primary btn-run" :disabled="busy || ev.pickingDemo.value" @click="ev.saveOperating">
            <span v-if="busy" class="spinner-border spinner-border-sm" aria-hidden="true"></span><AppIcon v-else name="play" :size="14" />
            {{ busy ? t('views.sim.running') : t('views.sim.run') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 결과 -->
    <section class="work-result" :aria-label="t('views.sim.resultTitle')">
      <div class="panel">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
          <div class="step-label mb-0 me-auto"><span>2</span>{{ t('views.sim.resultTitle') }}</div>
          <BasisBadge v-if="ev.perf.value" :basis="ev.perf.value.meta.basis" :stale="ev.perfHidden.value" />
        </div>

        <div v-if="!ev.perf.value" class="empty-inline">
          <AppIcon name="simulate" :size="28" />
          <div>{{ t('views.sim.empty') }}</div>
        </div>
        <template v-else>
          <div v-if="ev.perfHidden.value" class="alert alert-warning py-2 small d-flex gap-2 align-items-start" role="status">
            <AppIcon name="alert" :size="16" /><span>{{ t('views.sim.staleHelp') }}</span>
          </div>
          <div v-else-if="ev.perf.value.meta.notice" class="note-box demo-notice mb-3">{{ txt(ev.perf.value.meta.notice) }}</div>
          <div class="result-hero">
            <StatusCard :result="ev.perf.value.result" :hidden="ev.perfHidden.value" />
            <div class="result-pair">
              <ResultValue :label="t('views.evaluate.loss')" :item="ev.perf.value.result.performance_loss" :hidden="ev.perfHidden.value" />
              <ResultValue :label="t('views.evaluate.recovery')" :item="ev.perf.value.result.cleaning_recovery" :hidden="ev.perfHidden.value" />
            </div>
          </div>
        </template>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="me-auto">
            <div class="panel-title">{{ t('views.evaluate.diagram.title') }}</div>
            <div class="panel-sub">{{ t('views.sim.diagramNote') }}</div>
          </div>
        </div>
        <HrsgDiagram :values="ev.opDisplay.value" :virtual="ev.mode.value === 'DEMO'" />
        <div class="row g-2 mt-2">
          <div class="col-6">
            <Gauge :label="t('views.evaluate.diagram.backPressure')" :value="gauge('gt_back_pressure').value" :unit="gauge('gt_back_pressure').unit"
              :max="gaugeMax" :virtual="ev.mode.value === 'DEMO'" />
          </div>
          <div class="col-6">
            <Gauge :label="t('views.evaluate.diagram.dp')" :value="gauge('hrsg_dp').value" :unit="gauge('hrsg_dp').unit"
              :max="gaugeMax" :virtual="ev.mode.value === 'DEMO'" />
          </div>
        </div>
        <div class="hint text-center">{{ t('views.evaluate.gaugeScale') }}</div>
        <CalcInfo v-if="ev.perf.value" :meta="ev.perf.value.meta" />
      </div>

      <div class="next-row">
        <RouterLink to="/analysis/reference" class="btn btn-outline-primary">{{ t('views.sim.next') }} <AppIcon name="arrow" :size="14" /></RouterLink>
        <RouterLink v-if="ev.perf.value" :to="{ path: '/ask', query: { about: 'PERFORMANCE' } }" class="btn btn-link">
          {{ t('views.ask.askAboutResult') }}</RouterLink>
      </div>
    </section>
  </div>
</template>
