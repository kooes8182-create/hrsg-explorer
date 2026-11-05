<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.js'
import { store, draftFor, clearDraft, checkServer } from '../store.js'
import { t, nameOf } from '../i18n/index.js'
import CaseGate from '../components/CaseGate.vue'
import StatusBadge from '../components/StatusBadge.vue'
import AppModal from '../components/AppModal.vue'

const STATUSES = ['MISSING', 'RECEIVED', 'VERIFIED']
const FIELDS = ['value', 'unit', 'condition', 'measured_at', 'memo', 'status']

const route = useRoute()
const router = useRouter()

const data = ref(null) // 서버에 저장된 체크리스트 (현재 케이스)
const loadError = ref(false)
const saving = ref(false)
const saveMessage = ref(null) // { type: 'success'|'danger', text }
const itemErrors = ref({}) // { itemKey: { field: [메시지] } }

// ------------------------------------------------------------ 불러오기
async function load() {
  const id = store.currentCaseId
  if (!id) return
  loadError.value = false
  try {
    const res = await api.checklist(id)
    if (id === store.currentCaseId) data.value = { caseId: id, ...res }
  } catch {
    if (id === store.currentCaseId) {
      loadError.value = true
      checkServer()
    }
  }
}
watch(() => store.currentCaseId, () => {
  data.value = null
  itemErrors.value = {}
  saveMessage.value = null
  load()
}, { immediate: true })

// 다른 케이스의 응답이 남아 있으면 쓰지 않습니다.
const shown = computed(() => (data.value?.caseId === store.currentCaseId ? data.value : null))
const draft = computed(() => draftFor(store.currentCaseId).checklist)
const dirtyKeys = computed(() => Object.keys(draft.value))

// ------------------------------------------------------------ 필터 (저장된 상태 기준)
const statusFilter = ref('ALL')
const categoryFilter = ref('ALL')
watch(() => route.query.status, (s) => {
  statusFilter.value = STATUSES.includes(s) ? s : 'ALL'
}, { immediate: true })

function setStatusFilter(s) {
  router.replace({ query: { ...route.query, status: s === 'ALL' ? undefined : s } })
}

const counts = computed(() => {
  const p = shown.value?.progress
  return p ? { ALL: p.total, MISSING: p.missing, RECEIVED: p.received, VERIFIED: p.verified } : {}
})

const groups = computed(() => {
  if (!shown.value) return []
  return shown.value.categories
    .filter((c) => categoryFilter.value === 'ALL' || c.code === categoryFilter.value)
    .map((c) => ({
      ...c,
      progress: shown.value.progress.by_category[c.code],
      items: shown.value.items.filter(
        (i) => i.category === c.code && (statusFilter.value === 'ALL' || i.status === statusFilter.value),
      ),
    }))
    .filter((g) => g.items.length)
})

// ------------------------------------------------------------ 입력 (저장 전까지 케이스별 draft 에 보관)
function serverDisplay(item, field) {
  if (field === 'measured_at') return item.measured_at ? item.measured_at.slice(0, 16) : '' // 'YYYY-MM-DDTHH:MM' (서울 시간)
  return item[field] ?? ''
}

function fieldValue(item, field) {
  const d = draft.value[item.key]
  return d && field in d ? d[field] : serverDisplay(item, field)
}

function setField(item, field, v) {
  const d = draft.value
  const same = String(v).trim() === String(serverDisplay(item, field)).trim()
  if (same) {
    if (d[item.key]) {
      delete d[item.key][field]
      if (!Object.keys(d[item.key]).length) delete d[item.key]
    }
  } else {
    d[item.key] = { ...(d[item.key] || {}), [field]: v }
  }
}

const hasValue = (item) => String(fieldValue(item, 'value')).trim() !== ''

function revertAll() {
  clearDraft(draft.value)
  itemErrors.value = {}
}

async function save() {
  const id = store.currentCaseId
  const d = draftFor(id).checklist
  const items = Object.entries(d).map(([key, fields]) => {
    const row = { key }
    for (const [f, v] of Object.entries(fields)) {
      if (f === 'value' || f === 'measured_at') row[f] = String(v).trim() === '' ? null : String(v).trim()
      else row[f] = v
    }
    return row
  })
  if (!items.length) return
  saving.value = true
  saveMessage.value = null
  itemErrors.value = {}
  try {
    const res = await api.saveChecklist(id, items)
    clearDraft(d)
    if (id === store.currentCaseId) {
      data.value = { caseId: id, ...res }
      saveMessage.value = { type: 'success', text: t('common.saved') }
    }
  } catch (err) {
    if (err.kind === 'input') {
      itemErrors.value = err.items
      saveMessage.value = { type: 'danger', text: t('common.inputError') }
    } else {
      saveMessage.value = { type: 'danger', text: t('common.saveFailed') }
      checkServer()
    }
  } finally {
    saving.value = false
  }
}

// ------------------------------------------------------------ 요청문 (서버가 저장된 '미수신' 항목으로 생성)
const requestModal = ref(null) // { loading, error, text, count }
const copyState = ref('') // '' | 'copied' | 'failed'

async function openRequestText() {
  copyState.value = ''
  requestModal.value = { loading: true }
  try {
    requestModal.value = await api.requestText(store.currentCaseId, store.lang)
  } catch {
    requestModal.value = { error: true }
    checkServer()
  }
}

async function copyRequestText() {
  try {
    await navigator.clipboard.writeText(requestModal.value.text)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
    document.getElementById('request-text')?.select()
  }
}
</script>

<template>
  <CaseGate title-key="menu.data" lead-key="views.data.lead" eyebrow-key="menu.group.work">
    <div v-if="loadError" class="alert alert-danger d-flex align-items-center gap-2">
      <span>{{ t('common.loadFailed') }}</span>
      <button class="btn btn-sm btn-light ms-auto" @click="load">{{ t('server.retry') }}</button>
    </div>
    <div v-else-if="!shown" class="text-body-secondary py-3">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
    </div>

    <template v-else>
      <!-- 초안 안내 -->
      <div class="alert alert-light border d-flex gap-2 align-items-start">
        <span class="badge draft-badge">{{ nameOf(shown.source_label) }}</span>
        <span class="small">{{ t('views.data.draftNote') }}</span>
      </div>

      <!-- 진행률 -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex flex-wrap align-items-end gap-3 mb-2">
            <div>
              <div class="small text-body-secondary">{{ t('views.overview.receivedRate') }}</div>
              <div class="big-number">{{ shown.progress.received_pct }}<small>%</small></div>
            </div>
            <div>
              <div class="small text-body-secondary">{{ t('views.overview.verifiedRate') }}</div>
              <div class="big-number text-success">{{ shown.progress.verified_pct }}<small>%</small></div>
            </div>
            <div class="small text-body-secondary">
              ● {{ t('status.VERIFIED') }} {{ shown.progress.verified }} · ◐ {{ t('status.RECEIVED') }} {{ shown.progress.received }}
              · ○ {{ t('status.MISSING') }} {{ shown.progress.missing }} / {{ shown.progress.total }}
            </div>
            <button class="btn btn-primary ms-auto" :disabled="dirtyKeys.length > 0" :title="dirtyKeys.length ? t('views.data.requestTextSaveFirst') : ''"
              @click="openRequestText">
              ✉ {{ t('views.data.requestText') }}
            </button>
          </div>
          <div class="progress" role="progressbar" :aria-valuenow="shown.progress.received_pct" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar bg-success" :style="{ width: shown.progress.verified_pct + '%' }"></div>
            <div class="progress-bar" :style="{ width: (shown.progress.received_pct - shown.progress.verified_pct) + '%' }"></div>
          </div>
          <div v-if="dirtyKeys.length" class="small text-warning-emphasis mt-2">▲ {{ t('views.data.requestTextSaveFirst') }}</div>
        </div>
      </div>

      <!-- 필터 -->
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div class="btn-group btn-group-sm flex-wrap" role="group" :aria-label="t('views.data.filterStatus')">
          <button v-for="s in ['ALL', ...STATUSES]" :key="s" class="btn"
            :class="statusFilter === s ? 'btn-primary' : 'btn-outline-primary'" @click="setStatusFilter(s)">
            {{ t('status.' + s) }} <span class="opacity-75">{{ counts[s] }}</span>
          </button>
        </div>
        <select v-model="categoryFilter" class="form-select form-select-sm w-auto" :aria-label="t('views.data.filterCategory')">
          <option value="ALL">{{ t('views.data.allCategories') }}</option>
          <option v-for="c in shown.categories" :key="c.code" :value="c.code">{{ nameOf(c) }}</option>
        </select>
      </div>

      <div v-if="!groups.length" class="card"><div class="card-body text-center text-body-secondary py-4">{{ t('views.data.emptyFilter') }}</div></div>

      <!-- 범주별 항목 -->
      <div v-for="g in groups" :key="g.code" class="card mb-3">
        <div class="card-header d-flex align-items-center gap-2">
          <span class="fw-semibold me-auto">{{ nameOf(g) }}</span>
          <span class="small text-body-secondary">{{ t('status.RECEIVED') }} {{ g.progress.received_or_verified }}/{{ g.progress.total }}</span>
        </div>
        <ul class="list-group list-group-flush">
          <li v-for="item in g.items" :key="item.key" class="list-group-item py-3" :class="{ 'item-dirty': draft[item.key] }">
            <div class="row g-2 align-items-center">
              <div class="col-12 col-md-4">
                <div class="fw-semibold">{{ nameOf(item) }}</div>
                <div class="d-flex flex-wrap gap-1 mt-1 align-items-center">
                  <StatusBadge :status="item.status" />
                  <span v-if="item.required_for.PERFORMANCE" class="badge req-badge">{{ t('views.data.requiredFor') }}·{{ t('views.data.reqPerformance') }}</span>
                  <span v-if="item.required_for.PINCH_APPROACH" class="badge req-badge">{{ t('views.data.requiredFor') }}·{{ t('views.data.reqPinch') }}</span>
                  <span v-if="item.requirement_provisional && (item.required_for.PERFORMANCE || item.required_for.PINCH_APPROACH)"
                    class="small text-body-secondary">({{ t('views.overview.provisional') }})</span>
                  <span v-if="item.reference" class="badge source-badge" :title="`${item.reference.title} — ${item.reference.where}`">
                    {{ t('views.data.publicRef') }}</span>
                </div>
              </div>
              <div class="col-8 col-md-3">
                <label class="form-label small mb-0" :for="'v-' + item.key">{{ t('views.data.value') }}</label>
                <input :id="'v-' + item.key" class="form-control form-control-sm" :value="fieldValue(item, 'value')"
                  @input="setField(item, 'value', $event.target.value)" />
              </div>
              <div class="col-4 col-md-1">
                <label class="form-label small mb-0" :for="'u-' + item.key">{{ t('views.data.unit') }}</label>
                <input :id="'u-' + item.key" class="form-control form-control-sm" :value="fieldValue(item, 'unit')"
                  @input="setField(item, 'unit', $event.target.value)" />
              </div>
              <div class="col-12 col-md-4">
                <div class="btn-group btn-group-sm w-100" role="group">
                  <button v-for="s in STATUSES" :key="s" type="button" class="btn"
                    :class="fieldValue(item, 'status') === s ? 'btn-primary' : 'btn-outline-secondary'"
                    :disabled="s === 'VERIFIED' && !hasValue(item)"
                    :title="s === 'VERIFIED' && !hasValue(item) ? t('views.data.verifyNeedsValue') : ''"
                    @click="setField(item, 'status', s)">{{ t('status.' + s) }}</button>
                </div>
                <div v-if="hasValue(item) && fieldValue(item, 'status') === 'MISSING'" class="small mt-1">
                  {{ t('views.data.valueEnteredHint') }}
                  <button type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="setField(item, 'status', 'RECEIVED')">{{ t('views.data.markReceived') }}</button>
                </div>
              </div>
              <div class="col-12 col-md-4">
                <input class="form-control form-control-sm" :placeholder="t('views.data.condition')" :aria-label="t('views.data.condition')"
                  :value="fieldValue(item, 'condition')" @input="setField(item, 'condition', $event.target.value)" />
              </div>
              <div class="col-12 col-md-3">
                <input type="datetime-local" class="form-control form-control-sm" :aria-label="t('views.data.measuredAt')" :title="t('views.data.measuredAt')"
                  :value="fieldValue(item, 'measured_at')" @input="setField(item, 'measured_at', $event.target.value)" />
              </div>
              <div class="col-12 col-md-5">
                <input class="form-control form-control-sm" :placeholder="t('views.data.memo')" :aria-label="t('views.data.memo')"
                  :value="fieldValue(item, 'memo')" @input="setField(item, 'memo', $event.target.value)" />
              </div>
              <div v-if="itemErrors[item.key]" class="col-12">
                <div class="text-danger small">
                  <div v-for="(msgs, f) in itemErrors[item.key]" :key="f">{{ msgs.join(' ') }}</div>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- 저장 바: 변경이 있을 때만 -->
      <div v-if="dirtyKeys.length || saveMessage" class="save-bar d-flex flex-wrap align-items-center gap-2 p-2 px-3">
        <span v-if="dirtyKeys.length" class="fw-semibold text-warning-emphasis">▲ {{ t('common.unsaved', { n: dirtyKeys.length }) }}</span>
        <span v-if="saveMessage" :class="'text-' + saveMessage.type">{{ saveMessage.text }}</span>
        <div class="ms-auto d-flex gap-2">
          <button v-if="dirtyKeys.length" class="btn btn-outline-secondary btn-sm" @click="revertAll">{{ t('common.revert') }}</button>
          <button v-if="dirtyKeys.length" class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </template>

    <!-- 요청문 미리보기·복사 -->
    <AppModal v-if="requestModal" :title="t('views.data.requestText')" size="modal-lg" @close="requestModal = null">
      <div v-if="requestModal.loading" class="text-body-secondary">{{ t('common.loading') }}</div>
      <div v-else-if="requestModal.error" class="alert alert-danger mb-0">{{ t('common.loadFailed') }}</div>
      <template v-else>
        <p class="small text-body-secondary">{{ t('views.data.requestCount', { n: requestModal.count }) }}</p>
        <textarea id="request-text" class="form-control font-monospace small" rows="16" readonly :value="requestModal.text"></textarea>
        <div v-if="copyState === 'copied'" class="text-success small mt-2">● {{ t('views.data.copied') }}</div>
        <div v-if="copyState === 'failed'" class="text-danger small mt-2">■ {{ t('views.data.copyFailed') }}</div>
      </template>
      <template #footer>
        <button class="btn btn-outline-secondary" @click="requestModal = null">{{ t('common.close') }}</button>
        <button class="btn btn-primary" :disabled="!requestModal.text" @click="copyRequestText">{{ t('views.data.copy') }}</button>
      </template>
    </AppModal>
  </CaseGate>
</template>
