import { create } from 'zustand'
import { api, ApiError } from '../api/client'
import type { SnapshotSummary } from '../api/engine'
import type { ContextPage, Conversation, Message, PageContext, RagInfo, SearchMode } from '../api/rag'
import type { Bilingual } from '../api/types'
import type { SuggestCategory, Suggestion } from '../lib/suggestions'

// Floating AI Assistant(코파일럿) 전역 상태. 플로팅 창과 /ai-assistant 화면이 같은 대화를 함께 씁니다.
// 대화의 원본은 서버 DB(케이스별 Conversation)이고, 여기는 지금 열린 대화의 사본입니다.
// localStorage 에는 창 모드와 케이스별 마지막 대화 ID 만 기억합니다.

export type ChatMode = 'float' | 'panel'

const KEY = 'hrsgx.copilot'
type Saved = { chatMode?: ChatMode; lastByCase?: Record<string, number>; suggestCategory?: SuggestCategory }
const read = (): Saved => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Saved
  } catch {
    return {}
  }
}
const write = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...s }))
  } catch {
    /* 저장 못 해도 동작에는 지장 없음 */
  }
}

const errText = (e: unknown): Bilingual => (e instanceof ApiError ? e.text : { ko: String(e), en: String(e) })

interface CopilotState {
  isChatOpen: boolean
  chatMode: ChatMode
  view: 'chat' | 'history'
  activeCaseId: number | null
  activeConversation: Conversation | null
  conversations: Conversation[]
  draft: string
  searchMode: SearchMode
  withUploads: boolean
  attachedSnapshot: SnapshotSummary | null
  attachedContext: PageContext | null
  busy: boolean
  /** 서버 응답 전 '보내는 중' 질문 (추천 질문 클릭 즉시 표시) */
  pending: { text: string; suggestionId: string | null } | null
  suggestCategory: SuggestCategory
  /** 모바일 AI 탭을 열기 직전 화면 (화면 맞춤 추천 질문용) */
  origin: string | null
  setOrigin: (path: string | null) => void
  /** 대화 중 추천 질문 목록 펼침 여부 (대화가 없으면 항상 보임) */
  suggestOpen: boolean
  availability: { page: ContextPage; caseId: number; available: Record<string, boolean | number> } | null
  error: Bilingual | null
  info: RagInfo | null
  selMsg: number | null
  focusEv: number | null

  open: () => void
  close: () => void
  toggle: () => void
  setMode: (m: ChatMode) => void
  setView: (v: 'chat' | 'history') => void
  setDraft: (q: string) => void
  setSearchMode: (m: SearchMode) => void
  setWithUploads: (v: boolean) => void
  select: (msgId: number | null, ev?: number | null) => void
  loadInfo: () => Promise<void>
  syncCase: (caseId: number | null) => Promise<void>
  loadConversations: (q?: string) => Promise<void>
  openConversation: (id: number) => Promise<void>
  newConversation: () => void
  deleteConversation: (id: number) => Promise<void>
  attachContext: (page: ContextPage, question?: string, notificationId?: number) => Promise<boolean>
  attachSnapshot: (id: number, question?: string) => Promise<boolean>
  detach: (what: 'context' | 'snapshot') => void
  replaceMessage: (m: Message) => void
  ask: () => Promise<boolean>
  askSuggestion: (sg: Suggestion, lang: 'ko' | 'en') => Promise<boolean>
  send: (text: string, opts?: { context?: ContextPage; notification?: number; snapshot?: number; suggestionId?: string }) => Promise<boolean>
  setSuggestCategory: (c: SuggestCategory) => void
  setSuggestOpen: (v: boolean) => void
  loadAvailability: (page: ContextPage) => Promise<void>
}

export const useCopilot = create<CopilotState>((set, get) => ({
  isChatOpen: false,
  chatMode: read().chatMode ?? 'float',
  view: 'chat',
  activeCaseId: null,
  activeConversation: null,
  conversations: [],
  draft: '',
  searchMode: 'hybrid',
  withUploads: false,
  attachedSnapshot: null,
  attachedContext: null,
  busy: false,
  pending: null,
  suggestCategory: read().suggestCategory ?? 'thermo',
  origin: null,
  setOrigin: (origin) => set({ origin }),
  suggestOpen: false,
  availability: null,
  error: null,
  info: null,
  selMsg: null,
  focusEv: null,

  open: () => {
    set({ isChatOpen: true })
    if (!get().info) get().loadInfo()
  },
  close: () => set({ isChatOpen: false }),
  toggle: () => (get().isChatOpen ? get().close() : get().open()),
  setMode: (chatMode) => {
    set({ chatMode })
    write({ chatMode })
  },
  setView: (view) => set({ view }),
  setDraft: (draft) => set({ draft }),
  setSearchMode: (searchMode) => set({ searchMode }),
  setWithUploads: (withUploads) => set({ withUploads }),
  select: (selMsg, ev = null) => set({ selMsg, focusEv: ev }),

  loadInfo: async () => {
    try {
      set({ info: await api<RagInfo>('/rag/info/') })
    } catch {
      set({ info: null })
    }
  },

  /** 케이스가 바뀌면 그 케이스의 마지막 대화(없으면 가장 최근 대화)로 전환합니다. */
  syncCase: async (caseId) => {
    if (caseId === get().activeCaseId) return
    set({ activeCaseId: caseId, activeConversation: null, conversations: [], selMsg: null, attachedSnapshot: null, attachedContext: null, error: null })
    if (caseId === null) return
    await get().loadConversations()
    if (get().activeCaseId !== caseId) return
    const remembered = read().lastByCase?.[caseId]
    const list = get().conversations
    const target = list.find((c) => c.id === remembered) ?? list[0]
    if (target) await get().openConversation(target.id)
  },

  loadConversations: async (q = '') => {
    const caseId = get().activeCaseId
    if (caseId === null) return
    try {
      const list = await api<Conversation[]>(`/cases/${caseId}/conversations/${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      if (get().activeCaseId === caseId) set({ conversations: list })
    } catch {
      /* 목록을 못 불러와도 현재 대화는 유지 */
    }
  },

  openConversation: async (id) => {
    try {
      const c = await api<Conversation>(`/conversations/${id}/`)
      if (c.case !== get().activeCaseId) return
      const last = [...(c.messages ?? [])].reverse().find((m) => m.role === 'assistant')
      set({ activeConversation: c, selMsg: last?.id ?? null, focusEv: null, view: 'chat', error: null })
      write({ lastByCase: { ...read().lastByCase, [c.case]: c.id } })
    } catch (e) {
      set({ error: errText(e) })
    }
  },

  newConversation: () => set({ activeConversation: null, selMsg: null, focusEv: null, view: 'chat', error: null, suggestOpen: false }),

  deleteConversation: async (id) => {
    await api(`/conversations/${id}/`, { method: 'DELETE' })
    if (get().activeConversation?.id === id) set({ activeConversation: null, selMsg: null })
    await get().loadConversations()
  },

  /** 'AI에게 질문하기': 화면 이름만 서버에 보내고, 서버가 DB 값으로 만든 맥락을 첨부합니다. */
  attachContext: async (page, question, notificationId) => {
    const caseId = get().activeCaseId
    if (caseId === null) return false
    get().open()
    try {
      const ctx = await api<PageContext>(`/cases/${caseId}/ai-context/?page=${page}${notificationId ? `&notification=${notificationId}` : ''}`)
      set({ attachedContext: ctx, view: 'chat', error: null, ...(question && !get().draft.trim() ? { draft: question } : {}) })
      return true
    } catch (e) {
      set({ error: errText(e) })
      return false
    }
  },

  attachSnapshot: async (id, question) => {
    const caseId = get().activeCaseId
    if (caseId === null) return false
    try {
      const s = await api<SnapshotSummary>(`/cases/${caseId}/snapshots/${id}/`)
      set({ attachedSnapshot: s, view: 'chat', error: null, ...(question && !get().draft.trim() ? { draft: question } : {}) })
      return true
    } catch (e) {
      set({ error: errText(e) })
      return false
    }
  },

  detach: (what) => set(what === 'context' ? { attachedContext: null } : { attachedSnapshot: null }),

  replaceMessage: (m) => {
    const c = get().activeConversation
    if (c) set({ activeConversation: { ...c, messages: c.messages?.map((x) => (x.id === m.id ? m : x)) } })
  },

  /** 입력칸 질문 전송. 첨부(맥락·스냅샷)는 이번 질문에만 쓰고 비웁니다. */
  ask: async () => {
    const s = get()
    const ok = await get().send(s.draft, { context: s.attachedContext?.page, notification: s.attachedContext?.notification, snapshot: s.attachedSnapshot?.id })
    if (ok) set({ draft: '', attachedSnapshot: null, attachedContext: null })
    return ok
  },

  /** 추천 질문 전송: 입력칸·첨부와 상관없이 그 질문(+ 정해진 화면 데이터)만 바로 보냅니다. */
  askSuggestion: (sg, lang) => get().send(lang === 'ko' ? sg.ko : sg.en, { context: sg.context ?? undefined, suggestionId: sg.id }),

  /** 공통 전송. busy 를 같은 순간(동기)에 켜므로 빠른 연속 클릭·중복 요청은 두 번째부터 무시됩니다.
   *  서버 응답 전에는 질문을 '보내는 중' 말풍선(pending)으로 먼저 보여 줍니다. */
  send: async (text, opts = {}) => {
    const s = get()
    const question = text.trim()
    const caseId = s.activeCaseId
    if (!question || s.busy || caseId === null) return false
    set({ busy: true, error: null, pending: { text: question, suggestionId: opts.suggestionId ?? null }, suggestOpen: false, view: 'chat' })
    try {
      let conv = s.activeConversation
      if (!conv) conv = await api<Conversation>(`/cases/${caseId}/conversations/`, { method: 'POST', json: {} })
      const r = await api<{ user: Message; assistant: Message }>(`/conversations/${conv.id}/messages/`, {
        method: 'POST',
        json: { question, mode: s.searchMode, snapshot_id: opts.snapshot, context: opts.context, notification_id: opts.notification, include_uploads: s.withUploads },
      })
      if (get().activeCaseId !== caseId) return false // 응답 사이에 케이스가 바뀜
      const updated = { ...conv, messages: [...(conv.messages ?? []), r.user, r.assistant], title: conv.title || r.user.text.slice(0, 60) }
      set({ activeConversation: updated, selMsg: r.assistant.id, focusEv: null })
      write({ lastByCase: { ...read().lastByCase, [caseId]: conv.id } })
      get().loadConversations()
      return true
    } catch (e) {
      set({ error: errText(e) })
      return false
    } finally {
      set({ busy: false, pending: null })
    }
  },

  setSuggestCategory: (suggestCategory) => {
    set({ suggestCategory })
    write({ suggestCategory })
  },
  setSuggestOpen: (suggestOpen) => set({ suggestOpen }),

  /** 화면 맞춤 질문을 보낼 수 있는지 (서버 저장값 기준). 실패하면 null → 화면 질문은 보내지 않음 */
  loadAvailability: async (page) => {
    const caseId = get().activeCaseId
    if (caseId === null) return
    try {
      const c = await api<PageContext>(`/cases/${caseId}/ai-context/?page=${page}`)
      if (get().activeCaseId === caseId) set({ availability: { page, caseId, available: c.available ?? {} } })
    } catch {
      set({ availability: null })
    }
  },
}))
