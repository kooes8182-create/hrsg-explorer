import { computed, reactive } from 'vue'
import { api, getHealth } from './api.js'

// 브라우저 저장소는 화면 설정(언어·테마·마지막 케이스)만 기억합니다. 접근이 막혀도 앱은 동작해야 합니다.
function load(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 저장 실패는 무시 */
  }
}

export const store = reactive({
  lang: load('hrsg.lang', 'ko'), // 'ko' | 'en'
  theme: load('hrsg.theme', 'light'), // 'light' | 'dark'
  pressureUnit: load('hrsg.pressureUnit', 'kPa'), // 'kPa' | 'inH2O' | 'mbar' — 화면 표시 단위 (저장값은 항상 kPa)
  server: { state: 'checking', checkedAt: null }, // checking | ok | db_error | offline

  cases: [],
  casesLoaded: false,
  casesError: null,
  currentCaseId: Number(load('hrsg.caseId', '')) || null,

  // 저장하지 않은 입력: 케이스별로 따로 보관 → 화면을 옮겨도 남고, 다른 케이스와 섞이지 않습니다.
  // drafts[caseId] = { checklist: { [itemKey]: { field: 값 } }, operating: { [fieldKey]: 값 },
  //                    economics: { ['smp' | 'A.cleaning_cost' ...]: 값 }, pinch: { [fieldKey]: 값 }, reference: {...} }
  drafts: {},

  // 논문 근거 질문 대화 (브라우저 메모리에만 — 새로고침하면 사라짐)
  rag: { items: [] },
  // 검색 비교 화면의 마지막 질문·설정·결과 (화면을 옮겨도 남음, 새로고침하면 사라짐)
  lab: { question: '', cfg: { bm25_k: 50, vector_k: 50, rrf_k: 60 }, result: null, tableMode: 'hybrid' },
})

export const currentCase = computed(() => store.cases.find((c) => c.id === store.currentCaseId) || null)

// ------------------------------------------------------------ 언어·테마·서버
export function setLang(lang) {
  store.lang = lang
  save('hrsg.lang', lang)
  document.documentElement.lang = lang
}

export function applyTheme() {
  document.documentElement.setAttribute('data-bs-theme', store.theme)
  document.documentElement.lang = store.lang
}

export function toggleTheme() {
  store.theme = store.theme === 'dark' ? 'light' : 'dark'
  save('hrsg.theme', store.theme)
  applyTheme()
}

export function setPressureUnit(u) {
  store.pressureUnit = u
  save('hrsg.pressureUnit', u)
}

export async function checkServer() {
  store.server.state = 'checking'
  store.server.state = await getHealth()
  store.server.checkedAt = new Date()
}

// ------------------------------------------------------------ 평가 케이스
export function selectCase(id) {
  store.currentCaseId = id
  save('hrsg.caseId', id ? String(id) : '')
}

export async function loadCases() {
  store.casesError = null
  try {
    store.cases = await api.listCases()
    store.casesLoaded = true
    if (!store.cases.some((c) => c.id === store.currentCaseId)) selectCase(store.cases[0]?.id ?? null)
  } catch (err) {
    store.casesError = err
    checkServer()
  }
}

export async function createCase(data) {
  const created = await api.createCase(data)
  store.cases.unshift(created)
  selectCase(created.id)
  return created
}

export async function updateCase(id, data) {
  const updated = await api.updateCase(id, data)
  const i = store.cases.findIndex((c) => c.id === id)
  if (i >= 0) store.cases[i] = updated
  return updated
}

export async function deleteCase(id, confirmName) {
  await api.deleteCase(id, confirmName)
  store.cases = store.cases.filter((c) => c.id !== id)
  delete store.drafts[id] // 지운 케이스의 저장 안 된 입력도 버림
  if (store.currentCaseId === id) selectCase(store.cases[0]?.id ?? null)
}

// ------------------------------------------------------------ 저장하지 않은 입력
export function draftFor(caseId) {
  if (!store.drafts[caseId]) store.drafts[caseId] = { checklist: {}, operating: {}, economics: {}, pinch: {}, reference: {} }
  return store.drafts[caseId]
}

export function dirtyCount(caseId) {
  const d = store.drafts[caseId]
  if (!d) return 0
  return Object.values(d).reduce((n, part) => n + Object.keys(part).length, 0)
}

// 서버가 돌려준 평가 모드를 케이스 목록에도 반영 (상단 모드 배지)
export function setCaseMode(caseId, mode) {
  const c = store.cases.find((x) => x.id === caseId)
  if (c) c.mode = mode
}

export function clearDraft(obj) {
  for (const k of Object.keys(obj)) delete obj[k]
}
