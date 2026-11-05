import { create } from 'zustand'
import { api, ApiError } from '../api/client'
import { isCase, isCaseList, isCloneResult, isHealth, type Case, type Health, type Lang } from '../api/types'

// 전역 상태. 업무 데이터의 원본은 서버 DB 이고, 여기 있는 케이스 목록은 서버 응답의 사본입니다.
// localStorage 에는 언어·테마·메뉴 접힘·마지막 케이스 ID 만 기억합니다.

type Theme = 'light' | 'dark'
export type HealthState = 'checking' | 'ok' | 'unreachable' | 'db_error'
export type SaveState = 'saved' | 'pending' | 'failed' | 'quota'

export type PressureUnit = 'mmH2O' | 'kPa' | 'inH2O' | 'mbar'
export type TempUnit = '°C' | '°F'

interface Prefs {
  lang: Lang
  theme: Theme
  sidebarCollapsed: boolean
  currentCaseId: number | null
  // 표시 단위: 결과 표시만 바꾸고 저장·계산 값은 그대로 (입력은 항상 저장 단위)
  pressureUnit: PressureUnit
  tempUnit: TempUnit
}

const PREFS_KEY = 'hrsgx.prefs'

function readPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>
  } catch {
    return {}
  }
}

/** 저장 성공 여부를 돌려줍니다. 저장 공간이 부족하면 'quota'. */
function writePrefs(p: Partial<Prefs>): SaveState {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
    return 'saved'
  } catch (e) {
    return e instanceof DOMException && e.name === 'QuotaExceededError' ? 'quota' : 'saved'
  }
}

const initial = readPrefs()
const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

interface AppState extends Prefs {
  cases: Case[]
  casesStatus: 'idle' | 'loading' | 'ready' | 'error'
  health: { state: HealthState; data: Health | null; checkedAt: Date | null }
  saveState: SaveState
  prefsWarning: boolean

  setLang: (l: Lang) => void
  setUnits: (u: { pressureUnit?: PressureUnit; tempUnit?: TempUnit }) => void
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  checkHealth: () => Promise<void>
  loadCases: () => Promise<void>
  switchCase: (id: number) => void
  createCase: (name: string, memo: string) => Promise<Case>
  updateCase: (id: number, patch: { name?: string; memo?: string }) => Promise<Case>
  cloneCase: (id: number) => Promise<Case>
  deleteCase: (id: number) => Promise<void>
}

// 테마는 사용자가 직접 고른 경우에만 기억합니다. 고르지 않았으면 계속 시스템 설정(라이트/다크)을 따릅니다.
let themeChosen = initial.theme !== undefined

export const useApp = create<AppState>((set, get) => {
  const persist = () => {
    const { lang, theme, sidebarCollapsed, currentCaseId, pressureUnit, tempUnit } = get()
    const result = writePrefs({ lang, sidebarCollapsed, currentCaseId, pressureUnit, tempUnit, ...(themeChosen ? { theme } : {}) })
    set({ prefsWarning: result === 'quota' })
  }

  /** 서버에 쓰는 작업의 저장 상태 표시 */
  const saving = async <T>(work: () => Promise<T>): Promise<T> => {
    set({ saveState: 'pending' })
    try {
      const out = await work()
      set({ saveState: 'saved' })
      return out
    } catch (e) {
      set({ saveState: 'failed' })
      throw e
    }
  }

  return {
    lang: initial.lang === 'en' ? 'en' : 'ko',
    theme: initial.theme ?? (systemDark ? 'dark' : 'light'),
    sidebarCollapsed: initial.sidebarCollapsed ?? false,
    currentCaseId: typeof initial.currentCaseId === 'number' ? initial.currentCaseId : null,
    pressureUnit: (['mmH2O', 'kPa', 'inH2O', 'mbar'] as const).includes(initial.pressureUnit as PressureUnit) ? (initial.pressureUnit as PressureUnit) : 'mmH2O',
    tempUnit: initial.tempUnit === '°F' ? '°F' : '°C',
    cases: [],
    casesStatus: 'idle',
    health: { state: 'checking', data: null, checkedAt: null },
    saveState: 'saved',
    prefsWarning: false,

    setLang: (lang) => {
      set({ lang })
      document.documentElement.lang = lang
      persist()
    },
    setUnits: (u) => {
      set(u)
      persist()
    },
    setTheme: (theme) => {
      themeChosen = true
      set({ theme })
      document.documentElement.classList.toggle('dark', theme === 'dark')
      persist()
    },
    toggleSidebar: () => {
      set({ sidebarCollapsed: !get().sidebarCollapsed })
      persist()
    },

    checkHealth: async () => {
      // /health/ 는 DB 오류일 때 503 + 본문을 주므로 직접 읽습니다.
      try {
        const res = await fetch('/api/health/', { headers: { Accept: 'application/json' } })
        const body: unknown = await res.json().catch(() => null)
        if (!isHealth(body)) {
          set({ health: { state: 'unreachable', data: null, checkedAt: new Date() } })
          return
        }
        set({ health: { state: body.database === 'ok' ? 'ok' : 'db_error', data: body, checkedAt: new Date() } })
      } catch {
        set({ health: { state: 'unreachable', data: null, checkedAt: new Date() } })
      }
    },

    loadCases: async () => {
      set({ casesStatus: 'loading' })
      try {
        const cases = await api('/cases/', {}, isCaseList)
        const cur = get().currentCaseId
        const currentCaseId = cases.some((c) => c.id === cur) ? cur : (cases[0]?.id ?? null)
        set({ cases, casesStatus: 'ready', currentCaseId })
        persist()
      } catch {
        set({ casesStatus: 'error' })
      }
    },

    switchCase: (id) => {
      if (!get().cases.some((c) => c.id === id)) return
      set({ currentCaseId: id })
      persist()
    },

    createCase: (name, memo) =>
      saving(async () => {
        const c = await api('/cases/', { method: 'POST', json: { name, memo } }, isCase)
        set({ cases: [...get().cases, c], currentCaseId: c.id })
        persist()
        return c
      }),

    updateCase: (id, patch) =>
      saving(async () => {
        const c = await api(`/cases/${id}/`, { method: 'PATCH', json: patch }, isCase)
        set({ cases: get().cases.map((x) => (x.id === id ? c : x)) })
        return c
      }),

    cloneCase: (id) =>
      saving(async () => {
        const r = await api(`/cases/${id}/clone/`, { method: 'POST', json: {} }, isCloneResult)
        set({ cases: [...get().cases, r.case], currentCaseId: r.case.id })
        persist()
        return r.case
      }),

    deleteCase: (id) =>
      saving(async () => {
        await api<void>(`/cases/${id}/`, { method: 'DELETE' })
        const cases = get().cases.filter((c) => c.id !== id)
        const currentCaseId = get().currentCaseId === id ? (cases[0]?.id ?? null) : get().currentCaseId
        set({ cases, currentCaseId })
        persist()
      }),
  }
})

export const currentCase = (s: AppState) => s.cases.find((c) => c.id === s.currentCaseId) ?? null
export { ApiError }
