<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../api.js'
import { store, currentCase, checkServer, updateCase, dirtyCount, deleteCase } from '../store.js'
import { t } from '../i18n/index.js'
import { dateTime } from '../format.js'
import CaseGate from '../components/CaseGate.vue'
import CaseForm from '../components/CaseForm.vue'
import RiskPanel from '../components/RiskPanel.vue'
import AppModal from '../components/AppModal.vue'
import AppIcon from '../components/AppIcon.vue'
import HrsgDiagram from '../components/HrsgDiagram.vue'

// 첫 화면: 앱의 목적 → 주 행동 → 현재 케이스의 HRSG 도식(저장된 운전값) → 작업 단계 → 최근 결과 → 케이스 관리.
// 보여 주는 값은 모두 서버에 저장된 것뿐입니다(화면에서 계산·판정하지 않음).
const data = ref(null)
const error = ref(false)
const editing = ref(false)

async function load() {
  const id = store.currentCaseId
  const lang = store.lang
  if (!id) return
  error.value = false
  try {
    const [ov, results, inputs] = await Promise.all([api.overview(id, lang), api.results(id), api.inputs(id)])
    if (id === store.currentCaseId && lang === store.lang) data.value = { ...ov, results, inputs }
  } catch {
    if (id === store.currentCaseId) error.value = true
  }
}
watch(() => [store.currentCaseId, store.lang], () => {
  data.value = null
  editing.value = false
  load()
}, { immediate: true })

const shown = computed(() => (data.value?.case.id === store.currentCaseId ? data.value : null))
const LOOK = { NORMAL: ['status-normal', '●'], ALARM: ['status-alarm', '▲'], TRIP: ['status-trip', '■'] }
const perf = computed(() => shown.value?.results.PERFORMANCE || null)
const status = computed(() => (perf.value && !perf.value.stale ? perf.value.result.status.value : null))

// 작업 단계별 현재 상태 (저장된 값으로만)
const ANALYSIS_KINDS = ['REFERENCE', 'ECONOMICS', 'PINCH_APPROACH']
const analysisDone = computed(() =>
  shown.value ? ANALYSIS_KINDS.filter((k) => shown.value.results[k] && !shown.value.results[k].stale).length : 0)
const steps = computed(() => {
  const s = shown.value
  return [
    { to: '/data', icon: 'data', key: 'data',
      state: s ? t('views.home.stepState.data', { a: s.readiness.received_pct, b: s.readiness.verified_pct }) : null },
    { to: '/simulate', icon: 'simulate', key: 'simulate',
      state: !s ? null : status.value ? t('views.home.stepState.status', { s: t('views.evaluate.statusLabel.' + status.value) })
        : perf.value?.stale ? t('views.evaluate.stale') : perf.value ? t('views.evaluate.pending') : t('views.home.stepState.notRun') },
    { to: '/analysis', icon: 'analysis', key: 'analysis',
      state: s ? t('views.home.stepState.analysis', { n: analysisDone.value, total: ANALYSIS_KINDS.length }) : null },
    { to: '/ask', icon: 'ask', key: 'ask', state: null },
  ]
})

// 케이스 삭제: 이름을 그대로 입력해야 버튼이 켜지고, 서버도 이름을 다시 확인합니다.
const deleting = ref(null)
function openDelete() {
  deleting.value = { name: currentCase.value.name, input: '', busy: false, error: '' }
}
async function confirmDelete() {
  const d = deleting.value
  d.busy = true
  d.error = ''
  try {
    await deleteCase(store.currentCaseId, d.input)
    deleting.value = null
  } catch (err) {
    d.error = err.kind === 'input' ? (err.fields.confirm_name || []).join(' ') : t('common.saveFailed')
    if (err.kind !== 'input') checkServer()
  } finally {
    if (deleting.value) d.busy = false
  }
}
async function saveCase(form) {
  const updated = await updateCase(store.currentCaseId, form)
  editing.value = false
  load()
  return updated
}

// 서버가 주는 '다음에 할 일' 링크를 새 화면 주소로 (예전 /evaluate → 해당 화면)
const ACTION_LINK = { ENTER_ECONOMICS: '/analysis/economics', ENTER_OPERATING: '/simulate', REEVALUATE: '/simulate' }
const actionLink = (a) => ACTION_LINK[a.code] || a.link

const conn = computed(() => {
  const s = store.server.state
  return [
    { key: 'frontend', ok: true },
    { key: 'backend', ok: s === 'checking' ? null : s === 'ok' || s === 'db_error' },
    { key: 'database', ok: s === 'checking' ? null : s === 'ok' },
  ]
})
</script>

<template>
  <!-- 1. 앱의 목적 + 주 행동 -->
  <section class="hero">
    <div class="eyebrow">{{ t('views.home.eyebrow') }}</div>
    <h1 class="hero-title">{{ t('views.home.title') }}</h1>
    <p class="hero-lead">{{ t('views.home.lead') }}</p>
    <div class="hero-actions">
      <RouterLink to="/simulate" class="btn btn-primary btn-lg"><AppIcon name="play" :size="16" />{{ t('views.home.cta') }}</RouterLink>
      <RouterLink to="/ask/papers" class="btn btn-outline-secondary btn-lg">{{ t('views.home.ctaAsk') }}</RouterLink>
    </div>
  </section>

  <!-- 2. 중심 시각 요소: 현재 케이스의 HRSG 흐름 (저장된 운전값) -->
  <section class="panel hero-visual" :aria-label="t('views.evaluate.diagram.title')">
    <div class="panel-head">
      <div class="me-auto min-w-0">
        <div class="panel-title">{{ t('views.evaluate.diagram.title') }}</div>
        <div class="panel-sub">
          <template v-if="currentCase">{{ currentCase.name }}<template v-if="shown?.inputs.updated_at"> · {{ t('views.home.savedAt') }} {{ dateTime(shown.inputs.updated_at) }}</template></template>
          <template v-else>{{ t('case.none') }}</template>
        </div>
      </div>
      <span v-if="status" class="status-pill" :class="LOOK[status][0]">{{ LOOK[status][1] }} {{ t('views.evaluate.statusLabel.' + status) }}</span>
      <span v-else-if="perf?.stale" class="status-pill status-pending">▲ {{ t('views.evaluate.stale') }}</span>
      <span v-else-if="shown" class="status-pill status-pending">— {{ perf ? t('views.evaluate.pending') : t('views.home.stepState.notRun') }}</span>
    </div>
    <HrsgDiagram :values="shown?.inputs.operating_values || {}" :virtual="shown?.inputs.mode === 'DEMO'" />
    <div class="panel-foot">
      <span>{{ shown?.inputs.mode === 'DEMO' ? t('views.home.diagramDemo') : t('views.home.diagramNote') }}</span>
      <RouterLink to="/simulate" class="link-arrow">{{ t('views.home.changeValues') }} <AppIcon name="arrow" :size="14" /></RouterLink>
    </div>
  </section>

  <!-- 3. 작업 단계 (진입점) -->
  <nav class="flow-steps" :aria-label="t('views.home.stepsLabel')">
    <RouterLink v-for="(s, i) in steps" :key="s.key" :to="s.to" class="flow-step">
      <span class="flow-num">{{ i + 1 }}</span>
      <span class="flow-body">
        <span class="flow-name"><AppIcon :name="s.icon" :size="16" />{{ t('views.home.step.' + s.key) }}</span>
        <span class="flow-desc">{{ t('views.home.stepDesc.' + s.key) }}</span>
        <span v-if="s.state" class="flow-state">{{ s.state }}</span>
      </span>
      <AppIcon name="chevron" :size="16" class="flow-go" />
    </RouterLink>
  </nav>
  <div class="text-end mb-4">
    <RouterLink to="/lab" class="small link-arrow">{{ t('views.home.labLink') }} <AppIcon name="arrow" :size="14" /></RouterLink>
  </div>

  <!-- 4. 최근 결과 + 케이스 관리 (케이스가 있을 때) -->
  <CaseGate>
    <div v-if="error" class="alert alert-danger d-flex align-items-center gap-2">
      <span>{{ t('common.loadFailed') }} {{ t('views.home.loadHelp') }}</span>
      <button class="btn btn-sm btn-light ms-auto" @click="load(); checkServer()">{{ t('server.retry') }}</button>
    </div>
    <div v-else-if="!shown" class="text-body-secondary py-3">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
    </div>

    <template v-else>
      <h2 class="section-heading">{{ t('views.home.recent') }}</h2>
      <RiskPanel :results="shown.results" class="mb-4" />

      <h2 class="section-heading">{{ t('views.home.caseSection') }}</h2>
      <div class="row g-3">
        <div class="col-12 col-xl-7 d-flex flex-column gap-3">
          <div class="panel">
            <template v-if="!editing">
              <div class="d-flex flex-wrap align-items-start gap-2">
                <div class="me-auto min-w-0">
                  <div class="panel-sub">{{ t('case.info') }}</div>
                  <div class="h5 mb-1">{{ currentCase.name }}</div>
                  <p v-if="currentCase.memo" class="mb-0 text-body-secondary small" style="white-space: pre-line">{{ currentCase.memo }}</p>
                </div>
                <span v-if="dirtyCount(currentCase.id)" class="badge text-bg-warning">▲ {{ t('common.unsaved', { n: dirtyCount(currentCase.id) }) }}</span>
                <button class="btn btn-sm btn-outline-secondary" @click="editing = true">{{ t('common.edit') }}</button>
                <button class="btn btn-sm btn-outline-danger" @click="openDelete">{{ t('case.delete') }}</button>
              </div>
            </template>
            <div v-else style="max-width: 32rem">
              <CaseForm :key="currentCase.id" :initial="currentCase" :submit="saveCase" @cancel="editing = false" />
            </div>
          </div>

          <div class="panel p-0">
            <div class="panel-head px-3 pt-3">
              <div class="panel-title me-auto">{{ t('views.overview.next') }}</div>
            </div>
            <ul class="list-plain">
              <li v-for="a in shown.next_actions" :key="a.code">
                <span class="me-auto">{{ a.text }}</span>
                <RouterLink v-if="a.link" :to="actionLink(a)" class="btn btn-sm btn-outline-primary text-nowrap">{{ t('views.overview.go') }} →</RouterLink>
              </li>
            </ul>
          </div>
        </div>

        <div class="col-12 col-xl-5 d-flex flex-column gap-3">
          <details class="panel disclosure">
            <summary>
              <span class="panel-title">{{ t('views.overview.availability') }}</span>
              <span class="panel-sub ms-2">{{ t('views.home.availableCount', { n: shown.evaluations.filter((e) => e.available).length, total: shown.evaluations.length }) }}</span>
            </summary>
            <ul class="list-plain mt-2">
              <li v-for="e in shown.evaluations" :key="e.kind + e.mode" class="d-block">
                <div class="d-flex align-items-center gap-2">
                  <span class="fw-semibold me-auto">{{ e.label }}</span>
                  <span v-if="e.available" class="badge text-bg-success">● {{ t('views.overview.available') }}</span>
                  <span v-else class="badge text-bg-secondary">— {{ t('views.overview.unavailable') }}</span>
                </div>
                <div class="small text-body-secondary">{{ e.reason }}</div>
                <div v-if="e.required" class="small mt-1">
                  {{ t('views.overview.requiredReceived', { a: e.required.received, b: e.required.total }) }}
                  <span v-if="e.required.provisional" class="badge req-badge ms-1">{{ t('views.overview.provisional') }}</span>
                </div>
              </li>
            </ul>
          </details>

          <div class="panel">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="panel-title me-auto">{{ t('views.overview.connection') }}</span>
              <button class="btn btn-sm btn-outline-secondary" @click="checkServer"><AppIcon name="refresh" :size="14" /> {{ t('server.retry') }}</button>
            </div>
            <div class="conn-rows">
              <span v-for="r in conn" :key="r.key">
                {{ t('views.overview.' + r.key) }}
                <strong v-if="r.ok === null" class="text-body-secondary">…</strong>
                <strong v-else-if="r.ok" class="text-success">● OK</strong>
                <strong v-else class="text-danger">■ {{ r.key === 'database' ? t('server.db_error') : t('server.offline') }}</strong>
              </span>
            </div>
            <div v-if="store.server.checkedAt" class="small text-body-secondary mt-1">{{ t('server.lastChecked') }}: {{ store.server.checkedAt.toLocaleTimeString() }}</div>
          </div>
        </div>
      </div>
    </template>

    <AppModal v-if="deleting" :title="t('case.deleteTitle')" @close="deleting = null">
      <p class="mb-2">{{ t('case.deleteWarn', { name: deleting.name }) }}</p>
      <ul class="small text-body-secondary">
        <li>{{ t('case.deleteWhat') }}</li>
        <li>{{ t('case.deleteNoUndo') }}</li>
      </ul>
      <label class="form-label small" for="delete-confirm">{{ t('case.deleteType', { name: deleting.name }) }}</label>
      <input id="delete-confirm" v-model="deleting.input" class="form-control" :class="{ 'is-invalid': deleting.error }"
        autocomplete="off" @keydown.enter.prevent="deleting.input.trim() === deleting.name && confirmDelete()" />
      <div v-if="deleting.error" class="invalid-feedback">{{ deleting.error }}</div>
      <template #footer>
        <button class="btn btn-outline-secondary" @click="deleting = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" :disabled="deleting.busy || deleting.input.trim() !== deleting.name" @click="confirmDelete">
          {{ deleting.busy ? t('common.saving') : t('case.deleteConfirm') }}
        </button>
      </template>
    </AppModal>
  </CaseGate>
</template>
