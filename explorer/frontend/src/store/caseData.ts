import { create } from 'zustand'
import { api, ApiError } from '../api/client'
import {
  isInputs, isResults, isSchema,
  type FieldSpec, type InputsPayload, type Kind, type Mode, type ResultsPayload, type Scenario, type Schema, type Values,
} from '../api/engine'
import { useNotifications } from './notifications'
import type { Bilingual } from '../api/types'

// 현재 케이스의 입력값·결과. 시뮬레이션·계산기·심층 분석·세정 전후가 같은 draft 와 결과를 공유합니다.
// 원본은 서버 DB 이며, draft 는 아직 저장하지 않은 화면 입력입니다.

export interface Draft {
  mode: Mode
  scenario: Scenario
  values: Values
}

interface CaseDataState {
  schema: Schema | null
  caseId: number | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  inputs: InputsPayload | null
  draft: Draft | null
  results: ResultsPayload | null
  running: boolean
  runError: { text: Bilingual; fields: Record<string, Bilingual> } | null

  loadSchema: () => Promise<void>
  load: (caseId: number) => Promise<void>
  refreshResults: () => Promise<void>
  setValue: (key: string, v: string | number | null) => void
  setMode: (m: Mode) => void
  applyScenario: (id: Exclude<Scenario, 'CUSTOM'>) => void
  resetDefaults: () => void
  revertToSaved: () => void
  saveDraft: () => Promise<boolean>
  run: (kind?: Kind | 'all') => Promise<boolean>
  setInputs: (p: InputsPayload) => void
}

const same = (a: unknown, b: unknown) => {
  if (a === '' || a === undefined) a = null
  if (b === '' || b === undefined) b = null
  if (a === null || b === null) return a === b
  const na = Number(a), nb = Number(b)
  return typeof a === 'string' && isNaN(na) ? a === b : na === nb
}

export function dirtyKeys(draft: Draft | null, saved: InputsPayload | null): string[] {
  if (!draft || !saved) return []
  const keys = Object.keys({ ...draft.values, ...saved.values }).filter((k) => !same(draft.values[k], saved.values[k]))
  if (draft.mode !== saved.mode) keys.push('mode')
  return keys
}

/** draft 가 시나리오 값과 같으면 그 시나리오, 아니면 CUSTOM (서버 규칙과 같음) */
export function effectiveScenario(draft: Draft | null, schema: Schema | null): Scenario {
  if (!draft || !schema || draft.mode !== 'DEMO') return 'CUSTOM'
  const sc = schema.scenarios.find((s) => s.id === draft.scenario)
  if (!sc) return 'CUSTOM'
  return Object.entries(sc.values).every(([k, v]) => same(draft.values[k], v)) ? sc.id : 'CUSTOM'
}

/** 화면 즉시 검증 (서버도 같은 규칙으로 다시 검증합니다). */
export function validateField(f: FieldSpec, raw: unknown): Bilingual | null {
  if (raw === null || raw === undefined || raw === '') return f.required ? { ko: '필수 입력입니다.', en: 'Required.' } : null
  if (f.kind === 'choice') return f.choices?.includes(String(raw)) ? null : { ko: '목록에서 고르세요.', en: 'Choose from the list.' }
  const s = String(raw).trim().replace(/,/g, '')
  const n = Number(s)
  if (s === '' || !Number.isFinite(n)) return { ko: '숫자를 입력하세요.', en: 'Enter a number.' }
  if (f.min !== null && f.max !== null && (n < f.min || n > f.max))
    return { ko: `허용 범위 ${f.min.toLocaleString()} ~ ${f.max.toLocaleString()} ${f.unit ?? ''}`, en: `Allowed ${f.min.toLocaleString()} – ${f.max.toLocaleString()} ${f.unit ?? ''}` }
  return null
}

export function validateDraft(schema: Schema | null, draft: Draft | null): Record<string, Bilingual> {
  const out: Record<string, Bilingual> = {}
  if (!schema || !draft) return out
  for (const f of schema.fields) {
    const e = validateField(f, draft.values[f.key])
    if (e) out[f.key] = e
  }
  return out
}

function toServerValues(schema: Schema, values: Values): Values {
  const out: Values = {}
  for (const f of schema.fields) {
    const v = values[f.key]
    out[f.key] = v === '' || v === undefined || v === null ? null : f.kind === 'number' ? Number(String(v).replace(/,/g, '')) : v
  }
  return out
}

const fromSaved = (p: InputsPayload): Draft => ({ mode: p.mode, scenario: p.scenario, values: { ...p.values } })

export const useCaseData = create<CaseDataState>((set, get) => ({
  schema: null,
  caseId: null,
  status: 'idle',
  inputs: null,
  draft: null,
  results: null,
  running: false,
  runError: null,

  loadSchema: async () => {
    if (get().schema) return
    try {
      set({ schema: await api('/inputs/schema/', {}, isSchema) })
    } catch {
      /* 화면에서 status 로 안내 */
    }
  },

  load: async (caseId) => {
    set({ caseId, status: 'loading', inputs: null, draft: null, results: null, runError: null })
    try {
      await get().loadSchema()
      const [inputs, results] = await Promise.all([
        api(`/cases/${caseId}/inputs/`, {}, isInputs),
        api(`/cases/${caseId}/results/`, {}, isResults),
      ])
      if (get().caseId !== caseId) return // 그 사이 다른 케이스로 전환됨
      set({ inputs, draft: fromSaved(inputs), results, status: 'ready' })
    } catch {
      if (get().caseId === caseId) set({ status: 'error' })
    }
  },

  refreshResults: async () => {
    const id = get().caseId
    if (id === null) return
    try {
      const results = await api(`/cases/${id}/results/`, {}, isResults)
      if (get().caseId === id) set({ results })
    } catch {
      /* 이전 결과 유지 */
    }
  },

  setInputs: (p) => set({ inputs: p, draft: fromSaved(p) }),

  setValue: (key, v) => {
    const d = get().draft
    if (d) set({ draft: { ...d, values: { ...d.values, [key]: v } }, runError: null })
  },
  setMode: (m) => {
    const d = get().draft
    if (d) set({ draft: { ...d, mode: m } })
  },
  applyScenario: (id) => {
    const { draft, schema } = get()
    const sc = schema?.scenarios.find((s) => s.id === id)
    if (draft && sc) set({ draft: { mode: 'DEMO', scenario: id, values: { ...sc.values } }, runError: null })
  },
  resetDefaults: () => {
    const { draft, schema } = get()
    if (draft && schema) set({ draft: { ...draft, scenario: 'CUSTOM', values: { ...schema.defaults } }, runError: null })
  },
  revertToSaved: () => {
    const p = get().inputs
    if (p) set({ draft: fromSaved(p), runError: null })
  },

  saveDraft: async () => {
    const { caseId, draft, schema } = get()
    if (caseId === null || !draft || !schema) return false
    const errs = validateDraft(schema, draft)
    if (Object.keys(errs).length) {
      set({ runError: { text: { ko: '입력값을 확인하세요.', en: 'Check the inputs.' }, fields: errs } })
      // 계산 실패 알림 (서버가 문구를 만들고, 같은 실패가 이어지면 1건만 유지)
      useNotifications.getState().clientEvent({ kind: 'calc_failed', case: caseId, fields: Object.keys(errs) }).then(() => useNotifications.getState().load())
      return false
    }
    try {
      const body = { mode: draft.mode, scenario: effectiveScenario(draft, schema), values: toServerValues(schema, draft.values) }
      const p = await api(`/cases/${caseId}/inputs/`, { method: 'PUT', json: body }, isInputs)
      set({ inputs: p, draft: fromSaved(p), runError: null })
      await get().refreshResults()
      return true
    } catch (e) {
      const ae = e instanceof ApiError ? e : null
      const fields: Record<string, Bilingual> = {}
      for (const [k, v] of Object.entries(ae?.fields ?? {})) fields[k] = Array.isArray(v) ? { ko: v.join(' '), en: v.join(' ') } : v
      set({ runError: { text: ae?.text ?? { ko: String(e), en: String(e) }, fields } })
      return false
    }
  },

  /** 입력 저장 → 서버 계산 → 결과 다시 읽기 */
  run: async (kind = 'all') => {
    const { caseId } = get()
    if (caseId === null) return false
    set({ running: true })
    try {
      if (!(await get().saveDraft())) return false
      await api(`/cases/${caseId}/evaluate/${kind}/`, { method: 'POST' })
      await get().refreshResults()
      return true
    } catch (e) {
      set({ runError: { text: e instanceof ApiError ? e.text : { ko: String(e), en: String(e) }, fields: {} } })
      return false
    } finally {
      set({ running: false })
    }
  },
}))
