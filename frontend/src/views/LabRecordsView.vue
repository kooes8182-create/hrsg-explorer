<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.js'
import { checkServer } from '../store.js'
import { t } from '../i18n/index.js'
import { dateTime, num } from '../format.js'

// 공식 평가셋 v1 검색 실험 기록. 서버가 저장된 결과 파일을 읽어 주는 값만 그립니다(이 화면은 검색·채점을 실행하지 않음).
const data = ref(null)
const error = ref(false)
async function load() {
  error.value = false
  try {
    data.value = await api.ragExperiments()
  } catch {
    error.value = true
    checkServer()
  }
}
onMounted(load)

const test = computed(() => data.value?.test)
const dev = computed(() => data.value?.dev)
const pct = (v) => (v == null ? '—' : num(v * 100, 1) + '%')
const f3 = (v) => (v == null ? '—' : num(v, 3))
const pp = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + num(v, 1) + '%p')
const TEST_ROWS = ['test_ko', 'test_en', 'test_all', 'all_ko', 'all_en', 'all_all']

// ---------------------------------------------------------------- dev 가중치 비교 그래프
const METRICS = ['ko_recall8', 'ko_mrr', 'en_recall8']
const metric = ref('ko_recall8')
const W = 900, H = 340, L = 48, R = 150, T = 16, B = 44
const yMin = computed(() => {
  const vals = (dev.value?.models || []).flatMap((m) => m.points.map((p) => p[metric.value]))
  const base = dev.value?.baseline?.[metric.value]
  const lo = Math.min(...vals, base ?? 1)
  return Math.max(0, Math.floor((lo - 0.05) * 10) / 10)
})
const x = (w) => L + w * (W - L - R)
const y = (v) => T + (1 - (v - yMin.value) / (1 - yMin.value)) * (H - T - B)
const yTicks = computed(() => {
  const out = []
  for (let v = yMin.value; v <= 1.0001; v += 0.1) out.push(Math.round(v * 10) / 10)
  return out
})
const series = computed(() => (dev.value?.models || []).map((m, i) => ({
  ...m, cls: 'series-' + (i + 1),
  path: m.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.vector_weight).toFixed(1)},${y(p[metric.value]).toFixed(1)}`).join(' '),
  last: m.points[m.points.length - 1],
  // 최고점이 여러 가중치에서 같으면 모두 표시 (예: 60%·70% 동점)
  bestVal: Math.max(...m.points.map((p) => p[metric.value])),
})).map((s) => ({ ...s, bestWs: s.points.filter((p) => p[metric.value] === s.bestVal).map((p) => p.vector_weight) })))
// 기본 안내: 모델별 최고점 (그래프에서 진하게 표시한 점)
const bestText = computed(() => series.value.map((s) =>
  t('views.lab.bestOf', { m: s.label, w: s.bestWs.map((w) => num(w * 100, 0)).join('·'), v: f3(s.bestVal) })).join('  /  '))
const picked = ref(null) // { model, w, v }
function pick(s, p) {
  picked.value = { model: s.label, w: p.vector_weight, v: p[metric.value] }
}
</script>

<template>
  <p class="tab-lead">{{ t('views.lab.recordsLead') }}</p>

  <div v-if="error" class="alert alert-danger d-flex align-items-center gap-2">
    <span>{{ t('common.loadFailed') }} {{ t('views.home.loadHelp') }}</span>
    <button class="btn btn-sm btn-light ms-auto" @click="load">{{ t('server.retry') }}</button>
  </div>
  <div v-else-if="!data" class="text-body-secondary py-3">
    <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
  </div>

  <template v-else>
    <div v-if="data.missing.length" class="alert alert-warning small">{{ t('views.lab.missing') }} {{ data.missing.join(', ') }}</div>

    <!-- 실험 진행 상태 -->
    <ol class="stage-row">
      <li class="stage done"><span class="stage-tag">dev</span>{{ t('views.lab.stageDev') }}</li>
      <li class="stage done"><span class="stage-tag">lock</span>{{ t('views.lab.stageLock') }}<template v-if="test"> · {{ dateTime(test.locked.locked_at) }}</template></li>
      <li class="stage done"><span class="stage-tag tag-test">test</span>{{ t('views.lab.stageTest') }}</li>
    </ol>

    <!-- test 핵심 결과 -->
    <section v-if="test" class="panel mb-3">
      <div class="panel-head">
        <div class="me-auto">
          <div class="panel-title">{{ t('views.lab.testTitle') }} <span class="badge split-badge split-test">test</span></div>
          <div class="panel-sub">{{ t('views.lab.testSub') }}</div>
        </div>
      </div>
      <div class="headline-grid">
        <div class="headline">
          <div class="headline-label">{{ t('views.lab.koRecallTest') }}</div>
          <div class="headline-value">{{ f3(test.groups.test_ko.locked_recall) }}</div>
          <div class="headline-sub">{{ t('views.lab.fromBaseline', { v: f3(test.groups.test_ko.base_recall) }) }} · <strong>{{ pp(test.groups.test_ko.recall_delta_pp) }}</strong></div>
        </div>
        <div class="headline">
          <div class="headline-label">{{ t('views.lab.allRecallTest') }}</div>
          <div class="headline-value">{{ f3(test.groups.test_all.locked_recall) }}</div>
          <div class="headline-sub">{{ t('views.lab.fromBaseline', { v: f3(test.groups.test_all.base_recall) }) }} · <strong>{{ pp(test.groups.test_all.recall_delta_pp) }}</strong></div>
        </div>
        <div class="headline">
          <div class="headline-label">{{ t('views.lab.koMrrTest') }}</div>
          <div class="headline-value">{{ f3(test.groups.test_ko.locked_mrr) }}</div>
          <div class="headline-sub">{{ t('views.lab.fromBaseline', { v: f3(test.groups.test_ko.base_mrr) }) }} · <strong>{{ pp(test.groups.test_ko.mrr_delta_pp) }}</strong></div>
        </div>
        <div class="locked-box">
          <div class="headline-label">{{ t('views.lab.locked') }}</div>
          <div class="fw-semibold">{{ test.locked_label }} · {{ t('views.lab.weights', { v: num(test.locked.vector_weight * 100, 0), b: num(test.locked.bm25_weight * 100, 0) }) }}</div>
          <div class="small text-body-secondary">{{ t('views.lab.lockedDetail', { b: test.locked.bm25_k, v: test.locked.vector_k, k: test.locked.rrf_k, f: test.locked.final_k, c: test.locked.per_ref_cap }) }}</div>
        </div>
      </div>

      <div class="table-responsive mt-3">
        <table class="table table-sm data-table mb-0">
          <thead><tr>
            <th>{{ t('views.lab.group') }}</th><th class="text-end">{{ t('views.lab.n') }}</th>
            <th class="text-end">Recall@8 {{ t('views.lab.base') }}</th><th class="text-end">Recall@8 {{ t('views.lab.lockedShort') }}</th><th class="text-end">{{ t('views.lab.delta') }}</th>
            <th class="text-end">MRR {{ t('views.lab.base') }}</th><th class="text-end">MRR {{ t('views.lab.lockedShort') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="k in TEST_ROWS" :key="k" :class="{ 'row-strong': k === 'test_ko' }">
              <td>{{ t('views.lab.groupName.' + k) }} <span class="badge split-badge" :class="k.startsWith('test') ? 'split-test' : 'split-all'">{{ k.startsWith('test') ? 'test' : 'dev+test' }}</span></td>
              <td class="text-end">{{ test.groups[k].n }}</td>
              <td class="text-end num">{{ f3(test.groups[k].base_recall) }}</td>
              <td class="text-end num fw-semibold">{{ f3(test.groups[k].locked_recall) }}</td>
              <td class="text-end num">{{ pp(test.groups[k].recall_delta_pp) }}</td>
              <td class="text-end num">{{ f3(test.groups[k].base_mrr) }}</td>
              <td class="text-end num fw-semibold">{{ f3(test.groups[k].locked_mrr) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="note-list">
        <li>{{ t('views.lab.noteOnce') }}</li>
        <li>{{ t('views.lab.noteSmall') }}</li>
        <li>{{ t('views.lab.noteScope') }}</li>
        <li v-if="test.dev_part_matches">{{ t('views.lab.noteMatch') }}</li>
      </ul>
    </section>

    <!-- dev 모델·가중치 비교 -->
    <section v-if="dev" class="panel mb-3">
      <div class="panel-head">
        <div class="me-auto">
          <div class="panel-title">{{ t('views.lab.devTitle') }} <span class="badge split-badge split-dev">dev</span></div>
          <div class="panel-sub">{{ t('views.lab.devSub', { b: dev.stage1_setting.bm25_k, v: dev.stage1_setting.vector_k, k: dev.stage1_setting.rrf_k, n: dev.baseline.ko_n }) }}</div>
        </div>
        <div class="seg seg-sm" role="group" :aria-label="t('views.lab.metric')">
          <button v-for="m in METRICS" :key="m" type="button" :class="{ on: metric === m }" :aria-pressed="metric === m"
            @click="metric = m; picked = null">{{ t('views.lab.metricName.' + m) }}</button>
        </div>
      </div>

      <div class="chart-legend">
        <span v-for="s in series" :key="s.key"><span class="swatch" :class="s.cls"></span>{{ s.label }}</span>
        <span><span class="swatch swatch-dash"></span>{{ t('views.lab.baseline') }}</span>
      </div>
      <div class="diagram-scroll">
        <svg class="line-chart" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="t('views.lab.chartAria', { m: t('views.lab.metricName.' + metric) })">
          <g v-for="v in yTicks" :key="v">
            <line :x1="L" :x2="W - R" :y1="y(v)" :y2="y(v)" class="chart-grid" />
            <text :x="L - 8" :y="y(v) + 4" text-anchor="end" class="chart-axis">{{ v.toFixed(1) }}</text>
          </g>
          <text v-for="w in [0, 0.2, 0.4, 0.6, 0.8, 1]" :key="w" :x="x(w)" :y="H - B + 18" text-anchor="middle" class="chart-axis">{{ w * 100 }}%</text>
          <text :x="(L + W - R) / 2" :y="H - 4" text-anchor="middle" class="chart-axis-title">{{ t('views.lab.xAxis') }}</text>
          <line v-if="dev.baseline" :x1="L" :x2="W - R" :y1="y(dev.baseline[metric])" :y2="y(dev.baseline[metric])" class="chart-baseline" />
          <text v-if="dev.baseline" :x="W - R + 6" :y="y(dev.baseline[metric]) + 4" class="chart-end-label muted">BM25 {{ f3(dev.baseline[metric]) }}</text>
          <g v-for="s in series" :key="s.key">
            <path :d="s.path" class="chart-line" :class="s.cls" />
            <circle v-for="p in s.points" :key="p.vector_weight" :cx="x(p.vector_weight)" :cy="y(p[metric])" r="4.5"
              class="chart-dot" :class="[s.cls, { best: s.bestWs.includes(p.vector_weight) }]" tabindex="0" role="button"
              :aria-label="`${s.label} ${p.vector_weight * 100}% ${f3(p[metric])}`"
              @click="pick(s, p)" @focus="pick(s, p)" @keydown.enter="pick(s, p)"><title>{{ s.label }} · {{ p.vector_weight * 100 }}% · {{ f3(p[metric]) }}</title></circle>
            <text :x="W - R + 6" :y="y(s.last[metric]) + 4" class="chart-end-label">{{ s.label }}</text>
          </g>
        </svg>
      </div>
      <div class="chart-readout" aria-live="polite">
        <template v-if="picked">{{ t('views.lab.picked', { m: picked.model, w: num(picked.w * 100, 0), v: f3(picked.v) }) }}</template>
        <template v-else>{{ bestText }}</template>
      </div>

      <details class="disclosure mt-2">
        <summary>{{ t('views.lab.stage2') }}</summary>
        <div class="table-responsive mt-2">
          <table class="table table-sm data-table mb-0">
            <thead><tr><th>{{ t('views.lab.model') }}</th><th class="text-end">{{ t('views.lab.vectorWeight') }}</th><th class="text-end">BM25 k</th><th class="text-end">{{ t('views.lab.vectorK') }}</th><th class="text-end">RRF k</th>
              <th class="text-end">{{ t('views.lab.metricName.ko_recall8') }}</th><th class="text-end">{{ t('views.lab.metricName.ko_mrr') }}</th><th class="text-end">{{ t('views.lab.metricName.en_recall8') }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in dev.stage2" :key="i" :class="{ 'row-strong': test && r.model === test.locked_label && r.vector_weight === test.locked.vector_weight && r.bm25_k === test.locked.bm25_k && r.vector_k === test.locked.vector_k && r.rrf_k === test.locked.rrf_k }">
                <td>{{ r.model }}</td><td class="text-end num">{{ num(r.vector_weight * 100, 0) }}%</td><td class="text-end num">{{ r.bm25_k }}</td><td class="text-end num">{{ r.vector_k }}</td><td class="text-end num">{{ r.rrf_k }}</td>
                <td class="text-end num">{{ f3(r.ko_recall8) }}</td><td class="text-end num">{{ f3(r.ko_mrr) }}</td><td class="text-end num">{{ f3(r.en_recall8) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="hint">{{ t('views.lab.stage2Note') }}</div>
      </details>
      <details class="disclosure mt-2">
        <summary>{{ t('views.lab.tableView') }}</summary>
        <div class="table-responsive mt-2">
          <table class="table table-sm data-table mb-0">
            <thead><tr><th>{{ t('views.lab.vectorWeight') }}</th><th v-for="s in series" :key="s.key" class="text-end">{{ s.label }}</th></tr></thead>
            <tbody>
              <tr v-for="(p, i) in series[0]?.points || []" :key="i">
                <td class="num">{{ num(p.vector_weight * 100, 0) }}%</td>
                <td v-for="s in series" :key="s.key" class="text-end num">{{ f3(s.points[i]?.[metric]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <div class="note-box">{{ t('views.lab.corpusNote') }}</div>
  </template>
</template>
