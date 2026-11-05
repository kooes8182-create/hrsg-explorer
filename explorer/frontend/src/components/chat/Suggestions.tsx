import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ContextPage } from '../../api/rag'
import { useL } from '../../i18n'
import { CATEGORIES, NEEDS_TEXT, SCREEN_SUGGESTIONS, SUGGESTIONS, type ScreenKey, type SuggestCategory, type Suggestion } from '../../lib/suggestions'
import { useApp } from '../../store/app'
import { useCaseData } from '../../store/caseData'
import { useCopilot } from '../../store/copilot'
import Icon from '../Icon'

// 추천 질문: 현재 화면 맞춤 질문 + 카테고리 탭(주황 밑줄) + 질문 카드. 누르면 바로 실제 AI 질문 API 로 보냅니다.

const PAGE_LABEL: Record<ScreenKey, [string, string]> = {
  notifications: ['알림', 'Alerts'],
  dashboard: ['대시보드', 'Dashboard'], calculator: ['계산기', 'Calculator'], simulation: ['시뮬레이션', 'Simulation'],
  analysis: ['심층 분석', 'Analysis'], 'before-after': ['세정 전후 비교', 'Before & after'], checklist: ['체크리스트', 'Checklist'],
}

export default function SuggestionPanel({ page }: { page: ScreenKey | null }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const { suggestCategory, setSuggestCategory, busy, pending, askSuggestion, availability, loadAvailability, activeCaseId } = useCopilot()
  const lastCalc = useCaseData((s) => s.results?.last_calculated_at)
  const inputHash = useCaseData((s) => s.inputs?.hash)
  const [blocked, setBlocked] = useState<string | null>(null) // 보낼 수 없는 화면 질문을 눌렀을 때 안내
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  // 화면 맞춤 질문을 보낼 수 있는지: 화면·케이스·계산·입력이 바뀔 때 서버 저장값으로 다시 확인
  useEffect(() => {
    if (page && page !== 'notifications') loadAvailability(page as ContextPage)
    setBlocked(null)
  }, [page, activeCaseId, lastCalc, inputHash, loadAvailability])

  const avPage: ContextPage | null = page === 'notifications' ? 'dashboard' : page
  const av = availability && availability.page === avPage && availability.caseId === activeCaseId ? availability.available : null
  // 체크리스트는 케이스마다 항상 있으므로 확인 없이 보낼 수 있음
  const ready = (sg: Suggestion) => !sg.needs || sg.needs === 'checklist' || (av !== null && !!av[sg.needs])
  const pick = (sg: Suggestion) => {
    if (busy) return
    if (!ready(sg)) {
      setBlocked(sg.id)
      return
    }
    askSuggestion(sg, lang)
  }
  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + CATEGORIES.length) % CATEGORIES.length
    setSuggestCategory(CATEGORIES[n].id)
    tabs.current[n]?.focus()
  }
  const list = SUGGESTIONS.filter((s) => s.category === suggestCategory)

  return (
    <div className="space-y-4 text-left" data-suggestions>
      {page && (
        <section aria-label={L('이 화면 맞춤 질문', 'Questions for this screen')}>
          <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">
            <Icon name="evaluation" size={13} className="text-accent" />{L('이 화면 맞춤 질문', 'For this screen')} · {PAGE_LABEL[page][lang === 'ko' ? 0 : 1]}
          </h4>
          <ul className="space-y-2">
            {SCREEN_SUGGESTIONS[page].map((sg) => (
              <li key={sg.id}>
                <QuestionButton sg={sg} lang={lang} onPick={pick} busy={busy} loading={pending?.suggestionId === sg.id}
                  unavailable={ready(sg) ? null : av === null ? 'checking' : 'missing'} screen />
                {blocked === sg.id && sg.needs && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-caution-soft px-2.5 py-2 text-[11px] text-caution" role="status">
                    <Icon name="info" size={13} className="mt-px" />{NEEDS_TEXT[sg.needs][lang === 'ko' ? 0 : 1]} {L('질문은 보내지 않았습니다.', 'The question was not sent.')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={L('추천 질문', 'Suggested questions')}>
        <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-faint">{L('추천 질문', 'Suggested questions')}</h4>
        <div role="tablist" aria-label={L('추천 질문 분류', 'Question categories')} className="-mx-1 flex overflow-x-auto border-b border-line px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c, i) => {
            const on = c.id === suggestCategory
            return (
              <button key={c.id} ref={(el) => (tabs.current[i] = el)} type="button" role="tab" id={`sg-tab-${c.id}`} aria-selected={on} aria-controls="sg-panel" tabIndex={on ? 0 : -1}
                onClick={() => setSuggestCategory(c.id as SuggestCategory)} onKeyDown={(e) => onTabKey(e, i)}
                className={`relative shrink-0 whitespace-nowrap px-3 pb-2 pt-1.5 text-[12.5px] font-semibold transition-colors ${on ? 'text-ink' : 'text-muted hover:text-ink'}`}>
                {lang === 'ko' ? c.ko : c.en}
                <span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
              </button>
            )
          })}
        </div>
        <ul id="sg-panel" role="tabpanel" aria-labelledby={`sg-tab-${suggestCategory}`} className="mt-3 space-y-2">
          {list.map((sg) => (
            <li key={sg.id}>
              <QuestionButton sg={sg} lang={lang} onPick={pick} busy={busy} loading={pending?.suggestionId === sg.id}
                unavailable={ready(sg) ? null : 'checking'} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function QuestionButton({ sg, lang, onPick, busy, loading, unavailable }: {
  sg: Suggestion; lang: 'ko' | 'en'; onPick: (sg: Suggestion) => void; busy: boolean; loading: boolean; unavailable: 'checking' | 'missing' | null; screen?: boolean
}) {
  const L = useL()
  const missing = unavailable === 'missing'
  return (
    <button type="button" onClick={() => onPick(sg)} disabled={busy && !loading} aria-busy={loading} aria-disabled={missing || undefined} data-suggestion={sg.id}
      className={`group flex w-full items-center gap-2.5 rounded-xl border bg-surface px-3.5 py-3 text-left text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${
        missing ? 'border-dashed border-line text-muted' : 'border-line text-ink hover:border-[rgb(var(--peach))] hover:bg-accent-soft'}`}>
      <span className="min-w-0 flex-1">
        {lang === 'ko' ? sg.ko : sg.en}
        {sg.context && (
          <span className={`mt-1 block text-[10.5px] font-semibold ${missing ? 'text-caution' : 'text-accent-ink'}`}>
            {missing ? L('필요한 데이터 없음 — 누르면 안내', 'Data not available — tap for details')
              : unavailable === 'checking' ? L('화면 데이터 확인 중…', 'Checking screen data…')
                : sg.context === 'checklist' ? L('체크리스트 현황(서버 저장값)을 함께 보냄', 'Sends checklist status (server values)')
                  : L('이 화면의 서버 계산값(DEMO)을 함께 보냄', 'Sends this screen’s server values (DEMO)')}
          </span>
        )}
      </span>
      {loading ? <Icon name="refresh" size={15} className="shrink-0 animate-spin text-accent" />
        : <Icon name="chevronRight" size={15} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />}
    </button>
  )
}
