<script setup>
import { computed, ref } from 'vue'
import { api } from '../../api.js'
import { store } from '../../store.js'
import { useEvaluation } from '../../composables/useEvaluation.js'
import { t, nameOf } from '../../i18n/index.js'
import { txt, num } from '../../format.js'
import BasisBadge from '../BasisBadge.vue'
import ResultValue from '../ResultValue.vue'
import SourceChips from '../SourceChips.vue'
import CalcInfo from '../CalcInfo.vue'

const ev = useEvaluation()
const note = ref('')
const r = computed(() => ev.pinch.value?.result || null)
const hidden = computed(() => ev.pinchHidden.value)

async function loadFromChecklist() {
  note.value = ''
  const id = store.currentCaseId
  try {
    const cl = await api.checklist(id)
    if (id !== store.currentCaseId) return
    for (const f of ev.shown.value.pinch_fields) {
      const item = cl.items.find((i) => i.key === f.key)
      if (item?.value !== null && item?.value !== undefined) ev.pinchF.set(f.key, item.value)
    }
  } catch {
    note.value = t('common.loadFailed')
  }
}

// 핀치 값을 참고 범위(°C) 축 위에 표시
const pinchScale = computed(() => {
  if (!r.value || r.value.pinch.value === null) return null
  const [lo, hi] = r.value.reference_ranges.pinch_c
  const max = Math.max(hi * 1.5, r.value.pinch.value * 1.15, 1)
  const min = Math.min(0, r.value.pinch.value * 1.15)
  const pct = (v) => `${((v - min) / (max - min)) * 100}%`
  return { lo, hi, v: r.value.pinch.value, left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})`, at: pct(r.value.pinch.value) }
})
</script>

<template>
  <div class="row g-3">
    <div class="col-12 col-lg-5">
      <div class="card h-100">
        <div class="card-header fw-semibold">{{ t('views.evaluate.pinchInput') }}</div>
        <div class="card-body">
          <p class="small text-body-secondary">{{ t('views.evaluate.pinchHelp2') }}</p>
          <div v-for="f in ev.shown.value.pinch_fields" :key="f.key" class="mb-2">
            <label class="form-label small mb-0" :for="'pinch-' + f.key">{{ nameOf(f) }}</label>
            <div class="input-group input-group-sm">
              <input :id="'pinch-' + f.key" class="form-control num-input" inputmode="decimal"
                :class="{ 'is-invalid': ev.errors.pinch['pinch.' + f.key], 'item-dirty': f.key in ev.draft.value.pinch }"
                :value="ev.pinchF.value(f.key)" @input="ev.pinchF.set(f.key, $event.target.value)" />
              <span class="input-group-text unit-label">{{ f.unit }}</span>
              <div v-if="ev.errors.pinch['pinch.' + f.key]" class="invalid-feedback">{{ ev.errors.pinch['pinch.' + f.key].join(' ') }}</div>
            </div>
            <div v-if="f.key === 'drum_pressure'" class="mt-1">
              <div class="small mb-1">{{ t('views.evaluate.basisLabel') }}</div>
              <div class="btn-group btn-group-sm" role="group" :aria-label="t('views.evaluate.basisLabel')">
                <button type="button" class="btn" :class="ev.pinchF.value('drum_pressure_basis') === 'gauge' ? 'btn-primary' : 'btn-outline-secondary'"
                  @click="ev.pinchF.set('drum_pressure_basis', 'gauge')">{{ t('views.evaluate.basisGauge') }}</button>
                <button type="button" class="btn" :class="ev.pinchF.value('drum_pressure_basis') === 'absolute' ? 'btn-primary' : 'btn-outline-secondary'"
                  @click="ev.pinchF.set('drum_pressure_basis', 'absolute')">{{ t('views.evaluate.basisAbsolute') }}</button>
              </div>
              <div v-if="ev.pinchF.value('drum_pressure_basis') === 'gauge'" class="small text-body-secondary mt-1">{{ t('views.evaluate.gaugeNote') }}</div>
              <div v-if="ev.errors.pinch['pinch.drum_pressure_basis']" class="small text-danger">{{ ev.errors.pinch['pinch.drum_pressure_basis'].join(' ') }}</div>
            </div>
          </div>
          <div v-if="note" class="small text-danger">{{ note }}</div>
        </div>
        <div class="card-footer d-flex flex-wrap gap-2 align-items-center">
          <span v-if="ev.message.pinch" class="small text-danger">{{ ev.message.pinch }}</span>
          <div class="ms-auto d-flex flex-wrap gap-2">
            <button class="btn btn-sm btn-outline-secondary" @click="loadFromChecklist">{{ t('views.evaluate.loadFromChecklist') }}</button>
            <button class="btn btn-sm btn-primary" :disabled="ev.busy['pinch-approach']" @click="ev.savePinch">{{ t('views.evaluate.saveAndCheck') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="col-12 col-lg-7">
      <div class="card h-100">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ t('views.evaluate.pinchTitle') }}</span>
          <BasisBadge :basis="ev.pinch.value ? ev.pinch.value.meta.basis : 'REFERENCE_ESTIMATE'" :stale="hidden" />
          <RouterLink v-if="ev.pinch.value" :to="{ path: '/ask', query: { about: 'PINCH_APPROACH' } }" class="btn btn-sm btn-outline-primary ask-link">
            {{ t('views.ask.askAboutResult') }}
          </RouterLink>
        </div>
        <div class="card-body">
          <div v-if="!r" class="text-body-secondary">{{ t('views.evaluate.pinchHelp2') }}</div>
          <div v-else-if="hidden" class="alert alert-warning py-2 small">▲ {{ t('views.evaluate.staleHelp') }}</div>
          <template v-else>
            <div class="row g-3">
              <div class="col-12 col-sm-4"><ResultValue :label="t('views.evaluate.saturation')" :item="r.saturation_temp" size="mid" />
                <div v-if="r.drum_pressure_abs_mpa" class="small text-body-secondary">{{ num(r.drum_pressure_abs_mpa, 4) }} MPa a · IAPWS-IF97</div></div>
              <div class="col-6 col-sm-4"><ResultValue :label="t('views.evaluate.pinch')" :item="r.pinch" /></div>
              <div class="col-6 col-sm-4"><ResultValue :label="t('views.evaluate.approach')" :item="r.approach" /></div>
            </div>
            <div v-if="pinchScale" class="pinch-scale mt-3" role="img"
              :aria-label="`${t('views.evaluate.pinch')} ${num(pinchScale.v, 2)} °C`">
              <div class="trigger-track">
                <div class="trigger-band" :style="{ left: pinchScale.left, width: pinchScale.width }"></div>
                <div class="trigger-marker" :style="{ left: pinchScale.at }"><span class="trigger-marker-label">{{ num(pinchScale.v, 1) }}</span></div>
              </div>
              <div class="small fw-semibold mt-3">{{ t('views.evaluate.pinch') }}: {{ t('views.evaluate.pinchPosition.' + r.pinch_position) }}</div>
            </div>
            <div class="small text-body-secondary mt-2">
              {{ t('views.evaluate.referenceRange') }}: {{ t('views.evaluate.pinchRangeText', { a: num(r.reference_ranges.pinch_c[0], 2), b: num(r.reference_ranges.pinch_c[1], 2) }) }},
              {{ t('views.evaluate.approachTypicalText', { v: num(r.reference_ranges.approach_typical_c, 2) }) }}
            </div>
            <div v-if="r.approach_steaming_note" class="alert alert-warning small py-2 mt-2">▲ {{ txt(r.approach_steaming_note) }}</div>
            <div class="alert alert-light border small py-2 mt-2 mb-0">{{ txt(r.notice) }}</div>
            <div class="small mt-2"><SourceChips :sources="r.sources" /></div>
          </template>
          <CalcInfo v-if="ev.pinch.value" :meta="ev.pinch.value.meta" />
        </div>
      </div>
    </div>
  </div>
</template>
