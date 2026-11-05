<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../api.js'
import { store, currentCase, checkServer, updateCase, dirtyCount, deleteCase } from '../store.js'
import { t } from '../i18n/index.js'
import CaseGate from '../components/CaseGate.vue'
import CaseForm from '../components/CaseForm.vue'
import RiskPanel from '../components/RiskPanel.vue'
import AppModal from '../components/AppModal.vue'

const data = ref(null)
const error = ref(false)
const editing = ref(false)

// 케이스·언어가 바뀌면 다시 불러옵니다. 늦게 도착한 이전 케이스 응답은 버립니다.
async function load() {
  const id = store.currentCaseId
  const lang = store.lang
  if (!id) return
  error.value = false
  try {
    const [res, results] = await Promise.all([api.overview(id, lang), api.results(id)])
    if (id === store.currentCaseId && lang === store.lang) data.value = { ...res, results }
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

// 케이스 삭제: 이름을 그대로 입력해야 버튼이 켜지고, 서버도 이름을 다시 확인합니다.
const deleting = ref(null) // { name, input, busy, error }
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

// 연결 상태: 화면이 보인다는 것 자체가 프론트엔드 정상
const rows = computed(() => {
  const s = store.server.state
  return [
    { key: 'frontend', ok: true },
    { key: 'backend', ok: s === 'checking' ? null : s === 'ok' || s === 'db_error' },
    { key: 'database', ok: s === 'checking' ? null : s === 'ok' },
  ]
})
</script>

<template>
  <CaseGate title-key="menu.overview" lead-key="views.overview.lead">
    <div class="row g-3">
      <!-- 현재 상태 한눈에 (저장된 결과 기준) -->
      <div v-if="shown" class="col-12">
        <RiskPanel :results="shown.results" />
      </div>
      <!-- 케이스 정보 -->
      <div class="col-12">
        <div class="card">
          <div class="card-body">
            <template v-if="!editing">
              <div class="d-flex flex-wrap align-items-start gap-2">
                <div class="me-auto">
                  <div class="small text-body-secondary">{{ t('case.info') }}</div>
                  <h2 class="h4 mb-1">{{ currentCase.name }}</h2>
                  <p v-if="currentCase.memo" class="mb-0 text-body-secondary" style="white-space: pre-line">{{ currentCase.memo }}</p>
                </div>
                <span v-if="dirtyCount(currentCase.id)" class="badge text-bg-warning">
                  ▲ {{ t('common.unsaved', { n: dirtyCount(currentCase.id) }) }}
                </span>
                <button class="btn btn-sm btn-outline-secondary" @click="editing = true">{{ t('common.edit') }}</button>
                <button class="btn btn-sm btn-outline-danger" @click="openDelete">{{ t('case.delete') }}</button>
              </div>
            </template>
            <div v-else style="max-width: 32rem">
              <CaseForm :key="currentCase.id" :initial="currentCase" :submit="saveCase" @cancel="editing = false" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="error" class="col-12">
        <div class="alert alert-danger d-flex align-items-center gap-2 mb-0">
          <span>{{ t('common.loadFailed') }}</span>
          <button class="btn btn-sm btn-light ms-auto" @click="load(); checkServer()">{{ t('server.retry') }}</button>
        </div>
      </div>
      <div v-else-if="!shown" class="col-12 text-body-secondary">
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
      </div>

      <template v-if="shown">
        <!-- 데이터 준비 상태 -->
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header fw-semibold">{{ t('views.overview.readiness') }}</div>
            <div class="card-body">
              <div class="row text-center g-2 mb-3">
                <div class="col-4">
                  <div class="big-number">{{ shown.readiness.received_pct }}<small>%</small></div>
                  <div class="small text-body-secondary">{{ t('views.overview.receivedRate') }}</div>
                </div>
                <div class="col-4">
                  <div class="big-number text-success">{{ shown.readiness.verified_pct }}<small>%</small></div>
                  <div class="small text-body-secondary">{{ t('views.overview.verifiedRate') }}</div>
                </div>
                <div class="col-4">
                  <div class="big-number text-secondary">{{ shown.readiness.missing }}<small>/{{ shown.readiness.total }}</small></div>
                  <div class="small text-body-secondary">{{ t('views.overview.missing') }}</div>
                </div>
              </div>
              <div class="progress" role="progressbar" :aria-valuenow="shown.readiness.received_pct" aria-valuemin="0" aria-valuemax="100">
                <div class="progress-bar bg-success" :style="{ width: shown.readiness.verified_pct + '%' }"></div>
                <div class="progress-bar" :style="{ width: (shown.readiness.received_pct - shown.readiness.verified_pct) + '%' }"></div>
              </div>
              <div class="small text-body-secondary mt-1">
                ● {{ t('status.VERIFIED') }} {{ shown.readiness.verified }} · ◐ {{ t('status.RECEIVED') }} {{ shown.readiness.received }} · ○ {{ t('status.MISSING') }} {{ shown.readiness.missing }}
              </div>
            </div>
          </div>
        </div>

        <!-- 다음에 할 일 -->
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header fw-semibold">{{ t('views.overview.next') }}</div>
            <ul class="list-group list-group-flush">
              <li v-for="a in shown.next_actions" :key="a.code" class="list-group-item d-flex align-items-center gap-2">
                <span class="me-auto">{{ a.text }}</span>
                <RouterLink v-if="a.link" :to="a.link" class="btn btn-sm btn-primary text-nowrap">{{ t('views.overview.go') }} →</RouterLink>
              </li>
            </ul>
          </div>
        </div>

        <!-- 평가 가능 여부 -->
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header fw-semibold">{{ t('views.overview.availability') }}</div>
            <ul class="list-group list-group-flush">
              <li v-for="e in shown.evaluations" :key="e.kind + e.mode" class="list-group-item">
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
          </div>
        </div>

        <!-- 연결 상태 -->
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header fw-semibold">{{ t('views.overview.connection') }}</div>
            <ul class="list-group list-group-flush">
              <li v-for="r in rows" :key="r.key" class="list-group-item d-flex justify-content-between align-items-center">
                <span>{{ t('views.overview.' + r.key) }}</span>
                <span v-if="r.ok === null" class="text-body-secondary">… {{ t('server.checking') }}</span>
                <span v-else-if="r.ok" class="text-success fw-semibold">● OK</span>
                <span v-else class="text-danger fw-semibold">■ {{ r.key === 'database' ? t('server.db_error') : t('server.offline') }}</span>
              </li>
            </ul>
            <div class="card-footer d-flex justify-content-between align-items-center small text-body-secondary">
              <span v-if="store.server.checkedAt">{{ t('server.lastChecked') }}: {{ store.server.checkedAt.toLocaleTimeString() }}</span>
              <button class="btn btn-sm btn-outline-primary" @click="checkServer">{{ t('server.retry') }}</button>
            </div>
          </div>
        </div>
      </template>
    </div>
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
