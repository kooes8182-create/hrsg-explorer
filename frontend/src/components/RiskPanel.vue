<script setup>
import { computed } from 'vue'
import { t } from '../i18n/index.js'
import { num, pressure } from '../format.js'
import BasisBadge from './BasisBadge.vue'
import TriggerScale from './TriggerScale.vue'
import RangeBar from './RangeBar.vue'

// 첫 화면의 '현재 상태 한눈에'. 서버에 저장된 결과만 그립니다(화면에서 계산·판정하지 않음).
// 입력 변경으로 무효가 된 결과는 수치 대신 '재평가 필요'로 표시합니다.
const props = defineProps({ results: Object })
const LOOK = { NORMAL: ['risk-normal', '●'], ALARM: ['risk-alarm', '▲'], TRIP: ['risk-trip', '■'] }

const perf = computed(() => props.results?.PERFORMANCE || null)
const ref_ = computed(() => props.results?.REFERENCE || null)
const pinch = computed(() => props.results?.PINCH_APPROACH || null)
const status = computed(() => (perf.value && !perf.value.stale ? perf.value.result.status.value : null))
const refRes = computed(() => (ref_.value && !ref_.value.stale && ref_.value.result.effects ? ref_.value.result : null))
const pinchRes = computed(() => (pinch.value && !pinch.value.stale && pinch.value.result.pinch?.value !== null
  ? pinch.value.result : null))
const empty = computed(() => !perf.value && !ref_.value && !pinch.value)
</script>

<template>
  <section class="card risk-panel" :aria-label="t('views.overview.risk.title')">
    <div class="card-header d-flex flex-wrap align-items-center gap-2">
      <span class="fw-semibold me-auto">{{ t('views.overview.risk.title') }}</span>
      <RouterLink to="/analysis" class="btn btn-sm btn-outline-primary">{{ t('views.overview.risk.open') }} →</RouterLink>
    </div>

    <div v-if="empty" class="card-body text-body-secondary">{{ t('views.overview.risk.empty') }}</div>

    <div v-else class="card-body risk-grid">
      <!-- 1. 운전 상태 -->
      <div class="risk-tile" :class="status ? LOOK[status][0] : 'risk-pending'">
        <div class="risk-label">{{ t('views.evaluate.summary.status') }}</div>
        <div class="risk-status">
          <template v-if="status">{{ LOOK[status][1] }} {{ t('views.evaluate.statusLabel.' + status) }}</template>
          <template v-else-if="perf?.stale">▲ {{ t('views.evaluate.stale') }}</template>
          <template v-else>— {{ t('views.evaluate.pending') }}</template>
        </div>
        <BasisBadge v-if="perf" :basis="perf.meta.basis" :stale="perf.stale" />
        <div class="risk-note">{{ status ? t('views.overview.risk.statusNote') : t('views.overview.risk.pendingNote') }}</div>
      </div>

      <!-- 2. 차압 증가 vs 세정 참고 기준 -->
      <div class="risk-tile">
        <div class="risk-label">{{ t('views.evaluate.summary.dpIncrease') }}</div>
        <template v-if="refRes">
          <div class="d-flex align-items-baseline gap-2 flex-wrap">
            <span class="big-number">{{ pressure(refRes.dp_increase.kpa.value).text }}<small>{{ pressure(refRes.dp_increase.kpa.value).unit }}</small></span>
            <span class="fw-semibold" :class="'pos-' + refRes.trigger_position">{{ t('views.evaluate.position.' + refRes.trigger_position) }}</span>
          </div>
          <TriggerScale :inc-in="refRes.dp_increase.in_h2o.value" :band="refRes.trigger_reference_in_h2o"
            :caption="t('views.evaluate.triggerBand')" />
        </template>
        <div v-else class="risk-status muted">{{ ref_?.stale ? '▲ ' + t('views.evaluate.stale') : t('views.evaluate.summary.none') }}</div>
      </div>

      <!-- 3. 출력 손실 참고 범위 + 핀치 -->
      <div class="risk-tile">
        <div class="risk-label">{{ t('views.evaluate.summary.lossRange') }}</div>
        <template v-if="refRes">
          <RangeBar v-if="refRes.effects.output_loss_mw.low.value !== null"
            :low="refRes.effects.output_loss_mw.low.value" :high="refRes.effects.output_loss_mw.high.value" unit="MW" low-label="GE" high-label="IST" />
          <RangeBar v-else :low="refRes.effects.output_loss_pct.low.value" :high="refRes.effects.output_loss_pct.high.value" unit="%" low-label="GE" high-label="IST" />
        </template>
        <div v-else class="risk-status muted">{{ t('views.evaluate.summary.none') }}</div>
        <div class="risk-pinch">
          <span class="risk-label">{{ t('views.evaluate.pinch') }}</span>
          <template v-if="pinchRes">
            <strong class="num">{{ num(pinchRes.pinch.value, 2) }} °C</strong>
            <span :class="'pinch-' + pinchRes.pinch_position">· {{ t('views.evaluate.pinchPosition.' + pinchRes.pinch_position) }}</span>
          </template>
          <span v-else class="text-body-secondary">{{ pinch?.stale ? t('views.evaluate.stale') : '—' }}</span>
        </div>
      </div>
    </div>
    <div v-if="!empty" class="card-footer small text-body-secondary">{{ t('views.overview.risk.footnote') }}</div>
  </section>
</template>
