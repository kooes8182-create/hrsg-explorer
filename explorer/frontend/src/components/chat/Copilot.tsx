import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useL } from '../../i18n'
import { fmtDateTime } from '../../lib/format'
import { useApp } from '../../store/app'
import { useCopilot } from '../../store/copilot'
import Icon from '../Icon'
import ChatThread from './ChatThread'

// Floating AI Assistant: 모든 화면 오른쪽 아래 버튼 → 플로팅 창(420×600) ↔ 오른쪽 사이드 패널(520px).
// Layout 최상위에 한 번만 두어 화면을 옮겨도 다시 만들어지지 않고, 대화는 전역 상태(useCopilot)에 남습니다.
// /ai-assistant 화면은 같은 대화를 전체 화면으로 보여 주므로, 그 화면에서는 플로팅 버튼을 숨깁니다.

export const PANEL_W = 520

export default function Copilot({ hideFab = false }: { hideFab?: boolean }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const health = useApp((s) => s.health)
  const path = useLocation().pathname
  const { isChatOpen, chatMode, view, info, activeConversation, syncCase, close, toggle, setMode, setView, newConversation, loadInfo } = useCopilot()
  const fullPage = path === '/ai-assistant'

  useEffect(() => {
    syncCase(caseId)
  }, [caseId, syncCase])
  useEffect(() => {
    if (isChatOpen && !info) loadInfo()
  }, [isChatOpen, info, loadInfo])
  // Esc 로 닫기 (입력 중인 글은 그대로 남음)
  useEffect(() => {
    if (!isChatOpen || fullPage) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isChatOpen, fullPage, close])

  if (fullPage) return null
  const panel = chatMode === 'panel'
  const searchReady = health.data?.search.status === 'ready'
  const aiOn = info?.ai.ready

  return (
    <>
      {/* 플로팅 버튼: 패널 모드로 열려 있으면 숨김 */}
      {!hideFab && !(isChatOpen && panel) && (
        <div className="fixed bottom-5 right-5 z-[45] flex items-center gap-2 sm:bottom-6 sm:right-6" data-copilot-fab>
          {!isChatOpen && (
            <span className="pointer-events-none hidden rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-card md:block">Ask HRSG AI</span>
          )}
          <button type="button" onClick={toggle} aria-expanded={isChatOpen} aria-controls="copilot"
            aria-label={isChatOpen ? L('AI 도우미 닫기', 'Close AI assistant') : L('AI 도우미 열기', 'Open AI assistant')}
            className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-soft to-accent text-white shadow-[0_10px_28px_-8px_rgb(234_88_12/.7)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-95 ${isChatOpen ? 'max-sm:hidden' : ''}`}>
            <Icon name={isChatOpen ? 'x' : 'sparkles'} size={24} />
          </button>
        </div>
      )}

      {isChatOpen && panel && <div className="fixed inset-0 z-[44] bg-[rgb(var(--ink)/.3)] min-[1600px]:hidden" onClick={close} aria-hidden="true" />}

      {isChatOpen && (
        <section id="copilot" data-copilot={chatMode} role="dialog" aria-label="HRSG AI Assistant"
          className={panel
            ? 'fixed inset-y-0 right-0 z-[46] flex w-full flex-col border-l border-line bg-surface shadow-pop animate-drawer-in sm:w-[520px]'
            : 'fixed inset-0 z-[46] flex flex-col bg-surface animate-sheet-in sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(600px,calc(100dvh-120px))] sm:w-[420px] sm:animate-toast-in sm:rounded-[20px] sm:border sm:border-line sm:shadow-pop'}
          style={panel ? { height: '100dvh' } : undefined}>
          {/* 머리: 항상 보임 */}
          <header className={`flex shrink-0 items-center gap-2.5 border-b border-line px-3.5 py-3 ${panel ? '' : 'sm:rounded-t-[20px]'}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white"><Icon name="sparkles" size={18} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[14px] font-bold text-ink">HRSG AI Assistant</h2>
              <p className="flex items-center gap-1.5 truncate text-[11px] text-muted">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${searchReady ? 'bg-good' : 'bg-caution'}`} aria-hidden="true" />
                {searchReady ? L('검색 연결됨', 'Search ready') : L('검색 확인 중', 'Search checking')} · {aiOn ? `Claude ${L('답변', 'answers')}` : L('근거 검색 전용', 'Evidence only')}
              </p>
            </div>
            <button type="button" className={`btn-icon h-8 w-8 ${view === 'history' ? 'bg-accent-soft text-accent-ink' : ''}`} onClick={() => setView(view === 'history' ? 'chat' : 'history')}
              aria-pressed={view === 'history'} aria-label={L('대화 기록', 'History')} title={L('대화 기록', 'History')}><Icon name="history" size={16} /></button>
            <button type="button" className="btn-icon h-8 w-8" onClick={newConversation} aria-label={L('새 대화', 'New chat')} title={L('새 대화', 'New chat')}><Icon name="plus" size={16} /></button>
            <button type="button" className="btn-icon hidden h-8 w-8 sm:inline-flex" onClick={() => setMode(panel ? 'float' : 'panel')}
              aria-label={panel ? L('작은 창으로', 'Collapse to window') : L('사이드 패널로 확장', 'Expand to side panel')} title={panel ? L('작은 창으로', 'Collapse') : L('사이드 패널로 확장', 'Expand')}>
              <Icon name={panel ? 'minimize' : 'maximize'} size={16} />
            </button>
            <button type="button" className="btn-icon h-8 w-8" onClick={close} aria-label={L('닫기', 'Close')} title={L('닫기 (Esc)', 'Close (Esc)')}><Icon name="x" size={16} /></button>
          </header>
          {activeConversation && view === 'chat' && (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-canvas px-3.5 py-1.5 text-[11px] text-muted">
              <span className="truncate font-semibold text-slate">{activeConversation.title || L('(제목 없음)', '(untitled)')}</span>
              <Link to="/ai-assistant" className="ml-auto shrink-0 font-semibold text-accent-ink hover:underline" onClick={close}>{L('전체 화면', 'Full view')} →</Link>
            </div>
          )}
          {view === 'history' ? <History lang={lang} /> : <ChatThread compact />}
        </section>
      )}
    </>
  )
}

function History({ lang }: { lang: 'ko' | 'en' }) {
  const L = useL()
  const { conversations, activeConversation, loadConversations, openConversation, deleteConversation, newConversation } = useCopilot()
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => loadConversations(q), 250)
    return () => clearTimeout(t)
  }, [q, loadConversations])
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="flex gap-2">
        <input className="input h-9 flex-1 text-sm" placeholder={L('대화 검색', 'Search chats')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('대화 검색', 'Search chats')} />
        <button type="button" className="btn-primary h-9 px-3 text-xs" onClick={newConversation}><Icon name="plus" size={14} />{L('새 대화', 'New')}</button>
      </div>
      <p className="mt-2 text-[11px] text-faint">{L('현재 평가 케이스의 대화만 보입니다 (서버 DB 저장).', 'Only chats of the current case (saved in the server DB).')}</p>
      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {conversations.map((c) => (
          <li key={c.id} className={`group flex items-center gap-1 rounded-xl px-2.5 py-2 text-sm ${activeConversation?.id === c.id ? 'bg-accent-soft text-accent-ink' : 'hover:bg-canvas'}`}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openConversation(c.id)}>
              <div className="truncate font-medium">{c.title || L('(제목 없음)', '(untitled)')}</div>
              <div className="text-[11px] text-faint">{fmtDateTime(c.updated_at, lang)} · {Math.floor(c.message_count / 2)}{L('개 질문', ' Q')}</div>
            </button>
            <button type="button" className="btn-icon h-7 w-7 opacity-60 group-hover:opacity-100" aria-label={L('삭제', 'Delete')}
              onClick={() => window.confirm(L('이 대화를 삭제할까요?', 'Delete this conversation?')) && deleteConversation(c.id)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
        {conversations.length === 0 && <li className="px-2 py-3 text-xs text-muted">{L('대화가 없습니다.', 'No chats yet.')}</li>}
      </ul>
    </div>
  )
}
