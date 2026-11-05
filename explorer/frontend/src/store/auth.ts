import { create } from 'zustand'
import { api, ApiError, UNAUTHORIZED } from '../api/client'
import type { SessionUser } from '../app/access'
import type { Bilingual } from '../api/types'

// 로그인 상태. 원본은 서버 세션이며, 화면은 /api/auth/me/ 로 확인합니다 (localStorage 에 역할을 저장하지 않음).
// 로그인·로그아웃·만료 때는 페이지를 새로 불러와(location.assign) 이전 계정의 화면 데이터·진행 중 요청을 모두 버립니다.

type Status = 'checking' | 'anon' | 'authed'

interface AuthState {
  status: Status
  user: SessionUser | null
  check: () => Promise<void>
  login: (employeeId: string, password: string) => Promise<{ ok: true; user: SessionUser } | { ok: false; message: Bilingual }>
  logout: () => Promise<void>
}

/** 이 브라우저에 남은 사용자별 화면 데이터 지우기 (언어·테마 같은 화면 취향은 유지) */
export function clearUserData() {
  try {
    localStorage.removeItem('hrsgx.copilot')
    localStorage.removeItem('hrsgx.outage')
    const prefs = JSON.parse(localStorage.getItem('hrsgx.prefs') || '{}')
    delete prefs.currentCaseId
    localStorage.setItem('hrsgx.prefs', JSON.stringify(prefs))
    sessionStorage.clear()
  } catch {
    /* 저장소를 쓸 수 없어도 새로고침으로 메모리는 비워짐 */
  }
}

export const useAuth = create<AuthState>((set) => ({
  status: 'checking',
  user: null,

  check: async () => {
    try {
      const r = await api<{ authenticated: boolean; user: SessionUser | null }>('/auth/me/')
      set(r.authenticated && r.user ? { status: 'authed', user: r.user } : { status: 'anon', user: null })
    } catch {
      set({ status: 'anon', user: null })
    }
  },

  login: async (employeeId, password) => {
    try {
      await api('/auth/me/') // CSRF 쿠키 받기
      const r = await api<{ user: SessionUser }>('/auth/login/', { method: 'POST', json: { employee_id: employeeId, password } })
      return { ok: true, user: r.user }
    } catch (e) {
      return { ok: false, message: e instanceof ApiError ? e.text : { ko: '서버에 연결할 수 없습니다.', en: 'Cannot reach the server.' } }
    }
  },

  logout: async () => {
    try {
      await api('/auth/logout/', { method: 'POST' })
    } finally {
      clearUserData()
      set({ status: 'anon', user: null })
      window.location.assign('/login')
    }
  },
}))

// 로그인했던 세션이 서버에서 만료되면 로그인 화면으로 (돌아올 주소 기억)
if (typeof window !== 'undefined') {
  window.addEventListener(UNAUTHORIZED, () => {
    if (useAuth.getState().status !== 'authed') return
    clearUserData()
    const next = encodeURIComponent(location.pathname + location.search)
    window.location.assign(`/login?expired=1&next=${next}`)
  })
}
