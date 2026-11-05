<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.js'
import { store, checkServer } from '../store.js'
import { t } from '../i18n/index.js'
import { dateTime, num, txt, unit } from '../format.js'
import CaseGate from '../components/CaseGate.vue'
import BasisBadge from '../components/BasisBadge.vue'

// 답변은 모두 서버가 만듭니다 (현재: 템플릿 기반 데모 답변, 실제 LLM 미연결).
const MAX = 500
const route = useRoute()
const router = useRouter()

const info = ref(null) // { answer_type, llm_connected, suggestions, about_result }
const history = ref(null) // { caseId, items }
const loadError = ref(false)
const input = ref('')
const pending = ref(null) // 답변 기다리는 질문
const error = ref(null) // { question, message }
const listEnd = ref(null)
const inputEl = ref(null)

async function load() {
  const id = store.currentCaseId
  if (!id) return
  loadError.value = false
  try {
    const [inf, items] = await Promise.all([info.value || api.qaInfo(), api.questions(id)])
    if (id !== store.currentCaseId) return
    info.value = inf
    history.value = { caseId: id, items }
    applyAbout()
    scrollEnd()
  } catch {
    if (id === store.currentCaseId) {
      loadError.value = true
      checkServer()
    }
  }
}
watch(() => store.currentCaseId, () => {
  history.value = null
  pending.value = null
  error.value = null
  load()
}, { immediate: true })

// 계산 결과 화면의 '이 결과 질문하기' → ?about=PERFORMANCE|ECONOMICS|PINCH_APPROACH 로 질문을 채워 둡니다(보내기는 사용자가).
function applyAbout() {
  const about = route.query.about
  if (!about || !info.value?.about_result[about]) return
  input.value = info.value.about_result[about][store.lang]
  router.replace({ query: {} })
  nextTick(() => inputEl.value?.focus())
}
watch(() => route.query.about, () => info.value && applyAbout())

const shown = computed(() => (history.value?.caseId === store.currentCaseId ? history.value : null))
const suggestions = computed(() => info.value?.suggestions[store.lang] || [])

function scrollEnd() {
  nextTick(() => listEnd.value?.scrollIntoView({ block: 'end', behavior: 'smooth' }))
}

async function send(text) {
  const q = (text ?? input.value).trim()
  if (!q || pending.value) return
  const id = store.currentCaseId
  pending.value = q
  error.value = null
  input.value = ''
  scrollEnd()
  try {
    const log = await api.ask(id, q)
    if (id === store.currentCaseId) history.value.items.push(log)
  } catch (err) {
    if (id !== store.currentCaseId) return
    error.value = { question: q, message: err.kind === 'input' ? (err.fields.question || []).join(' ') : t('views.ask.failed') }
    input.value = q // 입력한 질문은 지우지 않습니다
    if (err.kind !== 'input') checkServer()
  } finally {
    if (id === store.currentCaseId) pending.value = null
    scrollEnd()
  }
}

function onKeydown(e) {
  // 한글 조합 중 Enter 는 보내지 않습니다
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

function citeText(c) {
  if (c.type === 'public_ref') return `${t('views.ask.publicRef')}: ${c.title} (${c.author}${c.year ? ', ' + c.year : ''}) — ${c.where}`
  if (c.type === 'document') return `${txt(c.title)} ${t('views.ask.documentPage', { p: c.page })} — ${txt(c.section)}`
  if (c.type === 'result') {
    return `${t('views.ask.resultSource')}: ${txt(c.label)} · ${t('views.evaluate.basis.' + c.basis)} · ${c.model_version} · ${t('views.ask.computedAt')} ${dateTime(c.computed_at)}`
  }
  return txt(c.label)
}
const cardValue = (c) => (typeof c.value === 'number' ? num(c.value) : c.value)
</script>

<template>
  <p class="tab-lead">{{ t('views.ask.lead') }}</p>
  <CaseGate>
    <div class="alert alert-warning d-flex gap-2 align-items-start demo-banner" role="note">
      <span class="badge basis-demo">{{ t('views.ask.demoAnswer') }}</span>
      <div>
        <div class="fw-semibold">{{ t('views.ask.demoBanner') }}</div>
        <div class="small">{{ t('views.ask.demoBannerHelp') }}</div>
      </div>
    </div>

    <div v-if="loadError" class="alert alert-danger d-flex align-items-center gap-2">
      <span>{{ t('common.loadFailed') }}</span>
      <button class="btn btn-sm btn-light ms-auto" @click="load">{{ t('server.retry') }}</button>
    </div>
    <div v-else-if="!shown" class="text-body-secondary py-3">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
    </div>

    <template v-else>
      <!-- 추천 질문 -->
      <div class="mb-3">
        <div class="small fw-semibold mb-1">{{ t('views.ask.suggestions') }}</div>
        <div class="d-flex flex-wrap gap-2">
          <button v-for="s in suggestions" :key="s" type="button" class="btn btn-sm btn-outline-primary suggestion"
            :disabled="!!pending" @click="send(s)">{{ s }}</button>
        </div>
      </div>

      <!-- 질문·답변 이력 -->
      <div class="qa-list mb-3" aria-live="polite">
        <div v-if="!shown.items.length && !pending" class="card"><div class="card-body text-body-secondary text-center py-4">{{ t('views.ask.empty') }}</div></div>

        <div v-for="item in shown.items" :key="item.id" class="qa-item mb-3">
          <div class="qa-question">{{ item.question }}</div>
          <div class="card qa-answer">
            <div class="card-header d-flex align-items-center gap-2 py-1">
              <span class="badge basis-demo">{{ t('views.ask.demoAnswer') }}</span>
              <span class="small text-body-secondary ms-auto">{{ dateTime(item.created_at) }}</span>
            </div>
            <div class="card-body">
              <div class="qa-text">{{ item.answer }}</div>
              <div v-if="item.cards.length" class="row g-2 mt-2">
                <div v-for="(c, i) in item.cards" :key="i" class="col-12 col-sm-6 col-xl-4">
                  <div class="qa-card">
                    <div class="small text-body-secondary">{{ txt(c.label) }}</div>
                    <div class="mid-number" :data-negative="typeof c.value === 'number' && c.value < 0 || null">
                      {{ cardValue(c) }}<small>{{ unit(c.unit) }}</small>
                    </div>
                    <BasisBadge :basis="c.basis" />
                  </div>
                </div>
              </div>
              <div class="qa-sources small mt-3">
                <span class="fw-semibold">{{ t('views.ask.sources') }}:</span>
                <ul v-if="item.citations.length" class="mb-0 ps-3">
                  <li v-for="(c, i) in item.citations" :key="i">
                    {{ citeText(c) }}
                    <div v-if="c.note" class="text-body-secondary">{{ txt(c.note) }}</div>
                  </li>
                </ul>
                <span v-else class="text-body-secondary"> {{ t('views.ask.noSources') }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="pending" class="qa-item mb-3">
          <div class="qa-question">{{ pending }}</div>
          <div class="card qa-answer"><div class="card-body text-body-secondary">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('views.ask.generating') }}
          </div></div>
        </div>
        <div ref="listEnd"></div>
      </div>

      <div v-if="error" class="alert alert-danger d-flex flex-wrap align-items-center gap-2" role="alert">
        <span>■ {{ error.message }}</span>
        <button class="btn btn-sm btn-light ms-auto" :disabled="!!pending" @click="send(error.question)">{{ t('views.ask.retry') }}</button>
      </div>

      <!-- 질문 입력 -->
      <form class="qa-form" @submit.prevent="send()">
        <div class="d-flex gap-2 align-items-end">
          <textarea ref="inputEl" v-model="input" class="form-control" rows="2" :maxlength="MAX"
            :placeholder="t('views.ask.placeholder')" :aria-label="t('views.ask.placeholder')" @keydown="onKeydown"></textarea>
          <button type="submit" class="btn btn-primary text-nowrap" :disabled="!input.trim() || !!pending">
            {{ pending ? t('views.ask.generating') : t('views.ask.send') }}
          </button>
        </div>
        <div class="small text-body-secondary text-end">{{ t('views.ask.chars', { n: input.length, max: MAX }) }}</div>
      </form>
    </template>
  </CaseGate>
</template>
