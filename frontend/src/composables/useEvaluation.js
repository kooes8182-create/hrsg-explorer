import { computed, inject, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import { api } from '../api.js'
import { store, draftFor, clearDraft, checkServer, setCaseMode } from '../store.js'
import { t } from '../i18n/index.js'

// 성능·경제성 평가 화면의 공유 상태. 화면은 입력을 저장하고 서버 결과를 그리기만 합니다(계산·판정은 서버).
const KEY = Symbol('evaluation')
const KIND = { performance: 'PERFORMANCE', economics: 'ECONOMICS', 'pinch-approach': 'PINCH_APPROACH', reference: 'REFERENCE' }
export const METHOD_KEYS = ['A', 'B']
export const ECON_FIELDS = [
  { key: 'recovered_mw', unit: 'MW', label: 'recoveredMw' },
  { key: 'operating_hours', unit: 'h', label: 'operatingHours' },
  { key: 'cleaning_cost', unit: '원', label: 'cleaningCost' },
  { key: 'extra_cost', unit: '원', label: 'extraCost' },
]

export const norm = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())
const display = (v) => (v === null || v === undefined ? '' : String(v))

export function useEvaluation() {
  return inject(KEY)
}

export function provideEvaluation() {
  const inputs = ref(null)
  const results = ref(null)
  const scenarios = ref(null)
  const publicSmp = ref(null)
  const sources = ref(null)
  const loadError = ref(false)
  const pickingDemo = ref(false)
  const busy = reactive({ performance: false, economics: false, 'pinch-approach': false, reference: false })
  const errors = reactive({ performance: {}, economics: {}, pinch: {}, reference: {} })
  const message = reactive({ performance: null, economics: null, pinch: null, reference: null })

  async function load() {
    const id = store.currentCaseId
    if (!id) return
    loadError.value = false
    try {
      const [inp, res, sc, smp, src] = await Promise.all([
        api.inputs(id), api.results(id), scenarios.value || api.scenarios(),
        publicSmp.value || api.publicSmp(), sources.value || api.publicSources(),
      ])
      if (id !== store.currentCaseId) return
      scenarios.value = sc
      publicSmp.value = smp
      sources.value = src
      inputs.value = { caseId: id, ...inp }
      results.value = { caseId: id, ...res }
    } catch {
      if (id === store.currentCaseId) {
        loadError.value = true
        checkServer()
      }
    }
  }

  let econTimer = null
  watch(() => store.currentCaseId, () => {
    clearTimeout(econTimer)
    inputs.value = null
    results.value = null
    pickingDemo.value = false
    for (const k of Object.keys(errors)) errors[k] = {}
    for (const k of Object.keys(message)) message[k] = null
    load()
  }, { immediate: true })
  onBeforeUnmount(() => clearTimeout(econTimer))

  const shown = computed(() =>
    inputs.value?.caseId === store.currentCaseId && results.value?.caseId === store.currentCaseId ? inputs.value : null)
  const draft = computed(() => draftFor(store.currentCaseId))

  // 저장 → 평가 실행. 서버 400 은 입력 칸 옆에, 그 밖의 오류는 안내 문구로.
  async function saveAndRun(kind, data, errKey, onSaved) {
    const id = store.currentCaseId
    busy[kind] = true
    errors[errKey] = {}
    message[errKey] = null
    try {
      const inp = await api.saveInputs(id, data)
      if (id !== store.currentCaseId) return false
      inputs.value = { caseId: id, ...inp }
      setCaseMode(id, inp.mode)
      onSaved?.()
      const out = await api.evaluate(id, kind)
      if (id !== store.currentCaseId) return false
      results.value = { ...results.value, [KIND[kind]]: out }
      return true
    } catch (err) {
      if (id !== store.currentCaseId) return false
      if (err.kind === 'input') {
        errors[errKey] = err.fields
        message[errKey] = t('common.inputError')
      } else {
        message[errKey] = t('common.saveFailed')
        checkServer()
      }
      return false
    } finally {
      busy[kind] = false
    }
  }

  // 단순 입력 묶음(운전값·핀치·참고 추정)의 저장 전 입력 관리
  function fieldSet(draftKey, serverKey) {
    const server = (key) => display(shown.value?.[serverKey]?.[key])
    const value = (key) => (key in draft.value[draftKey] ? draft.value[draftKey][key] : server(key))
    const set = (key, v) => {
      if (String(v).trim() === server(key).trim()) delete draft.value[draftKey][key]
      else draft.value[draftKey][key] = v
    }
    const dirty = computed(() => Object.keys(draft.value[draftKey]).length > 0)
    return { value, set, dirty, clear: () => clearDraft(draft.value[draftKey]) }
  }
  const op = fieldSet('operating', 'operating_values')
  const pinchF = fieldSet('pinch', 'pinch_inputs')
  const refF = fieldSet('reference', 'reference_inputs')

  // ---------------------------------------------------------------- 성능
  const mode = computed(() => (pickingDemo.value ? 'DEMO' : shown.value?.mode))
  const scenarioList = computed(() => scenarios.value?.scenarios || [])
  const currentScenario = computed(() =>
    pickingDemo.value ? null : scenarioList.value.find((s) => s.id === shown.value?.scenario_id) || null)

  async function chooseScenario(s) {
    pickingDemo.value = false
    // 시나리오의 운전값과 같은 가상 참고 입력(청정 기준 차압·출력)을 함께 넣고, 성능·참고 추정을 같이 계산합니다.
    const ok = await saveAndRun('performance',
      { mode: 'DEMO', scenario_id: s.id, operating_values: s.operating_values, reference_inputs: s.reference_inputs },
      'performance', () => { op.clear(); refF.clear() })
    if (ok) await saveAndRun('reference', { reference_inputs: s.reference_inputs }, 'reference')
  }
  const chooseReal = () => { pickingDemo.value = false; return saveAndRun('performance', { mode: 'REAL' }, 'performance') }
  const chooseDemo = () => { if (shown.value.mode !== 'DEMO') pickingDemo.value = true }

  function saveOperating() {
    const values = Object.fromEntries(shown.value.fields.map((f) => [f.key, norm(op.value(f.key))]))
    return saveAndRun('performance', { operating_values: values }, 'performance', op.clear)
  }
  const perf = computed(() => results.value?.PERFORMANCE || null)
  const perfHidden = computed(() => !!perf.value && (perf.value.stale || op.dirty.value || pickingDemo.value))
  const opDisplay = computed(() => Object.fromEntries((shown.value?.fields || []).map((f) => [f.key, norm(op.value(f.key))])))

  // ---------------------------------------------------------------- 문헌 참고 추정
  function saveReference() {
    const values = Object.fromEntries(shown.value.reference_fields.map((f) => [f.key, norm(refF.value(f.key))]))
    return saveAndRun('reference', { reference_inputs: values }, 'reference', refF.clear)
  }
  const reference = computed(() => results.value?.REFERENCE || null)
  const referenceHidden = computed(() => !!reference.value && (reference.value.stale || refF.dirty.value))

  // ---------------------------------------------------------------- 경제성 (유효하면 자동 저장·계산)
  const econServer = computed(() => shown.value?.economics_assumptions)
  function econServerValue(path) {
    const a = econServer.value
    if (path === 'smp') return a.smp
    const [k, f] = path.split('.')
    return a.methods[k][f]
  }
  function econDisplay(path) {
    const v = econServerValue(path)
    return path.endsWith('_included') ? !!v : display(v)
  }
  const econValue = (path) => (path in draft.value.economics ? draft.value.economics[path] : econDisplay(path))
  // 출처: 직접 고친 칸은 사용자 가정. 버튼으로 넣은 값은 그 출처를 붙여 보냄(서버가 값과 맞는지 다시 확인).
  const econClaims = reactive({})
  function setEcon(path, v, claim) {
    const d = draft.value.economics
    const same = typeof v === 'boolean' ? v === econDisplay(path) : String(v).trim() === String(econDisplay(path)).trim()
    if (same && !claim) delete d[path]
    else d[path] = v
    if (claim) econClaims[path] = claim
    else delete econClaims[path]
    if (path.endsWith('extra_cost_included') && v === true) setEcon(path.replace('_included', ''), '')
    scheduleEcon()
  }
  const econSource = (path) =>
    (path in draft.value.economics ? econClaims[path] || 'USER' : econServer.value?.sources?.[path])
  const numericPaths = ['smp', ...METHOD_KEYS.flatMap((k) => ECON_FIELDS.map((f) => `${k}.${f.key}`))]
  function buildEcon() {
    const out = { smp: norm(econValue('smp')), methods: {}, sources: {} }
    for (const k of METHOD_KEYS) {
      out.methods[k] = { extra_cost_included: !!econValue(`${k}.extra_cost_included`) }
      for (const f of ECON_FIELDS) out.methods[k][f.key] = norm(econValue(`${k}.${f.key}`))
    }
    for (const p of numericPaths) if (econSource(p)) out.sources[p] = econSource(p)
    return out
  }
  function scheduleEcon() {
    clearTimeout(econTimer)
    econTimer = setTimeout(runEcon, 700)
  }
  async function runEcon() {
    const id = store.currentCaseId
    const sent = { ...draft.value.economics }
    if (!Object.keys(sent).length) return
    const ok = await saveAndRun('economics', { economics_assumptions: buildEcon() }, 'economics', () => {
      const d = draftFor(id).economics
      for (const [p, v] of Object.entries(sent)) if (d[p] === v) { delete d[p]; delete econClaims[p] }
    })
    if (ok && Object.keys(draftFor(id).economics).length) scheduleEcon()
  }
  function fillDemoEconomics() {
    const ex = scenarios.value.economics_example
    const data = { smp: ex.smp, methods: ex.methods, sources: {} }
    for (const p of numericPaths) {
      const [k, f] = p.split('.')
      const v = p === 'smp' ? ex.smp : ex.methods[k][f]
      if (v !== null && v !== undefined) data.sources[p] = 'DEMO'
    }
    clearTimeout(econTimer)
    return saveAndRun('economics', { economics_assumptions: data }, 'economics', () => clearDraft(draft.value.economics))
  }
  const econ = computed(() => results.value?.ECONOMICS || null)
  const econDirty = computed(() => Object.keys(draft.value.economics).length > 0)
  const econHidden = computed(() => !!econ.value && (econ.value.stale || econDirty.value))
  const econErr = (path) => errors.economics[`economics.${path}`]

  // ---------------------------------------------------------------- 핀치
  function savePinch() {
    const values = Object.fromEntries(shown.value.pinch_fields.map((f) => [f.key, norm(pinchF.value(f.key))]))
    values.drum_pressure_basis = norm(pinchF.value('drum_pressure_basis'))
    return saveAndRun('pinch-approach', { pinch_inputs: values }, 'pinch', pinchF.clear)
  }
  const pinch = computed(() => results.value?.PINCH_APPROACH || null)
  const pinchHidden = computed(() => !!pinch.value && (pinch.value.stale || pinchF.dirty.value))

  const ctx = {
    load, loadError, shown, draft, busy, errors, message, scenarios, publicSmp, sources,
    // 성능
    op, mode, pickingDemo, scenarioList, currentScenario, chooseScenario, chooseReal, chooseDemo, saveOperating,
    perf, perfHidden, opDisplay,
    // 참고 추정
    refF, saveReference, reference, referenceHidden,
    // 경제성
    econValue, setEcon, econSource, fillDemoEconomics, econ, econDirty, econHidden, econErr,
    // 핀치
    pinchF, savePinch, pinch, pinchHidden,
  }
  provide(KEY, ctx)
  return ctx
}
