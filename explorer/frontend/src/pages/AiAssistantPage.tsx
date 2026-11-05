import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { isAssistant, type AssistantPayload, type Message, type TemplateAnswer } from '../api/rag'
import ChatThread from '../components/chat/ChatThread'
import { EvidenceList } from '../components/chat/parts'
import Icon from '../components/Icon'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Notice, Tabs } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime } from '../lib/format'
import { useApp } from '../store/app'
import { useCopilot } from '../store/copilot'

// AI 엔지니어링 도우미: 대화 목록 | 채팅 | 근거 패널. 검색은 서버 로컬(확정 설정), 답변은 Claude (외부 전송 허용 시에만).
export default function AiAssistantPage() {
  const L = useL()
  const [tab, setTab] = useState<'papers' | 'case'>('papers')
  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      <div className="card px-4 pt-2">
        <Tabs tabs={[{ id: 'papers' as const, label: L('논문 근거 질문 (AI)', 'Literature Q&A (AI)') }, { id: 'case' as const, label: L('평가 케이스 질문 (템플릿 DEMO)', 'Case questions (template DEMO)') }]} value={tab} onChange={setTab} />
      </div>
      {tab === 'papers' ? <PaperChat /> : <TemplateChat />}
    </div>
  )
}

// 논문 근거 질문: 플로팅 AI 와 같은 전역 대화(useCopilot)·같은 채팅 컴포넌트를 전체 화면으로 보여 줍니다.
// 대화 목록 | 채팅 | 근거 패널(모바일·태블릿에서는 아래 서랍)
function PaperChat() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [params, setParams] = useSearchParams()
  const st = useCopilot()
  const { conversations, activeConversation: active, info, selMsg, focusEv } = st
  const [q, setQ] = useState('')
  const [showList, setShowList] = useState(false)
  const [evOpen, setEvOpen] = useState(false) // 모바일: 근거 패널을 아래에서 올라오는 서랍으로

  const { loadInfo, loadConversations, setDraft, attachSnapshot } = st // 동작 함수는 바뀌지 않는 참조
  const caseId = useCopilot((s) => s.activeCaseId)
  useEffect(() => {
    if (!info) loadInfo()
  }, [info, loadInfo])
  useEffect(() => {
    const t = setTimeout(() => loadConversations(q), 250)
    return () => clearTimeout(t)
  }, [q, caseId, loadConversations])
  // ?q= (예전 링크) → 입력칸, ?snapshot= → 스냅샷 첨부 (케이스 동기화 뒤)
  useEffect(() => {
    const qq = params.get('q')
    const sid = params.get('snapshot')
    if (caseId === null || (!qq && !sid)) return
    if (qq) setDraft(qq)
    if (sid) attachSnapshot(Number(sid))
    setParams({}, { replace: true })
  }, [params, setParams, caseId, setDraft, attachSnapshot])
  useEffect(() => {
    if (focusEv) setEvOpen(true)
  }, [focusEv])

  const msgs = active?.messages ?? []
  const selected = msgs.find((m) => m.id === selMsg && isAssistant(m)) as (Message & { payload: AssistantPayload }) | undefined
  const aiReady = info?.ai.ready

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)_400px]">
      {/* 왼쪽: 대화 목록 */}
      <aside className={`card flex flex-col p-3 lg:max-h-[calc(100vh-170px)] ${showList ? '' : 'max-lg:hidden'}`}>
        <button type="button" className="btn-primary w-full" onClick={() => { st.newConversation(); setShowList(false) }}>
          <Icon name="plus" size={15} />{L('새 대화', 'New chat')}
        </button>
        <input className="input mt-2 h-8 text-xs" placeholder={L('대화 검색', 'Search chats')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('대화 검색', 'Search chats')} />
        <ul className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${active?.id === c.id ? 'bg-accent-soft text-accent-ink' : 'hover:bg-canvas'}`}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { st.openConversation(c.id); setShowList(false) }}>
                <div className="truncate font-medium">{c.title || L('(제목 없음)', '(untitled)')}</div>
                <div className="text-[11px] text-faint">{fmtDateTime(c.updated_at, lang)} · {Math.floor(c.message_count / 2)}{L('개 질문', ' Q')}</div>
              </button>
              <button type="button" className="btn-icon h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={L('삭제', 'Delete')}
                onClick={() => window.confirm(L('이 대화를 삭제할까요?', 'Delete this conversation?')) && st.deleteConversation(c.id)}><Icon name="trash" size={14} /></button>
            </li>
          ))}
          {conversations.length === 0 && <li className="px-2 py-3 text-xs text-muted">{L('대화가 없습니다.', 'No chats yet.')}</li>}
        </ul>
      </aside>

      {/* 가운데: 채팅 (플로팅 창과 같은 컴포넌트) */}
      <section className="card flex min-h-[560px] flex-col lg:max-h-[calc(100vh-170px)]">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <button type="button" className="btn-icon lg:hidden" onClick={() => setShowList(!showList)} aria-label={L('대화 목록', 'Chats')}><Icon name="menu" /></button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{active?.title || L('새 대화', 'New chat')}</h2>
          {selected && <button type="button" className="btn-ghost px-2.5 py-1 text-xs 2xl:hidden" onClick={() => setEvOpen(true)}><Icon name="reference" size={14} />{L('근거', 'Evidence')} {selected.payload.evidence.length}</button>}
          {info && (
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className="rounded-md bg-sunken px-1.5 py-0.5">{L('공식 corpus', 'Official corpus')} {info.corpus?.documents}{L('편', ' docs')} · {info.corpus?.passages}{L('문단', ' passages')}</span>
              {info.configs && <span className="rounded-md bg-sunken px-1.5 py-0.5">{info.configs.locked.label[lang]}</span>}
              <span className={`rounded-md px-1.5 py-0.5 ${aiReady ? 'bg-good-soft text-good' : 'bg-caution-soft text-caution'}`}>
                {aiReady ? `Claude · ${info.ai.model}` : info.ai.key_configured ? L('외부 AI 전송 꺼짐', 'External AI off') : L('AI 키 없음', 'No AI key')}
              </span>
            </span>
          )}
        </header>
        <ChatThread />
      </section>

      {/* 오른쪽: 근거 패널 (2xl 미만에서는 아래 서랍) */}
      {evOpen && <div className="fixed inset-0 z-40 bg-[rgb(var(--ink)/.35)] 2xl:hidden" onClick={() => setEvOpen(false)} aria-hidden="true" />}
      <aside className={`card flex flex-col 2xl:max-h-[calc(100vh-170px)] max-2xl:fixed max-2xl:inset-x-0 max-2xl:bottom-0 max-2xl:z-50 max-2xl:max-h-[78vh] max-2xl:animate-sheet-in max-2xl:rounded-b-none max-2xl:shadow-pop lg:max-2xl:left-auto lg:max-2xl:right-4 lg:max-2xl:w-[480px] ${evOpen ? '' : 'max-2xl:hidden'}`}
        aria-label={L('근거 문단', 'Evidence')}>
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon name="reference" size={15} /></span>
          <h2 className="flex-1 text-sm font-bold">{L('근거 문단', 'Evidence')}</h2>
          {selected && <span className="text-[11px] text-muted">{selected.payload.mode.toUpperCase()} · {selected.payload.evidence.length}{L('개', '')}</span>}
          <button type="button" className="btn-icon h-7 w-7 2xl:hidden" onClick={() => setEvOpen(false)} aria-label={L('닫기', 'Close')}><Icon name="x" size={14} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {!selected ? <p className="p-2 text-sm text-muted">{L('답변을 고르면 근거 문단이 여기에 나옵니다.', 'Pick an answer to see its evidence.')}</p> : (
            <EvidenceList p={selected.payload} focus={focusEv} />
          )}
        </div>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- 평가 케이스 질문 (템플릿, AI 아님)
function TemplateChat() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: TemplateAnswer }[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => setLog([]), [caseId])
  const ask = async (text: string) => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const a = await api<TemplateAnswer>(`/cases/${caseId}/questions/`, { method: 'POST', json: { question: text } })
      setLog((l) => [...l, { q: text, a }])
      setQ('')
    } finally {
      setBusy(false)
    }
  }
  const examples = [L('출력 손실은 얼마인가요?', 'What is the output loss?'), L('공법별 회수기간은?', 'Payback by method?'), L('핀치와 어프로치는?', 'Pinch and approach?'),
    L('아직 받지 못한 필수 데이터는?', 'Which required data is missing?'), L('SMP 실적은?', 'SMP history?'), L('세정 전후 실측 결과는?', 'Before/after measurements?')]
  return (
    <div className="card mx-auto max-w-3xl p-4">
      <Notice tone="muted">{L('템플릿 DEMO 답변입니다 (AI 아님). 서버에 저장된 이 케이스의 값만 문장에 넣습니다.', 'Template DEMO answers (not AI), filled only with this case’s saved values.')}</Notice>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.map((x) => <button key={x} type="button" className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-sunken" onClick={() => ask(x)}>{x}</button>)}
      </div>
      <div className="mt-4 space-y-3">
        {log.map((x, i) => (
          <div key={i} className="space-y-1.5">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3 py-1.5 text-sm text-surface">{x.q}</div>
            <div className="rounded-2xl rounded-bl-sm border border-line bg-sunken/60 p-3 text-sm">
              <div className="mb-1"><ReliabilityBadge kind="DEMO" /> <span className="text-[11px] text-muted">{L('템플릿 답변', 'Template answer')}</span></div>
              <p className="whitespace-pre-wrap">{x.a.text}</p>
              {x.a.sources.length > 0 && <p className="mt-1.5 text-[11px] text-muted">{L('근거', 'Source')}: {x.a.sources.join(' · ')}</p>}
            </div>
          </div>
        ))}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('이 케이스에 대해 질문', 'Ask about this case')} aria-label={L('질문', 'Question')} lang={lang} />
        <button type="submit" className="btn-primary" disabled={busy}>{L('질문', 'Ask')}</button>
      </form>
    </div>
  )
}
