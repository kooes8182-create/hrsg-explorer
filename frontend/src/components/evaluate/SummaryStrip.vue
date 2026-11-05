<script setup>
import { computed } from 'vue'
import { useEvaluation } from '../../composables/useEvaluation.js'
import { t } from '../../i18n/index.js'
import { num, pressure, unit } from '../../format.js'
import BasisBadge from '../BasisBadge.vue'

// 평가 화면 맨 위 한 줄 요약. 저장된 결과만 보여주고, 무효(재평가 필요)인 결과는 수치를 숨깁니다.
const ev = useEvaluation()
const LOOK = { NORMAL: ['status-normal', '●'], ALARM: ['status-alarm', '▲'], TRIP: ['status-trip', '■'] }

const status = computed(() => {
  const p = ev.perf.value
  if (!p) return null
  return { hidden: ev.perfHidden.value, value: p.result.status.value, basis: p.meta.basis }
})
const ref = computed(() => {
  const r = ev.reference.value
  if (!r) return null
  const res = r.result
  return { hidden: ev.referenceHidden.value, inc: res.dp_increase?.kpa?.value, incIn: res.dp_increase?.in_h2o?.value,
           position: res.trigger_position, mw: res.effects?.output_loss_mw, pct: res.effects?.output_loss_pct }
})
const best = computed(() => {
  const e = ev.econ.value
  if (!e || !e.result.max_net_benefit_method) return null
  const m = e.result.methods.find((x) => x.key === e.result.max_net_benefit_method)
  return { hidden: ev.econHidden.value, key: m.key, value: m.net_benefit.value }
})
</script>

<template>
  <section class="summary-strip" :aria-label="t('views.evaluate.lead')">
    <div class="summary-tile">
      <div class="summary-label">{{ t('views.evaluate.summary.status') }}</div>
      <template v-if="status && !status.hidden && status.value">
        <div class="summary-value" :class="LOOK[status.value][0]">{{ LOOK[status.value][1] }} {{ t('views.evaluate.statusLabel.' + status.value) }}</div>
        <BasisBadge :basis="status.basis" />
      </template>
      <div v-else-if="status" class="summary-value muted">— {{ status.hidden ? t('views.evaluate.stale') : t('views.evaluate.pending') }}</div>
      <div v-else class="summary-value muted">{{ t('views.evaluate.summary.none') }}</div>
    </div>

    <div class="summary-tile">
      <div class="summary-label">{{ t('views.evaluate.summary.dpIncrease') }}</div>
      <template v-if="ref && !ref.hidden && ref.inc !== null && ref.inc !== undefined">
        <div class="summary-value">{{ pressure(ref.inc).text }}<small>{{ pressure(ref.inc).unit }}</small></div>
        <div v-if="ref.position" class="summary-sub">{{ t('views.evaluate.position.' + ref.position) }}</div>
      </template>
      <div v-else class="summary-value muted">{{ ref?.hidden ? '— ' + t('views.evaluate.stale') : t('views.evaluate.summary.none') }}</div>
    </div>

    <div class="summary-tile">
      <div class="summary-label">{{ t('views.evaluate.summary.lossRange') }}</div>
      <template v-if="ref && !ref.hidden && ref.mw && ref.mw.low.value !== null">
        <div class="summary-value">{{ num(ref.mw.low.value, 2) }}–{{ num(ref.mw.high.value, 2) }}<small>MW</small></div>
        <BasisBadge basis="REFERENCE_ESTIMATE" />
      </template>
      <template v-else-if="ref && !ref.hidden && ref.pct">
        <div class="summary-value">{{ num(ref.pct.low.value, 2) }}–{{ num(ref.pct.high.value, 2) }}<small>%</small></div>
        <BasisBadge basis="REFERENCE_ESTIMATE" />
      </template>
      <div v-else class="summary-value muted">{{ ref?.hidden ? '— ' + t('views.evaluate.stale') : t('views.evaluate.summary.none') }}</div>
    </div>

    <div class="summary-tile">
      <div class="summary-label">{{ t('views.evaluate.summary.bestNet') }}</div>
      <template v-if="best && !best.hidden">
        <div class="summary-value" :data-negative="best.value < 0 || null">{{ num(best.value) }}<small>{{ unit('원') }}</small></div>
        <div class="summary-sub">{{ t('views.evaluate.methodName', { k: best.key }) }}</div>
        <BasisBadge basis="USER_ASSUMPTION" />
      </template>
      <div v-else class="summary-value muted">{{ best?.hidden ? '— ' + t('views.evaluate.stale') : t('views.evaluate.summary.none') }}</div>
    </div>
  </section>
</template>
