<script setup>
import { computed } from 'vue'
import { useEvaluation, METHOD_KEYS, ECON_FIELDS } from '../../composables/useEvaluation.js'
import { t } from '../../i18n/index.js'
import { txt, num } from '../../format.js'
import BasisBadge from '../BasisBadge.vue'
import ResultValue from '../ResultValue.vue'
import CompareBars from '../CompareBars.vue'
import CalcInfo from '../CalcInfo.vue'
import SmpChart from '../SmpChart.vue'
import SourceChips from '../SourceChips.vue'

const ev = useEvaluation()
const econ = computed(() => ev.econ.value)
const smp = computed(() => ev.publicSmp.value)
const latest = computed(() => smp.value?.monthly[smp.value.monthly.length - 1])
const lastAnnual = computed(() => smp.value?.annual[smp.value.annual.length - 1])

// 문헌 참고 추정의 회복 MW (무효가 아닐 때만)
const refRecovery = computed(() => {
  const r = ev.reference.value
  if (!r || ev.referenceHidden.value || !r.result.recovery) return null
  const mw = r.result.recovery.output_loss_mw
  return mw.low.value === null ? null : { low: mw.low.value, high: mw.high.value }
})
const srcLabel = (s) => t('views.evaluate.source' + s)
</script>

<template>
  <div class="row g-3">
    <div class="col-12 col-lg-5">
      <div class="card h-100">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ t('views.evaluate.econInput') }}</span>
          <button class="btn btn-sm btn-outline-secondary" :title="t('views.evaluate.econDemoFillHelp')"
            :disabled="ev.busy.economics" @click="ev.fillDemoEconomics">{{ t('views.evaluate.econDemoFill') }}</button>
        </div>
        <div class="card-body">
          <div class="alert alert-info small py-2">{{ t('views.evaluate.econHoursHelp') }}</div>

          <label class="form-label small mb-0 d-flex flex-wrap gap-2" for="econ-smp">
            {{ t('views.evaluate.smp') }}
            <span v-if="ev.econSource('smp')" class="badge source-badge">{{ srcLabel(ev.econSource('smp')) }}</span>
          </label>
          <div class="input-group input-group-sm mb-2">
            <input id="econ-smp" class="form-control num-input" inputmode="decimal"
              :class="{ 'is-invalid': ev.econErr('smp'), 'item-dirty': 'smp' in ev.draft.value.economics }"
              :value="ev.econValue('smp')" @input="ev.setEcon('smp', $event.target.value)" />
            <span class="input-group-text unit-label">원/kWh</span>
            <div v-if="ev.econErr('smp')" class="invalid-feedback">{{ ev.econErr('smp').join(' ') }}</div>
          </div>
          <div v-if="smp" class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-sm btn-outline-primary" @click="ev.setEcon('smp', String(lastAnnual.value), 'PUBLIC')">
              {{ t('views.evaluate.useValue', { label: t('views.evaluate.annualLabel', { y: lastAnnual.year }), v: num(lastAnnual.value, 2) }) }}
            </button>
            <button class="btn btn-sm btn-outline-primary" @click="ev.setEcon('smp', String(latest.value), 'PUBLIC')">
              {{ t('views.evaluate.useValue', { label: t('views.evaluate.monthLabel', { m: latest.month }), v: num(latest.value, 2) }) }}
            </button>
          </div>

          <div class="row g-3">
            <div v-for="(k, i) in METHOD_KEYS" :key="k" class="col-12 col-sm-6 col-lg-12 col-xl-6">
              <fieldset class="method-box">
                <legend class="small fw-semibold"><span class="swatch" :class="'series-' + (i + 1)"></span>{{ t('views.evaluate.methodName', { k }) }}</legend>
                <div v-for="f in ECON_FIELDS" :key="f.key" class="mb-2">
                  <label class="form-label small mb-0 d-flex flex-wrap gap-1" :for="`econ-${k}-${f.key}`">
                    {{ t('views.evaluate.' + f.label) }}
                    <span v-if="ev.econSource(`${k}.${f.key}`)" class="badge source-badge">{{ srcLabel(ev.econSource(`${k}.${f.key}`)) }}</span>
                  </label>
                  <div class="input-group input-group-sm">
                    <input :id="`econ-${k}-${f.key}`" class="form-control num-input" inputmode="decimal"
                      :class="{ 'is-invalid': ev.econErr(`${k}.${f.key}`), 'item-dirty': `${k}.${f.key}` in ev.draft.value.economics }"
                      :disabled="f.key === 'extra_cost' && ev.econValue(`${k}.extra_cost_included`)"
                      :value="ev.econValue(`${k}.${f.key}`)" @input="ev.setEcon(`${k}.${f.key}`, $event.target.value)" />
                    <span class="input-group-text unit-label">{{ f.unit }}</span>
                    <div v-if="ev.econErr(`${k}.${f.key}`)" class="invalid-feedback">{{ ev.econErr(`${k}.${f.key}`).join(' ') }}</div>
                  </div>
                  <div v-if="f.key === 'recovered_mw' && refRecovery" class="d-flex flex-wrap gap-1 mt-1">
                    <span class="small text-body-secondary">{{ t('views.evaluate.fromReference') }}:</span>
                    <button class="btn btn-link btn-sm p-0" @click="ev.setEcon(`${k}.recovered_mw`, String(refRecovery.low), 'REFERENCE')">
                      {{ t('views.evaluate.refLow', { v: num(refRecovery.low, 2) }) }}</button>
                    <span class="small text-body-secondary">·</span>
                    <button class="btn btn-link btn-sm p-0" @click="ev.setEcon(`${k}.recovered_mw`, String(refRecovery.high), 'REFERENCE')">
                      {{ t('views.evaluate.refHigh', { v: num(refRecovery.high, 2) }) }}</button>
                  </div>
                </div>
                <div class="form-check small">
                  <input :id="`econ-${k}-included`" class="form-check-input" type="checkbox"
                    :checked="ev.econValue(`${k}.extra_cost_included`)"
                    @change="ev.setEcon(`${k}.extra_cost_included`, $event.target.checked)" />
                  <label class="form-check-label" :for="`econ-${k}-included`">{{ t('views.evaluate.extraIncluded') }}</label>
                </div>
              </fieldset>
            </div>
          </div>
          <div v-if="!refRecovery" class="small text-body-secondary mt-2">{{ t('views.evaluate.refNeeded') }}</div>
        </div>
        <div class="card-footer small d-flex flex-wrap gap-2 align-items-center">
          <span v-if="ev.busy.economics || ev.econDirty.value" class="text-warning-emphasis">
            <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>{{ t('views.evaluate.recalculating') }}
          </span>
          <span v-if="ev.message.economics" class="text-danger">{{ ev.message.economics }}</span>
          <span class="text-body-secondary ms-auto">{{ t('views.evaluate.econAuto') }}</span>
        </div>
      </div>
    </div>

    <div class="col-12 col-lg-7 d-flex flex-column gap-3">
      <div class="card">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ t('views.evaluate.econTitle') }}</span>
          <BasisBadge v-if="econ" :basis="econ.meta.basis" :stale="ev.econHidden.value" />
          <RouterLink v-if="econ" :to="{ path: '/ask', query: { about: 'ECONOMICS' } }" class="btn btn-sm btn-outline-primary ask-link">
            {{ t('views.ask.askAboutResult') }}
          </RouterLink>
        </div>
        <div class="card-body">
          <div v-if="!econ" class="text-body-secondary">{{ t('views.evaluate.econEmpty') }}</div>
          <template v-else>
            <div v-if="ev.econHidden.value" class="alert alert-warning py-2 small">▲ {{ t('views.evaluate.staleHelp') }}</div>
            <div class="alert alert-light border py-2 small">{{ txt(econ.result.notice) }}</div>
            <div class="d-flex flex-wrap align-items-baseline gap-2 mb-3">
              <ResultValue :label="t('views.evaluate.smp')" :item="econ.result.smp" :hidden="ev.econHidden.value" size="mid" />
              <span v-if="econ.result.smp.source && !ev.econHidden.value" class="badge source-badge">{{ srcLabel(econ.result.smp.source) }}</span>
            </div>
            <div class="row g-3">
              <div v-for="(m, i) in econ.result.methods" :key="m.key" class="col-12 col-md-6">
                <div class="method-result h-100">
                  <div class="d-flex align-items-center gap-2 mb-2">
                    <span class="swatch" :class="'series-' + (i + 1)"></span>
                    <span class="fw-semibold me-auto">{{ txt(m.name) }}</span>
                    <span v-if="!ev.econHidden.value && econ.result.max_net_benefit_method === m.key" class="badge req-badge">{{ t('views.evaluate.maxNet') }}</span>
                  </div>
                  <ResultValue :label="t('views.evaluate.netBenefit')" :item="m.net_benefit" :hidden="ev.econHidden.value" />
                  <dl class="row small mb-0 mt-2">
                    <dt class="col-6 fw-normal text-body-secondary">{{ t('views.evaluate.extraKwh') }}</dt>
                    <dd class="col-6 text-end"><ResultValue :item="m.extra_kwh" :hidden="ev.econHidden.value" size="sm" /></dd>
                    <dt class="col-6 fw-normal text-body-secondary">{{ t('views.evaluate.revenue') }}</dt>
                    <dd class="col-6 text-end"><ResultValue :item="m.revenue" :hidden="ev.econHidden.value" size="sm" /></dd>
                    <dt class="col-6 fw-normal text-body-secondary">{{ t('views.evaluate.recoveredMw') }}</dt>
                    <dd class="col-6 text-end">
                      <ResultValue :item="m.inputs.recovered_mw" :hidden="ev.econHidden.value" size="sm" />
                      <span v-if="m.inputs.recovered_mw.source && !ev.econHidden.value" class="badge source-badge">{{ srcLabel(m.inputs.recovered_mw.source) }}</span>
                    </dd>
                    <dt class="col-6 fw-normal text-body-secondary">{{ t('views.evaluate.cleaningCost') }}</dt>
                    <dd class="col-6 text-end">
                      <ResultValue :item="m.inputs.cleaning_cost" :hidden="ev.econHidden.value" size="sm" />
                      <span v-if="m.inputs.cleaning_cost.source && !ev.econHidden.value" class="badge source-badge">{{ srcLabel(m.inputs.cleaning_cost.source) }}</span>
                    </dd>
                    <dt class="col-6 fw-normal text-body-secondary">{{ t('views.evaluate.extraCost') }}</dt>
                    <dd class="col-6 text-end">
                      <span v-if="m.inputs.extra_cost_included" class="text-body-secondary">{{ t('views.evaluate.extraIncludedShort') }}</span>
                      <template v-else>
                        <ResultValue :item="m.inputs.extra_cost" :hidden="ev.econHidden.value" size="sm" />
                        <span v-if="m.inputs.extra_cost.source && !ev.econHidden.value" class="badge source-badge">{{ srcLabel(m.inputs.extra_cost.source) }}</span>
                      </template>
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <CompareBars v-if="!ev.econHidden.value" class="mt-3" :methods="econ.result.methods" />
            <CalcInfo :meta="econ.meta" />
          </template>
        </div>
      </div>

      <div v-if="smp" class="card">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ t('views.evaluate.smpRef') }}</span>
          <span class="badge basis-public">{{ t('views.evaluate.basis.PUBLIC') }}</span>
        </div>
        <div class="card-body">
          <div class="small fw-semibold mb-1">{{ t('views.evaluate.smpChartTitle') }} · {{ smp.unit }}</div>
          <SmpChart :monthly="smp.monthly" :annual="smp.annual" :unit="smp.unit" />
          <div class="d-flex flex-wrap gap-3 small mt-2">
            <span v-for="a in smp.annual" :key="a.year" class="annual-chip">{{ a.year }} <strong>{{ num(a.value, 2) }}</strong></span>
          </div>
          <div class="small text-body-secondary mt-2">{{ t('views.evaluate.smpNotice') }} · {{ txt(smp.source.scope) }}</div>
          <div class="small mt-1"><SourceChips :sources="[smp.source]" /></div>
        </div>
      </div>
    </div>
  </div>
</template>
