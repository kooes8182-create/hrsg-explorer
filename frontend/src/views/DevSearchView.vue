<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.js'
import { store, checkServer } from '../store.js'
import { t } from '../i18n/index.js'
import SourceMeta from '../components/rag/SourceMeta.vue'

// 개인 실험용 화면: 같은 질문의 BM25 / 벡터 / 하이브리드 결과와 각 후보의 순위·결정(최종 포함, 제외 이유)을 봅니다.
// 자유 질문에는 정답 목록이 없으므로 Recall·MRR 을 표시하지 않습니다.
const MODES = ['bm25', 'vector', 'hybrid']
const route = useRoute()

// 질문·설정·결과는 store 에 두어 다른 화면에 다녀와도 남습니다. 답변 화면에서 넘어온 질문(?q=)이 있으면 그것을 씁니다.
const lab = store.lab
const fromQuery = route.query.q && route.query.q !== lab.question
if (fromQuery) lab.question = route.query.q
const question = computed({ get: () => lab.question, set: (v) => { lab.question = v } })
const cfg = computed(() => lab.cfg)
const result = computed({ get: () => lab.result, set: (v) => { lab.result = v } })
const loading = ref(false)
const error = ref(null)
const tableMode = computed({ get: () => lab.tableMode, set: (v) => { lab.tableMode = v } })
const showAll = ref(false)
const open = ref({})

async function run() {
  const q = question.value.trim()
  if (!q || loading.value) return
  loading.value = true
  error.value = null
  try {
    result.value = await api.ragCompare(q, cfg.value)
    showAll.value = false
  } catch (err) {
    error.value = err.kind === 'input' ? Object.values(err.fields).flat().join(' ') : err.message || t('views.papers.searchFailed')
    if (err.kind !== 'input') checkServer()
  } finally {
    loading.value = false
  }
}
onMounted(() => (fromQuery || (question.value && !result.value)) && run())

const table = computed(() => {
  const m = result.value?.modes[tableMode.value]
  if (!m) return []
  return showAll.value ? m.entries : m.entries.slice(0, 30)
})
const total = computed(() => result.value?.modes[tableMode.value]?.entries.length || 0)
const decision = (e) => t('views.devSearch.decision.' + e.decision, { n: e.final_rank })
const f3 = (v) => (v == null ? '–' : v.toFixed(3))
const f4 = (v) => (v == null ? '–' : v.toFixed(4))
</script>

<template>
  <p class="tab-lead">{{ t('views.devSearch.lead') }}</p>
  <div class="note-box mb-3">{{ t('views.devSearch.notice') }}</div>

  <form class="panel mb-3" @submit.prevent="run">
    <label class="form-label small fw-semibold" for="dev-q">{{ t('views.devSearch.question') }}</label>
    <textarea id="dev-q" v-model="question" class="form-control mb-2" rows="2" maxlength="500"></textarea>
    <div class="row g-2 align-items-end">
      <div class="col-6 col-md-2">
        <label class="form-label small mb-0" for="dev-bk">{{ t('views.devSearch.bm25k') }}</label>
        <input id="dev-bk" v-model.number="cfg.bm25_k" type="number" min="1" max="200" class="form-control form-control-sm">
      </div>
      <div class="col-6 col-md-2">
        <label class="form-label small mb-0" for="dev-vk">{{ t('views.devSearch.vectork') }}</label>
        <input id="dev-vk" v-model.number="cfg.vector_k" type="number" min="1" max="200" class="form-control form-control-sm">
      </div>
      <div class="col-6 col-md-2">
        <label class="form-label small mb-0" for="dev-rk">{{ t('views.devSearch.rrfk') }}</label>
        <input id="dev-rk" v-model.number="cfg.rrf_k" type="number" min="1" max="500" class="form-control form-control-sm">
      </div>
      <div class="col-12 col-md-4 small text-body-secondary">{{ t('views.devSearch.fixed') }}</div>
      <div class="col-12 col-md-2 d-grid">
        <button class="btn btn-primary btn-sm" type="submit" :disabled="!question.trim() || loading">
          <span v-if="loading" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>{{ loading ? t('views.papers.searching') : t('views.devSearch.run') }}
        </button>
      </div>
    </div>
  </form>

  <div v-if="error" class="alert alert-danger">■ {{ error }}</div>

  <template v-if="result">
    <div v-if="result.vector_status !== 'ready'" class="alert alert-warning py-2 small">
      {{ t('views.papers.vectorUnavailable', { r: result.vector_reason }) }}
    </div>

    <!-- 세 방식의 최종 문단 -->
    <div class="row g-3 mb-4">
      <div v-for="m in MODES" :key="m" class="col-12 col-xl-4">
        <div class="card h-100">
          <div class="card-header d-flex py-1">
            <span class="fw-semibold small">{{ t('views.papers.mode.' + m) }}</span>
            <span v-if="result.modes[m]" class="small text-body-secondary ms-auto">
              {{ t('views.devSearch.finalCount', { n: result.modes[m].final.length }) }} · {{ result.modes[m].ms }} ms
            </span>
          </div>
          <div v-if="!result.modes[m]" class="card-body small text-body-secondary">{{ t('views.devSearch.unavailable') }}</div>
          <ol v-else class="list-group list-group-flush list-group-numbered">
            <li v-for="e in result.modes[m].final" :key="e.chunk_id" class="list-group-item small">
              <SourceMeta :src="e" compact class="d-inline-block align-top" style="max-width: 92%" />
              <div class="text-body-secondary dev-ranks">
                BM25 {{ e.bm25_rank ?? '–' }} · {{ t('views.devSearch.vectorRank') }} {{ e.vector_rank ?? '–' }}
                <template v-if="m === 'hybrid'"> · RRF {{ f4(e.rrf) }}</template>
              </div>
              <div class="rag-text mt-1">
                {{ open[m + e.chunk_id] ? e.text : e.text.slice(0, 180) + (e.text.length > 180 ? '…' : '') }}
                <button v-if="e.text.length > 180" type="button" class="btn btn-link btn-sm p-0"
                  @click="open[m + e.chunk_id] = !open[m + e.chunk_id]">
                  {{ open[m + e.chunk_id] ? t('views.papers.showLess') : t('views.papers.showMore') }}
                </button>
              </div>
            </li>
            <li v-if="!result.modes[m].final.length" class="list-group-item small text-body-secondary">
              {{ t('views.papers.evidenceNone') }}
            </li>
          </ol>
        </div>
      </div>
    </div>

    <!-- 후보 전체: 순위와 최종 포함 여부 -->
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <h2 class="h6 mb-0">{{ t('views.devSearch.candidates') }}</h2>
      <div class="btn-group btn-group-sm" role="group">
        <button v-for="m in MODES" :key="m" type="button" class="btn"
          :class="tableMode === m ? 'btn-primary' : 'btn-outline-primary'" :disabled="!result.modes[m]"
          @click="tableMode = m; showAll = false">{{ t('views.papers.mode.' + m) }}</button>
      </div>
      <span class="small text-body-secondary">{{ t('views.devSearch.rowsNote', { n: total }) }}</span>
    </div>
    <div class="table-responsive">
      <table class="table table-sm small align-middle dev-table">
        <thead>
          <tr>
            <th>{{ tableMode === 'hybrid' ? t('views.devSearch.fusedRank') : t('views.devSearch.rank') }}</th>
            <th>BM25</th><th>{{ t('views.devSearch.vectorRank') }}</th>
            <th v-if="tableMode === 'hybrid'">RRF</th>
            <th>{{ t('views.devSearch.rawScore') }}</th>
            <th>{{ t('views.devSearch.docPage') }}</th>
            <th>{{ t('views.devSearch.decisionHead') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in table" :key="e.chunk_id" :class="{ 'table-primary': e.decision === 'selected' }">
            <td>{{ e.list_rank }}</td>
            <td>{{ e.bm25_rank ?? '–' }}</td>
            <td>{{ e.vector_rank ?? '–' }}</td>
            <td v-if="tableMode === 'hybrid'">{{ f4(e.rrf) }}</td>
            <td class="text-nowrap">{{ e.bm25_score != null ? 'BM25 ' + f3(e.bm25_score) : '' }}
              {{ e.cosine != null ? 'cos ' + f3(e.cosine) : '' }}</td>
            <td><span class="text-break">{{ e.doc_id }}</span> · p.{{ e.pdf_page }}</td>
            <td>{{ decision(e) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="!showAll && total > 30" type="button" class="btn btn-outline-secondary btn-sm" @click="showAll = true">
      {{ t('views.devSearch.showAll', { n: total }) }}
    </button>
  </template>

  <div class="mt-4"><RouterLink to="/ask/papers" class="small">{{ t('views.devSearch.back') }}</RouterLink></div>
</template>
