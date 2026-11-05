<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { api } from '../api.js'
import { store, checkServer } from '../store.js'
import { t } from '../i18n/index.js'
import SourceMeta from '../components/rag/SourceMeta.vue'

// 질문 → (서버) 논문 검색 → 근거 문단 표시 → (서버, API 키가 있을 때만) Gemini 답변.
// 검색·답변 생성·인용 검증은 모두 서버가 합니다. 화면은 받은 결과를 보여 주기만 합니다.
const MAX = 500
const PREVIEW = 320
const CONSOLE_LINKS = [
  { key: 'keys', href: 'https://aistudio.google.com/app/apikey' },
  { key: 'limits', href: 'https://ai.google.dev/gemini-api/docs/rate-limits' },
]

const info = ref(null)
const infoError = ref(false)
const input = ref('')
const listEnd = ref(null)
const expanded = ref({}) // `${itemId}:${n}` → true
const highlight = ref(null)
let seq = 0

const items = computed(() => store.rag.items)
const busy = computed(() => items.value.some((i) => i.stage === 'searching' || i.stage === 'answering'))
const llmReady = computed(() => !!info.value?.llm.configured)
const suggestions = computed(() => t('views.papers.suggestionList'))

async function loadInfo() {
  infoError.value = false
  try {
    info.value = await api.ragInfo()
  } catch {
    infoError.value = true
    checkServer()
  }
}
onMounted(loadInfo)

function scrollEnd() {
  nextTick(() => listEnd.value?.scrollIntoView({ block: 'end', behavior: 'smooth' }))
}

function errMessage(err, fallbackKey) {
  if (err.kind === 'input') return Object.values(err.fields).flat().join(' ') || err.message
  return err.message || t(fallbackKey)
}

async function runAnswer(item) {
  item.stage = 'answering'
  item.error = null
  try {
    item.answer = await api.ragAnswer(item.question, item.search.results.map((r) => r.chunk_id))
    item.stage = 'done'
  } catch (err) {
    item.stage = 'error'
    item.error = { step: 'answer', message: errMessage(err, 'views.papers.answerFailed') }
    if (err.kind !== 'input') checkServer()
  }
}

async function run(item) {
  item.stage = 'searching'
  item.error = null
  try {
    item.search = await api.ragSearch(item.question)
    if (!info.value || info.value.vector.status !== 'ready') loadInfo() // 첫 검색 뒤 모델 상태 갱신
  } catch (err) {
    item.stage = 'error'
    item.error = { step: 'search', message: errMessage(err, 'views.papers.searchFailed') }
    if (err.kind !== 'input') checkServer()
    return
  }
  if (!item.search.results.length) {
    item.stage = 'done' // 근거가 없으면 답변을 만들지 않음
    return
  }
  await runAnswer(item)
  scrollEnd()
}

async function send(text) {
  const q = (text ?? input.value).trim()
  if (!q || busy.value) return
  const item = { id: ++seq, question: q, stage: 'searching', search: null, answer: null, error: null }
  store.rag.items.push(item)
  input.value = ''
  scrollEnd()
  await run(store.rag.items[store.rag.items.length - 1])
}

function retry(item) {
  if (busy.value) return
  item.error?.step === 'answer' ? runAnswer(item) : run(item)
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

// 답변의 [n] → 근거 카드 n 으로 이동하는 링크. v-html 을 쓰지 않고 조각으로 나눠 그립니다.
function segments(text) {
  const out = []
  let last = 0
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ cite: Number(m[1]) })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

function goCite(item, n) {
  highlight.value = `${item.id}:${n}`
  nextTick(() => document.getElementById(`ev-${item.id}-${n}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

const cited = (item, n) => item.answer?.status === 'ok' && item.answer.citations.includes(n)
const isOpen = (item, n) => !!expanded.value[`${item.id}:${n}`]
function toggle(item, n) {
  expanded.value[`${item.id}:${n}`] = !isOpen(item, n)
}
const preview = (text) => (text.length > PREVIEW ? text.slice(0, PREVIEW) + '…' : text)

function warningText(w) {
  const v = (w.values || []).join(', ')
  return t(`views.papers.warning.${w.type}`, { v })
}

function clearAll() {
  if (!busy.value) store.rag.items.splice(0)
}
</script>

<template>
  <p class="tab-lead">{{ t('views.papers.lead') }}</p>

  <!-- 자료·설정 상태 -->
  <div v-if="infoError" class="alert alert-danger d-flex align-items-center gap-2">
    <span>{{ t('common.loadFailed') }}</span>
    <button class="btn btn-sm btn-light ms-auto" @click="loadInfo">{{ t('server.retry') }}</button>
  </div>
  <template v-else-if="info">
    <div v-if="info.corpus_error" class="alert alert-danger">{{ info.corpus_error }}</div>
    <div v-else class="rag-status small mb-3">
      <div>
        <span class="badge basis-demo me-1">{{ t('views.papers.corpusBadge') }}</span>
        {{ info.corpus.label[store.lang] }} —
        {{ t('views.papers.corpusInfo', { d: info.corpus.documents, c: info.corpus.chunks }) }}
      </div>
      <div class="text-body-secondary">
        <span v-if="info.vector.status === 'ready'">{{ t('views.papers.vectorReady', { m: info.vector.model }) }}</span>
        <span v-else-if="info.vector.status === 'not_loaded'">{{ t('views.papers.vectorNotLoaded') }}</span>
        <span v-else class="text-warning-emphasis">{{ t('views.papers.vectorUnavailable', { r: info.vector.reason }) }}</span>
      </div>
    </div>
    <div v-if="!llmReady" class="alert alert-secondary py-2 small" role="note">
      <span class="fw-semibold">{{ t('views.papers.llmMissing') }}</span> — {{ t('views.papers.llmMissingHelp') }}
      <!-- 키 발급은 Google AI Studio 에서 직접 합니다. 키는 이 화면이 아니라 backend/.env 에만 넣습니다. -->
      <div class="d-flex flex-wrap column-gap-3 mt-1">
        <a v-for="l in CONSOLE_LINKS" :key="l.key" :href="l.href" target="_blank" rel="noopener noreferrer">
          {{ t('views.papers.console.' + l.key) }} ↗
        </a>
      </div>
    </div>
  </template>

  <!-- 추천 질문 -->
  <div class="mb-3">
    <div class="small fw-semibold mb-1">{{ t('views.ask.suggestions') }}</div>
    <div class="d-flex flex-wrap gap-2">
      <button v-for="s in suggestions" :key="s" type="button" class="btn btn-sm btn-outline-primary suggestion"
        :disabled="busy" @click="send(s)">{{ s }}</button>
    </div>
  </div>

  <!-- 대화 -->
  <div class="qa-list mb-3" aria-live="polite">
    <div v-if="!items.length" class="card"><div class="card-body text-body-secondary text-center py-4">{{ t('views.papers.empty') }}</div></div>

    <div v-for="item in items" :key="item.id" class="qa-item mb-4">
      <div class="qa-question">{{ item.question }}</div>

      <!-- 답변 -->
      <div class="card qa-answer mb-2">
        <div class="card-header d-flex flex-wrap align-items-center gap-2 py-1">
          <template v-if="item.answer?.status === 'ok'">
            <span class="badge text-bg-primary">{{ t('views.papers.answerBadge') }}</span>
            <span class="small text-body-secondary">{{ item.answer.model }}</span>
          </template>
          <span v-else-if="item.answer?.status === 'not_configured'" class="badge basis-demo">{{ t('views.papers.llmMissing') }}</span>
          <span v-else class="small fw-semibold">{{ t('views.papers.answer') }}</span>
          <span v-if="item.search" class="small text-body-secondary ms-auto">
            {{ t('views.papers.mode.' + item.search.mode) }} · {{ t('views.papers.searchMs', { ms: item.search.ms }) }}
          </span>
        </div>
        <div class="card-body">
          <div v-if="item.stage === 'searching'" class="text-body-secondary">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('views.papers.searching') }}
            <div class="small">{{ t('views.papers.firstSearchNote') }}</div>
          </div>
          <div v-else-if="item.stage === 'answering'" class="text-body-secondary">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('views.papers.answering') }}
          </div>
          <div v-else-if="item.stage === 'error'" class="alert alert-danger d-flex flex-wrap align-items-center gap-2 mb-0" role="alert">
            <span>■ {{ item.error.message }}</span>
            <button class="btn btn-sm btn-light ms-auto" :disabled="busy" @click="retry(item)">{{ t('views.ask.retry') }}</button>
          </div>
          <template v-else-if="item.search && !item.search.results.length">
            <div class="text-body-secondary">{{ t('views.papers.evidenceNone') }}</div>
          </template>
          <template v-else-if="item.answer?.status === 'ok'">
            <div class="qa-text rag-answer">
              <template v-for="(s, i) in segments(item.answer.text)" :key="i">
                <span v-if="s.text">{{ s.text }}</span>
                <button v-else type="button" class="rag-cite" :aria-label="t('views.papers.citeLabel', { n: s.cite })"
                  @click="goCite(item, s.cite)">[{{ s.cite }}]</button>
              </template>
            </div>
            <ul v-if="item.answer.warnings.length" class="rag-warnings small mt-2 mb-0">
              <li v-for="(w, i) in item.answer.warnings" :key="i">⚠ {{ warningText(w) }}</li>
            </ul>
          </template>
          <div v-else-if="item.answer" class="text-body-secondary">
            {{ item.answer.message }}
            <div v-if="item.answer.status === 'not_configured'" class="small">{{ t('views.papers.llmMissingHelp') }}</div>
          </div>
        </div>
      </div>

      <!-- 근거 문단 -->
      <div v-if="item.search?.results.length" class="rag-evidence">
        <div v-if="item.search.fallback_reason" class="alert alert-warning py-2 small mb-2">
          {{ t('views.papers.fallback', { r: item.search.fallback_reason }) }}
        </div>
        <div class="small fw-semibold mb-1">{{ t('views.papers.evidence', { n: item.search.results.length }) }}</div>
        <div v-for="(r, i) in item.search.results" :id="`ev-${item.id}-${i + 1}`" :key="r.chunk_id"
          class="rag-card" :class="{ 'rag-card-cited': cited(item, i + 1), 'rag-card-hl': highlight === `${item.id}:${i + 1}` }">
          <div class="d-flex gap-2 align-items-start">
            <span class="rag-num">[{{ i + 1 }}]</span>
            <div class="flex-grow-1 min-w-0">
              <SourceMeta :src="r" />
              <div class="rag-text small mt-1">{{ isOpen(item, i + 1) ? r.text : preview(r.text) }}</div>
              <div class="d-flex flex-wrap gap-2 align-items-center mt-1">
                <button v-if="r.text.length > PREVIEW" type="button" class="btn btn-link btn-sm p-0" @click="toggle(item, i + 1)">
                  {{ isOpen(item, i + 1) ? t('views.papers.showLess') : t('views.papers.showMore') }}
                </button>
                <span v-if="cited(item, i + 1)" class="badge text-bg-primary-subtle text-primary-emphasis">{{ t('views.papers.cited') }}</span>
                <code class="small text-body-secondary ms-auto">{{ r.chunk_id }}</code>
              </div>
            </div>
          </div>
        </div>
        <RouterLink :to="{ path: '/lab/compare', query: { q: item.question } }" class="small">{{ t('views.papers.devLink') }}</RouterLink>
      </div>
    </div>
    <div ref="listEnd"></div>
  </div>

  <!-- 질문 입력 -->
  <form class="qa-form" @submit.prevent="send()">
    <div class="d-flex gap-2 align-items-end">
      <textarea v-model="input" class="form-control" rows="2" :maxlength="MAX"
        :placeholder="t('views.ask.placeholder')" :aria-label="t('views.ask.placeholder')" @keydown="onKeydown"></textarea>
      <button type="submit" class="btn btn-primary text-nowrap" :disabled="!input.trim() || busy">
        {{ busy ? t('views.papers.working') : t('views.ask.send') }}
      </button>
    </div>
    <div class="d-flex small text-body-secondary">
      <span>{{ t('views.papers.memoryNote') }}</span>
      <button v-if="items.length" type="button" class="btn btn-link btn-sm p-0 ms-2" :disabled="busy" @click="clearAll">
        {{ t('views.papers.clear') }}
      </button>
      <span class="ms-auto">{{ t('views.ask.chars', { n: input.length, max: MAX }) }}</span>
    </div>
  </form>
</template>
