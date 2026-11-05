<script setup>
import { computed, ref } from 'vue'
import { api } from '../../api.js'
import { store } from '../../store.js'
import { useEvaluation } from '../../composables/useEvaluation.js'
import { t, nameOf } from '../../i18n/index.js'
import { txt, pressure } from '../../format.js'
import BasisBadge from '../BasisBadge.vue'
import ResultValue from '../ResultValue.vue'
import RangeBar from '../RangeBar.vue'
import TriggerScale from '../TriggerScale.vue'
import SourceChips from '../SourceChips.vue'
import CalcInfo from '../CalcInfo.vue'

const ev = useEvaluation()
const note = ref('')
const r = computed(() => ev.reference.value?.result || null)
const hidden = computed(() => ev.referenceHidden.value)
const eff = computed(() => r.value?.effects || null)
const rec = computed(() => r.value?.recovery || null)

function useOperatingDp() {
  const v = ev.opDisplay.value.hrsg_dp
  if (v !== null) ev.refF.set('current_dp_kpa', v)
}
async function useChecklistClean() {
  note.value = ''
  const id = store.currentCaseId
  try {
    const cl = await api.checklist(id)
    if (id !== store.currentCaseId) return
    const item = cl.items.find((i) => i.key === 'clean_hrsg_dp')
    if (item?.value) ev.refF.set('clean_dp_kpa', item.value)
    else note.value = t('views.evaluate.checklistEmpty')
  } catch {
    note.value = t('common.loadFailed')
  }
}
const pressureHint = (key) => {
  if (store.pressureUnit === 'kPa' || !key.endsWith('_kpa')) return null
  const v = ev.refF.value(key)
  return v === '' ? null : pressure(v)
}
</script>

<template>
  <div class="row g-3">
    <div class="col-12 col-lg-5">
      <div class="card h-100">
        <div class="card-header fw-semibold">{{ t('views.evaluate.refInput') }}</div>
        <div class="card-body">
          <p class="small text-body-secondary">{{ t('views.evaluate.refHelp') }}</p>
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-sm btn-outline-secondary" :disabled="ev.opDisplay.value.hrsg_dp === null" @click="useOperatingDp">
              {{ t('views.evaluate.fromOperating') }}
            </button>
            <button class="btn btn-sm btn-outline-secondary" @click="useChecklistClean">{{ t('views.evaluate.fromChecklist') }}</button>
          </div>
          <div v-if="note" class="small text-warning-emphasis mb-2">{{ note }}</div>
          <div class="field-grid">
            <div v-for="f in ev.shown.value.reference_fields" :key="f.key">
              <label class="form-label small mb-0" :for="'ref-' + f.key">{{ nameOf(f) }}</label>
              <div class="input-group input-group-sm">
                <input :id="'ref-' + f.key" class="form-control num-input" inputmode="decimal"
                  :class="{ 'is-invalid': ev.errors.reference['reference.' + f.key], 'item-dirty': f.key in ev.draft.value.reference }"
                  :value="ev.refF.value(f.key)" @input="ev.refF.set(f.key, $event.target.value)" />
                <span class="input-group-text unit-label">{{ f.unit }}</span>
                <div v-if="ev.errors.reference['reference.' + f.key]" class="invalid-feedback">{{ ev.errors.reference['reference.' + f.key].join(' ') }}</div>
              </div>
              <div v-if="pressureHint(f.key)" class="small text-body-secondary">≈ {{ pressureHint(f.key).text }} {{ pressureHint(f.key).unit }}</div>
            </div>
          </div>
        </div>
        <div class="card-footer d-flex flex-wrap align-items-center gap-2">
          <span v-if="ev.refF.dirty.value" class="small fw-semibold text-warning-emphasis">▲ {{ t('common.unsaved', { n: Object.keys(ev.draft.value.reference).length }) }}</span>
          <span v-if="ev.message.reference" class="small text-danger">{{ ev.message.reference }}</span>
          <button class="btn btn-sm btn-primary ms-auto" :disabled="ev.busy.reference" @click="ev.saveReference">
            {{ ev.busy.reference ? t('common.saving') : t('views.evaluate.saveRef') }}
          </button>
        </div>
      </div>
    </div>

    <div class="col-12 col-lg-7">
      <div class="card h-100">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ t('views.evaluate.refTitle') }}</span>
          <BasisBadge :basis="ev.reference.value ? ev.reference.value.meta.basis : 'REFERENCE_ESTIMATE'" :stale="hidden" />
          <RouterLink v-if="ev.reference.value" :to="{ path: '/ask', query: { about: 'REFERENCE' } }" class="btn btn-sm btn-outline-primary ask-link">
            {{ t('views.ask.askAboutResult') }}
          </RouterLink>
        </div>
        <div class="card-body ref-body">
          <div class="alert alert-light border py-2 small ref-notice mb-3">{{ t('views.evaluate.refBadge') }} — {{ r ? txt(r.notice) : t('views.evaluate.refHelp') }}</div>
          <div v-if="!r" class="text-body-secondary">{{ t('views.evaluate.refEmpty') }}</div>
          <div v-else-if="hidden" class="alert alert-warning py-2 small">▲ {{ t('views.evaluate.staleHelp') }}</div>
          <template v-else>
            <div v-if="!eff" class="text-body-secondary">— {{ t('views.evaluate.unavailable') }} · {{ txt(r.effects_reason) }}</div>
            <template v-else>
              <div class="ref-grid">
                <div>
                  <div class="small text-body-secondary">{{ t('views.evaluate.dpIncrease') }}</div>
                  <div class="big-number">{{ pressure(r.dp_increase.kpa.value).text }}<small>{{ pressure(r.dp_increase.kpa.value).unit }}</small></div>
                  <div class="small fw-semibold" :class="'pos-' + r.trigger_position">{{ t('views.evaluate.position.' + r.trigger_position) }}</div>
                </div>
                <TriggerScale :inc-in="r.dp_increase.in_h2o.value" :band="r.trigger_reference_in_h2o" :caption="t('views.evaluate.triggerBand')" />
              </div>

              <div class="ref-grid mt-3">
                <div>
                  <div class="small text-body-secondary">{{ t('views.evaluate.lossPct') }}</div>
                  <RangeBar :low="eff.output_loss_pct.low.value" :high="eff.output_loss_pct.high.value" unit="%"
                    low-label="GE" high-label="IST" />
                </div>
                <div>
                  <div class="small text-body-secondary">{{ t('views.evaluate.lossMw') }}</div>
                  <RangeBar v-if="eff.output_loss_mw.low.value !== null" :low="eff.output_loss_mw.low.value" :high="eff.output_loss_mw.high.value" unit="MW" />
                  <ResultValue v-else :item="eff.output_loss_mw.low" size="sm" />
                </div>
              </div>
              <div class="small text-body-secondary mt-1">{{ t('views.evaluate.rangeEnds') }} · {{ t('views.evaluate.linearNote') }}</div>

              <div class="row g-3 mt-1">
                <div class="col-6 col-md-3"><ResultValue :label="t('views.evaluate.heatRate')" :item="eff.heat_rate_increase_pct" size="mid" />
                  <div class="small text-body-secondary">{{ t('views.evaluate.geOnly') }}</div></div>
                <div class="col-6 col-md-3"><ResultValue :label="t('views.evaluate.exhaustTemp')" :item="eff.exhaust_temp_increase_c" size="mid" />
                  <div class="small text-body-secondary">{{ t('views.evaluate.geOnly') }}</div></div>
                <div class="col-6 col-md-3"><ResultValue :label="t('views.evaluate.stLoss')" :item="r.steam_turbine_loss" size="sm" /></div>
                <div class="col-6 col-md-3"><ResultValue :label="t('views.evaluate.stackTemp')" :item="r.stack_temp_increase" size="sm" /></div>
              </div>

              <div class="mt-3">
                <div class="small text-body-secondary">{{ t('views.evaluate.recovery') }}</div>
                <template v-if="rec">
                  <RangeBar v-if="rec.output_loss_mw.low.value !== null" :low="rec.output_loss_mw.low.value" :high="rec.output_loss_mw.high.value" unit="MW" />
                  <RangeBar v-else :low="rec.output_loss_pct.low.value" :high="rec.output_loss_pct.high.value" unit="%" />
                </template>
                <div v-else class="small text-body-secondary">— {{ txt(r.recovery_reason) }}</div>
              </div>
            </template>
            <div class="mt-3 small"><SourceChips :sources="r.sources" /></div>
          </template>
          <CalcInfo v-if="ev.reference.value" :meta="ev.reference.value.meta" />
        </div>
      </div>
    </div>
  </div>
</template>
