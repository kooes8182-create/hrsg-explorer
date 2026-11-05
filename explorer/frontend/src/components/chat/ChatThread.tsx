import { useEffect, useRef, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { isAssistant, type AssistantPayload, type ContextPage, type Message, type SearchMode } from '../../api/rag'
import { useL } from '../../i18n'
import { fmtDateTime } from '../../lib/format'
import { useApp } from '../../store/app'
import { useCopilot } from '../../store/copilot'
import Icon from '../Icon'
import ReliabilityBadge from '../ReliabilityBadge'
import { Notice } from '../ui'
import { AnswerBubble, UserBubble } from './parts'
import SuggestionPanel from './Suggestions'
import type { ScreenKey } from '../../lib/suggestions'

// 채팅 본문(메시지 + 첨부 + 입력창). 플로팅 창(compact)과 /ai-assistant 화면이 같은 컴포넌트·같은 전역 대화를 씁니다.

const PAGE_OF: Record<string, ContextPage> = {
  '/dashboard': 'dashboard', '/calculator': 'calculator', '/simulation': 'simulation',
  '/analysis': 'analysis', '/before-after': 'before-after', '/checklist': 'checklist',
}
export const contextPageOf = (path: string): ContextPage | null => PAGE_OF[path] ?? null

export default function ChatThread({ compact = false, page: pageOverride }: { compact?: boolean; page?: ScreenKey | null }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const path = useLocation().pathname
  // 모바일 AI 탭은 '열기 직전 화면'을 넘겨받아 그 화면에 맞춘 질문을 보여 줌
  const page: ScreenKey | null = pageOverride !== undefined ? pageOverride : contextPageOf(path)
  const st = useCopilot()
  const { activeConversation, busy, error, info, attachedContext, attachedSnapshot, draft, selMsg, pending, suggestOpen, setSuggestOpen } = st
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const msgs = activeConversation?.messages ?? []

  // 새 메시지·응답 대기 표시가 생기면 맨 아래로 (페이지 전체가 아니라 채팅 영역만 스크롤)
  useEffect(() => {
    const el = scroller.current
    if (el && (msgs.length > 0 || pending)) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) // 처음 화면(추천 질문)은 위에서부터
  }, [msgs.length, busy, pending])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    await st.ask()
    input.current?.focus()
  }
  const aiReady = info?.ai.ready

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {info && !aiReady && (
        <div className={compact ? 'px-3 pt-3' : 'border-b border-line px-4 py-2'}>
          <Notice tone="muted">
            {info.ai.key_configured
              ? L('외부 AI 전송이 꺼져 있어 근거 문단만 보여 줍니다.', 'External AI is off — evidence only.')
              : L('ANTHROPIC_API_KEY 가 없어 근거 문단만 보여 줍니다.', 'No ANTHROPIC_API_KEY — evidence only.')}{' '}
            {L('필요하면 관리자에게 외부 AI 전송 설정을 요청하세요.', 'Ask an administrator to enable external AI if needed.')}
          </Notice>
        </div>
      )}

      <div ref={scroller} className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain ${compact ? 'px-3 py-4' : 'px-4 py-4'}`} aria-live="polite">
        {/* 처음 화면: 환영 문구 + 추천 질문 (대화가 시작되면 접어서 입력창 위 '추천 질문 보기'로) */}
        {msgs.length === 0 && !pending && (
          <div className={`mx-auto ${compact ? 'max-w-md py-1' : 'max-w-xl py-4'}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white shadow-card"><Icon name="sparkles" size={20} /></span>
              <div>
                <h3 className="font-bold text-ink">{L('논문 근거로 답하는 HRSG 도우미', 'HRSG assistant grounded in literature')}</h3>
                <p className="mt-0.5 text-[12.5px] text-muted">{L('공식 평가셋 corpus(47편)에서 근거 문단을 찾아 그 문단만으로 답합니다. 아래 질문을 누르면 바로 물어봅니다.', 'Finds passages in the official corpus (47 docs) and answers only from them. Tap a question below to ask it.')}</p>
              </div>
            </div>
            <div className="mt-4"><SuggestionPanel page={page} /></div>
          </div>
        )}
        {msgs.map((m) => m.role === 'user' ? <UserBubble key={m.id} m={m} /> : isAssistant(m) ? (
          <AnswerBubble key={m.id} m={m as Message & { payload: AssistantPayload }} selected={selMsg === m.id} inlineRefs={compact}
            onSelect={() => st.select(m.id)} onCite={(n) => st.select(m.id, n)} onUpdate={st.replaceMessage} />
        ) : null)}
        {pending && (
          <div className="flex justify-end" data-pending>
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-accent to-[rgb(var(--accent-ink))] px-4 py-2.5 text-sm text-white opacity-80 shadow-card">
              <p className="whitespace-pre-wrap">{pending.text}</p>
              <div className="mt-1 text-[10px] opacity-80">{L('보내는 중…', 'Sending…')}</div>
            </div>
          </div>
        )}
        {busy && (
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 py-3 text-sm text-muted" role="status">
            <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
            {info?.vector.status === 'not_loaded' ? L('의미 검색 모델(BGE-M3)을 처음 불러오는 중입니다 (1분 이내)…', 'Loading the BGE-M3 model for the first time (under a minute)…') : L('근거 검색·답변 생성 중…', 'Searching evidence and answering…')}
          </div>
        )}
      </div>

      {/* 대화 중: 추천 질문은 접어 두고 필요할 때 다시 열기 */}
      {(msgs.length > 0 || pending) && (
        <div className="shrink-0 border-t border-line bg-canvas">
          <button type="button" className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold text-accent-ink hover:bg-accent-soft" aria-expanded={suggestOpen} onClick={() => setSuggestOpen(!suggestOpen)}>
            <Icon name="sparkles" size={14} className="text-accent" />{suggestOpen ? L('추천 질문 접기', 'Hide suggestions') : L('추천 질문 보기', 'Show suggestions')}
            <Icon name="chevronDown" size={14} className={`ml-auto text-faint transition-transform ${suggestOpen ? 'rotate-180' : ''}`} />
          </button>
          {suggestOpen && <div className={`overflow-y-auto overscroll-contain px-3.5 pb-3 ${compact ? 'max-h-[42vh] sm:max-h-[280px]' : 'max-h-[320px]'}`}><SuggestionPanel page={page} /></div>}
        </div>
      )}

      <form onSubmit={submit} className={`border-t border-line bg-surface ${compact ? 'p-3' : 'p-3'}`}>
        {attachedContext && (
          <Attachment icon="evaluation" title={`${attachedContext.notification ? L('알림 + 화면 데이터 첨부', 'Notification + screen data') : L('화면 데이터 첨부', 'Screen data attached')} · ${attachedContext.label[lang]}`}
            note={attachedContext.stale.length ? L(`재평가가 필요한 결과(${attachedContext.stale.join(', ')})는 빼고 보냅니다.`, `Stale results (${attachedContext.stale.join(', ')}) are left out.`) : L('서버에 저장된 값만 보냅니다 (화면의 숫자를 그대로 보내지 않음).', 'Only server-saved values are sent (not numbers from the page).')}
            lines={attachedContext.lines} onRemove={() => st.detach('context')} />
        )}
        {attachedSnapshot && (
          <Attachment icon="calculator" title={`${L('계산 스냅샷 첨부', 'Calculation snapshot attached')} #${attachedSnapshot.id}${attachedSnapshot.label ? ` · ${attachedSnapshot.label}` : ''}`}
            note={`${L('초과 배압', 'Excess BP')} ${attachedSnapshot.summary.excessBP ?? '—'} mmH₂O · ${L('출력 손실', 'Loss')} ${attachedSnapshot.summary.lossMW ?? '—'} MW · ${L('세정 필요도', 'Index')} ${attachedSnapshot.summary.cleaningScore ?? '—'} · ${fmtDateTime(attachedSnapshot.created_at, lang)}`}
            onRemove={() => st.detach('snapshot')} />
        )}
        {error && <div className="mb-2"><Notice tone="danger">{error[lang]}</Notice></div>}
        <div className="flex items-end gap-2">
          <textarea ref={input} className={`input max-h-40 flex-1 resize-none ${compact ? 'min-h-[44px] py-2.5' : 'min-h-[52px] resize-y'}`} rows={compact ? 1 : 2} maxLength={1000}
            placeholder={L('HRSG 관련 질문을 입력하세요', 'Ask about HRSG')} value={draft} onChange={(e) => st.setDraft(e.target.value)}
            aria-label={compact ? L('AI에게 질문', 'Ask AI') : L('질문', 'Question')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
          <button type="submit" className={`btn-primary shrink-0 ${compact ? 'h-11 w-11 justify-center rounded-xl p-0' : 'h-10'}`} disabled={busy || !draft.trim()} aria-label={compact ? L('전송', 'Send') : undefined}>
            <Icon name={busy ? 'refresh' : 'chevronRight'} size={16} className={busy ? 'animate-spin' : ''} />{!compact && L('질문', 'Ask')}
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <select className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px]" value={st.searchMode} onChange={(e) => st.setSearchMode(e.target.value as SearchMode)} aria-label={L('검색 방식', 'Search mode')}>
            <option value="hybrid">Hybrid RRF</option><option value="bm25">BM25</option><option value="dense">Dense (BGE-M3)</option>
          </select>
          <label className="flex items-center gap-1"><input type="checkbox" checked={st.withUploads} onChange={(e) => st.setWithUploads(e.target.checked)} />{L('업로드 문헌 포함', 'Include uploads')}</label>
          <span className="text-faint">{L('Enter 전송 · Shift+Enter 줄바꿈 · 전화번호·이메일·식별정보는 전송 전에 가림', 'Enter send · Shift+Enter newline · phones, e-mails, identifiers masked')}</span>
        </div>
      </form>
    </div>
  )
}

function Attachment({ icon, title, note, lines, onRemove }: { icon: 'evaluation' | 'calculator'; title: string; note: string; lines?: string[]; onRemove: () => void }) {
  const L = useL()
  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-[rgb(var(--peach))] bg-accent-soft p-2.5 text-xs">
      <Icon name={icon} size={15} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 font-semibold text-ink">{title} <ReliabilityBadge kind="DEMO" /></div>
        <div className="mt-0.5 text-muted">{note}</div>
        {lines && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] font-semibold text-accent-ink">{L(`AI 에 함께 보낼 값 ${lines.length}줄 보기`, `Show ${lines.length} lines sent to AI`)}</summary>
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-[11px] text-muted">{lines.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        )}
      </div>
      <button type="button" className="btn-icon h-6 w-6" aria-label={L('첨부 해제', 'Detach')} onClick={onRemove}><Icon name="x" size={13} /></button>
    </div>
  )
}

/** 각 화면의 'AI에게 질문하기': 플로팅 창을 열고, 서버가 만든 이 화면의 데이터 맥락을 첨부하고, 추천 질문을 입력칸에 넣습니다. */
export function AskAiButton({ page, question, className = 'btn-ghost' }: { page: ContextPage; question: [string, string]; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const attach = useCopilot((s) => s.attachContext)
  return (
    <button type="button" className={className} onClick={() => attach(page, question[lang === 'ko' ? 0 : 1])}>
      <Icon name="sparkles" size={15} className="text-accent" />{L('AI에게 질문하기', 'Ask AI')}
    </button>
  )
}
