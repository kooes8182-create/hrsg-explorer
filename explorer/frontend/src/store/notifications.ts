import { create } from 'zustand'
import { api, onMutated } from '../api/client'
import { isNotificationList, type AppNotification } from '../api/notifications'
import { useApp } from './app'
import { useToast } from './toast'

// 알림 센터 상태. 알림의 원본은 서버 DB(notifications)이고, 여기는 현재 케이스 + 시스템 알림의 사본입니다.
// 갱신 시점: 케이스 전환 · 서버 데이터를 바꾸는 API 응답 직후 · 30초 연결 점검(기존 /api/health/) 때.
// 서버·DB 가 끊긴 동안에는 서버에 기록할 수 없으므로, 끊긴 시각을 브라우저에 기억했다가 복구되면 한 번 보냅니다.

const OUTAGE_KEY = 'hrsgx.outage'
type Outage = { kind: 'server_down' | 'db_error'; since: string }
const readOutage = (): Outage | null => {
  try {
    return JSON.parse(localStorage.getItem(OUTAGE_KEY) || 'null') as Outage | null
  } catch {
    return null
  }
}
const writeOutage = (o: Outage | null) => {
  try {
    if (o) localStorage.setItem(OUTAGE_KEY, JSON.stringify(o))
    else localStorage.removeItem(OUTAGE_KEY)
  } catch {
    /* 기억하지 못해도 화면 동작에는 지장 없음 */
  }
}

interface NotificationState {
  isOpen: boolean
  caseId: number | null
  items: AppNotification[]
  unread: number
  unresolved: number
  livePlantData: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  outage: Outage | null
  setOpen: (v: boolean) => void
  load: () => Promise<void>
  markRead: (id: number, read?: boolean) => Promise<void>
  markAllRead: () => Promise<void>
  clientEvent: (body: Record<string, unknown>) => Promise<boolean>
}

let seenMax = 0 // 이 값보다 새 알림만 토스트 (처음 불러온 알림·케이스 전환 직후 알림은 토스트하지 않음)
let primed = false
const TOAST_SEVERITY = new Set(['CRITICAL', 'WARNING'])

export const useNotifications = create<NotificationState>((set, get) => ({
  isOpen: false,
  caseId: null,
  items: [],
  unread: 0,
  unresolved: 0,
  livePlantData: false,
  status: 'idle',
  outage: readOutage(),

  setOpen: (isOpen) => set({ isOpen }),

  load: async () => {
    const caseId = useApp.getState().currentCaseId
    if (get().caseId !== caseId) {
      primed = false
      set({ caseId, items: [], unread: 0, unresolved: 0 })
    }
    if (get().status !== 'ready') set({ status: 'loading' })
    try {
      const body = await api(`/notifications/${caseId !== null ? `?case=${caseId}` : ''}`, {}, isNotificationList)
      if (useApp.getState().currentCaseId !== caseId) return
      const lang = useApp.getState().lang
      if (primed) {
        // 새로 생긴 중요한 알림만 (경고·긴급 + 시스템 복구). 정보성 알림은 토스트하지 않음.
        for (const n of body.items.filter((x) => x.id > seenMax).reverse()) {
          if (!TOAST_SEVERITY.has(n.severity) && !(n.severity === 'SUCCESS' && n.category === 'SYSTEM')) continue
          const tone = n.severity === 'CRITICAL' ? 'error' : n.severity === 'WARNING' ? 'warn' : 'ok'
          useToast.getState().push(tone, n.message[lang], { title: `${n.isDemo ? '[DEMO] ' : ''}${n.title[lang]}`, to: n.targetRoute || undefined, key: `n${n.id}` })
        }
      }
      seenMax = Math.max(seenMax, ...body.items.map((x) => x.id), 0)
      primed = true
      set({ items: body.items, unread: body.unread, unresolved: body.unresolved, livePlantData: body.live_plant_data, status: 'ready' })
    } catch {
      set({ status: 'error' }) // 마지막으로 받은 목록은 그대로 보여 줌
    }
  },

  markRead: async (id, read = true) => {
    const n = await api<AppNotification>(`/notifications/${id}/read/`, { method: 'POST', json: { read } })
    set({ items: get().items.map((x) => (x.id === id ? n : x)), unread: Math.max(0, get().unread + (read ? -1 : 1)) })
  },

  markAllRead: async () => {
    await api(`/notifications/read-all/`, { method: 'POST', json: { case: get().caseId } })
    await get().load()
  },

  clientEvent: async (body) => {
    try {
      await api(`/notifications/client-event/`, { method: 'POST', json: body })
      return true
    } catch {
      return false
    }
  },
}))

/** 앱 시작 시 한 번: 케이스·연결·저장 상태 변화와 API 응답에 알림 센터를 연결합니다. */
let started = false
export function startNotifications() {
  if (started) return
  started = true
  const st = useNotifications.getState
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(() => st().load(), 350)
  }
  onMutated(soon)

  let lastCase = useApp.getState().currentCaseId
  let lastCheck = useApp.getState().health.checkedAt
  let lastSave = useApp.getState().saveState
  let autosaveRaised = false
  useApp.subscribe((s) => {
    if (s.currentCaseId !== lastCase) {
      lastCase = s.currentCaseId
      st().load()
    }
    // 연결 점검 결과(30초마다)
    if (s.health.checkedAt !== lastCheck) {
      lastCheck = s.health.checkedAt
      const h = s.health.state
      if ((h === 'unreachable' || h === 'db_error') && !st().outage) {
        const o: Outage = { kind: h === 'unreachable' ? 'server_down' : 'db_error', since: new Date().toISOString() }
        writeOutage(o)
        useNotifications.setState({ outage: o })
        const ko = s.lang === 'ko'
        useToast.getState().push('error', ko ? '복구되면 알림 이력에 기록합니다.' : 'It will be recorded once the connection is back.',
          { title: o.kind === 'server_down' ? (ko ? '서버 연결 끊김' : 'Server unreachable') : (ko ? '데이터베이스 연결 실패' : 'Database connection failed'), key: 'outage' })
      } else if (h === 'ok') {
        const o = st().outage
        if (o) {
          st().clientEvent({ kind: o.kind, since: o.since, until: new Date().toISOString() }).then((ok) => {
            if (ok) {
              writeOutage(null)
              useNotifications.setState({ outage: null })
            }
            st().load()
          })
        } else st().load() // 30초마다 상태형 알림을 현재 값으로 맞춤 (같은 상태면 새 알림 없음)
      }
    }
    // 자동 저장 실패 → 복구
    if (s.saveState !== lastSave) {
      lastSave = s.saveState
      const caseId = s.currentCaseId
      if (s.saveState === 'failed' && caseId !== null) {
        autosaveRaised = true
        st().clientEvent({ kind: 'autosave_failed', case: caseId, where: location.pathname }).then(() => st().load())
      } else if (s.saveState === 'saved' && autosaveRaised && caseId !== null) {
        autosaveRaised = false
        st().clientEvent({ kind: 'autosave_ok', case: caseId }).then(() => st().load())
      }
    }
  })
  st().load()
}
