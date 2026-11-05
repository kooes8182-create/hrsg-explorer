<script setup>
import { computed } from 'vue'
import { useEvaluation, norm } from '../../composables/useEvaluation.js'
import { t, nameOf } from '../../i18n/index.js'
import { txt, pressure } from '../../format.js'
import BasisBadge from '../BasisBadge.vue'
import ResultValue from '../ResultValue.vue'
import StatusCard from '../StatusCard.vue'
import Gauge from '../Gauge.vue'
import HrsgDiagram from '../HrsgDiagram.vue'
import CalcInfo from '../CalcInfo.vue'

const ev = useEvaluation()
const GAUGE_MAX_KPA = 6 // 표시용 눈금 범위 (운전 한계 아님)
const PRESSURE_KEYS = ['gt_back_pressure', 'hrsg_dp']

const looselyEqual = (a, b) => {
  const x = norm(a), y = norm(b)
  if (x === null || y === null) return x === y
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) === Number(y) : x === y
}
const differs = (key) => ev.mode.value === 'DEMO' && ev.currentScenario.value
  && !looselyEqual(ev.op.value(key), ev.currentScenario.value.operating_values[key])
const anyDiffers = computed(() => !!ev.shown.value && ev.shown.value.fields.some((f) => differs(f.key)))
const gauge = (key) => pressure(ev.opDisplay.value[key])
const gaugeMax = computed(() => pressure(GAUGE_MAX_KPA).value)
</script>

<template>
  <div class="row g-3">
    <div class="col-12 col-lg-5">
      <div class="card h-100">
        <div class="card-header fw-semibold">{{ t('views.evaluate.perfInput') }}</div>
        <div class="card-body">
          <div class="btn-group w-100 mb-2" role="group" :aria-label="t('views.evaluate.perfInput')">
            <button type="button" class="btn" :class="ev.mode.value === 'DEMO' ? 'btn-primary' : 'btn-outline-primary'"
              :disabled="ev.busy.performance" @click="ev.chooseDemo">{{ t('views.evaluate.modeDemo') }}</button>
            <button type="button" class="btn" :class="ev.mode.value === 'REAL' ? 'btn-primary' : 'btn-outline-primary'"
              :disabled="ev.busy.performance" @click="ev.chooseReal">{{ t('views.evaluate.modeReal') }}</button>
          </div>

          <div v-if="ev.mode.value === 'DEMO'" class="mb-3">
            <div class="small fw-semibold mb-1">{{ t('views.evaluate.pickScenario') }}</div>
            <div class="d-flex flex-wrap gap-2">
              <button v-for="s in ev.scenarioList.value" :key="s.id" type="button" class="btn btn-sm"
                :class="ev.currentScenario.value?.id === s.id ? 'btn-primary' : 'btn-outline-secondary'"
                :disabled="ev.busy.performance" @click="ev.chooseScenario(s)">{{ txt(s.label) }}</button>
            </div>
            <div class="small text-body-secondary mt-1">{{ t('views.evaluate.scenarioHelp') }}</div>
            <div v-if="ev.scenarios.value?.scenario_note" class="small text-body-secondary">{{ txt(ev.scenarios.value.scenario_note) }}</div>
          </div>
          <div v-else class="alert alert-secondary small py-2">— {{ t('views.evaluate.modeRealHelp') }}</div>

          <p class="small text-body-secondary mb-2">{{ t('views.evaluate.operatingHelp') }}</p>
          <div class="field-grid">
            <div v-for="f in ev.shown.value.fields" :key="f.key">
              <label class="form-label small mb-0 d-flex flex-wrap gap-1" :for="'op-' + f.key">
                {{ nameOf(f) }}
                <span v-if="differs(f.key)" class="text-warning-emphasis">▲ {{ t('views.evaluate.differsFromScenario') }}</span>
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
                class="small text-body-secondary">≈ {{ gauge(f.key).text }} {{ gauge(f.key).unit }}</div>
            </div>
          </div>
          <div v-if="ev.errors.performance.scenario_id" class="text-danger small">{{ ev.errors.performance.scenario_id.join(' ') }}</div>
        </div>
        <div class="card-footer d-flex flex-wrap align-items-center gap-2">
          <span v-if="ev.op.dirty.value" class="small fw-semibold text-warning-emphasis">▲ {{ t('common.unsaved', { n: Object.keys(ev.draft.value.operating).length }) }}</span>
          <span v-if="ev.message.performance" class="small text-danger">{{ ev.message.performance }}</span>
          <div class="ms-auto d-flex flex-wrap gap-2">
            <button v-if="ev.mode.value === 'DEMO' && ev.currentScenario.value && (anyDiffers || ev.op.dirty.value)"
              class="btn btn-sm btn-outline-secondary" :disabled="ev.busy.performance"
              @click="ev.chooseScenario(ev.currentScenario.value)">{{ t('views.evaluate.revertScenario') }}</button>
            <button class="btn btn-sm btn-primary" :disabled="ev.busy.performance || ev.pickingDemo.value" @click="ev.saveOperating">
              {{ ev.busy.performance ? t('common.saving') : t('views.evaluate.saveAndEvaluate') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="col-12 col-lg-7">
      <div class="card h-100">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ t('views.evaluate.perfTitle') }}</span>
          <BasisBadge v-if="ev.perf.value" :basis="ev.perf.value.meta.basis" :stale="ev.perfHidden.value" />
          <RouterLink v-if="ev.perf.value" :to="{ path: '/ask', query: { about: 'PERFORMANCE' } }" class="btn btn-sm btn-outline-primary ask-link">
            {{ t('views.ask.askAboutResult') }}
          </RouterLink>
        </div>
        <div class="card-body">
          <div v-if="!ev.perf.value" class="text-body-secondary">{{ t('views.evaluate.notEvaluated') }}</div>
          <template v-else>
            <div v-if="ev.perfHidden.value" class="alert alert-warning py-2 small">▲ {{ t('views.evaluate.staleHelp') }}</div>
            <div v-else-if="ev.perf.value.meta.notice" class="alert alert-light border py-2 small demo-notice">{{ txt(ev.perf.value.meta.notice) }}</div>
            <StatusCard :result="ev.perf.value.result" :hidden="ev.perfHidden.value" />
            <div class="row g-3 mt-1">
              <div class="col-6">
                <ResultValue :label="t('views.evaluate.loss')" :item="ev.perf.value.result.performance_loss" :hidden="ev.perfHidden.value" />
              </div>
              <div class="col-6">
                <ResultValue :label="t('views.evaluate.recovery')" :item="ev.perf.value.result.cleaning_recovery" :hidden="ev.perfHidden.value" />
              </div>
            </div>
          </template>

          <div class="small fw-semibold mt-3">{{ t('views.evaluate.gauges') }}</div>
          <div class="row g-2">
            <div class="col-6">
              <Gauge :label="t('views.evaluate.diagram.backPressure')" :value="gauge('gt_back_pressure').value" :unit="gauge('gt_back_pressure').unit"
                :max="gaugeMax" :virtual="ev.mode.value === 'DEMO'" />
            </div>
            <div class="col-6">
              <Gauge :label="t('views.evaluate.diagram.dp')" :value="gauge('hrsg_dp').value" :unit="gauge('hrsg_dp').unit"
                :max="gaugeMax" :virtual="ev.mode.value === 'DEMO'" />
            </div>
          </div>
          <div class="small text-body-secondary text-center mb-2">{{ t('views.evaluate.gaugeScale') }}</div>

          <div class="small fw-semibold">{{ t('views.evaluate.diagram.title') }}</div>
          <HrsgDiagram :values="ev.opDisplay.value" :virtual="ev.mode.value === 'DEMO'" />
          <CalcInfo v-if="ev.perf.value" :meta="ev.perf.value.meta" />
        </div>
      </div>
    </div>
  </div>
</template>
