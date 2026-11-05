import { useEffect, useState } from 'react'
import type { ContextPage } from '../api/rag'
import ChatThread, { contextPageOf } from '../components/chat/ChatThread'
import Icon from '../components/Icon'
import { useL } from '../i18n'
import { fmtDateTime } from '../lib/format'
import { useKeyboardInset } from '../lib/media'
import type { ScreenKey } from '../lib/suggestions'
import { useApp } from '../store/app'
import { useCopilot } from '../store/copilot'
import { BottomSheet } from './ui'

// 모바일 AI 탭: PC 의 Floating AI·AI 도우미와 같은 대화(케이스별, 서버 저장)·같은 채팅 컴포넌트를 전체 화면으로.
// 근거 문단은 답변 아래 접기(Accordion)로, 논문 카드를 누르면 원문 문단이 펼쳐집니다.

const LABEL: Record<ScreenKey, [string, string]> = {
  dashboard: ['홈', 'Home'], calculator: ['계산기', 'Calculator'], simulation: ['시뮬레이션', 'Simulation'], analysis: ['심층 분석', 'Analysis'],
  'before-after': ['세정 전후 비교', 'Before & after'], checklist: ['현장 점검', 'Field check'], notifications: ['알림', 'Alerts'],
}

export default function MobileAI() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const origin = useCopilot((s) => s.origin)
  const info = useCopilot((s) => s.info)
  const loadInfo = useCopilot((s) => s.loadInfo)
  const active = useCopilot((s) => s.activeConversation)
  const newConversation = useCopilot((s) => s.newConversation)
  const attachContext = useCopilot((s) => s.attachContext)
  const kb = useKeyboardInset()
  const [hist, setHist] = useState(false)
  useEffect(() => {
    if (!info) loadInfo()
  }, [info, loadInfo])
  const screen: ScreenKey | null = origin === '/notifications' ? 'notifications' : origin ? contextPageOf(origin) : null
  const ctxPage: ContextPage | null = screen && screen !== 'notifications' ? screen : null

  return (
    // 머리(56) + 아래 메뉴(64+안전영역)를 뺀 높이. 키보드가 열리면 아래 메뉴는 숨고 입력창을 키보드 위로 올림.
    <div className="-mx-4 -mt-4 flex flex-col bg-surface" data-mobile-ai
      style={{ height: kb > 0 ? `calc(100dvh - 56px - env(safe-area-inset-top) - ${kb}px)` : 'calc(100dvh - 56px - env(safe-area-inset-top) - 64px - env(safe-area-inset-bottom))' }}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white"><Icon name="sparkles" size={18} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-bold text-ink">HRSG AI Assistant</h1>
          <p className="truncate text-[11px] text-muted">{active?.title || L('새 대화', 'New chat')} · {info?.ai.ready ? 'Claude' : L('근거 검색 전용', 'Evidence only')}</p>
        </div>
        <button type="button" className="btn-icon h-11 w-11" onClick={() => setHist(true)} aria-label={L('대화 기록', 'History')}><Icon name="history" size={18} /></button>
        <button type="button" className="btn-icon h-11 w-11" onClick={newConversation} aria-label={L('새 대화', 'New chat')}><Icon name="plus" size={18} /></button>
      </div>
      {screen && !active?.messages?.length && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-[rgb(var(--peach))] bg-accent-soft px-3 py-2.5 text-[12.5px]" data-origin-card>
          <Icon name="evaluation" size={15} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-slate">{L('열었던 화면', 'From')}: <b className="text-ink">{LABEL[screen][lang === 'ko' ? 0 : 1]}</b> · {L('아래에 이 화면 맞춤 질문', 'questions for this screen below')}</span>
          {ctxPage && <button type="button" className="min-h-[36px] shrink-0 font-semibold text-accent-ink" onClick={() => attachContext(ctxPage)}>{L('데이터 첨부', 'Attach data')}</button>}
        </div>
      )}
      <ChatThread compact page={screen} />
      <HistorySheet open={hist} onClose={() => setHist(false)} lang={lang} />
    </div>
  )
}

function HistorySheet({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: 'ko' | 'en' }) {
  const L = useL()
  const { conversations, activeConversation, loadConversations, openConversation, deleteConversation } = useCopilot()
  useEffect(() => {
    if (open) loadConversations()
  }, [open, loadConversations])
  return (
    <BottomSheet open={open} onClose={onClose} title={L('대화 기록', 'Chat history')}>
      <p className="mb-2 text-[11px] text-faint">{L('현재 평가 케이스의 대화 (PC 와 같은 서버 기록).', 'Chats of the current case (same server records as desktop).')}</p>
      <ul className="space-y-2">
        {conversations.map((c) => (
          <li key={c.id} className={`flex items-center gap-1 rounded-xl border px-3 ${activeConversation?.id === c.id ? 'border-accent bg-accent-soft' : 'border-line'}`}>
            <button type="button" className="min-h-[56px] min-w-0 flex-1 py-2 text-left" onClick={() => { openConversation(c.id); onClose() }}>
              <span className="block truncate text-[14px] font-semibold text-ink">{c.title || L('(제목 없음)', '(untitled)')}</span>
              <span className="text-[11px] text-faint">{fmtDateTime(c.updated_at, lang)} · {Math.floor(c.message_count / 2)}{L('개 질문', ' Q')}</span>
            </button>
            <button type="button" className="btn-icon h-11 w-11" aria-label={L('삭제', 'Delete')} onClick={() => window.confirm(L('이 대화를 삭제할까요?', 'Delete this conversation?')) && deleteConversation(c.id)}><Icon name="trash" size={15} /></button>
          </li>
        ))}
        {conversations.length === 0 && <li className="py-6 text-center text-sm text-muted">{L('대화가 없습니다.', 'No chats yet.')}</li>}
      </ul>
    </BottomSheet>
  )
}
