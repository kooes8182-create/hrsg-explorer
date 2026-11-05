import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { AppNotification, NotifCategory, NotifSeverity } from '../../api/notifications'
import type { ContextPage } from '../../api/rag'
import { useL } from '../../i18n'
import { fmtDateTime } from '../../lib/format'
import { useApp } from '../../store/app'
import { useCopilot } from '../../store/copilot'
import { useNotifications } from '../../store/notifications'
import { canAccess } from '../../app/access'
import { useAuth } from '../../store/auth'
import Icon, { type IconName } from '../Icon'

// 통합 알림 센터: 헤더 종 버튼 + 패널. 알림은 서버가 저장값·API 사건에서 만든 것만 보여 줍니다 (임의 생성 없음).
// 심각도는 색 + 아이콘 + 글자로, 데이터 신뢰성(DEMO)은 따로 표시합니다. 읽음 ≠ 해결.

export const SEVERITY: Record<NotifSeverity, { icon: IconName; ko: string; en: string; cls: string; rank: number }> = {
  CRITICAL: { icon: 'alert', ko: '긴급', en: 'Critical', cls: 'bg-danger-soft text-danger', rank: 0 },
  WARNING: { icon: 'alert', ko: '주의', en: 'Warning', cls: 'bg-caution-soft text-caution', rank: 1 },
  INFO: { icon: 'info', ko: '정보', en: 'Info', cls: 'bg-info-soft text-info', rank: 2 },
  SUCCESS: { icon: 'check', ko: '정상', en: 'Success', cls: 'bg-good-soft text-good', rank: 3 },
}
export const CATEGORY: Record<NotifCategory, { icon: IconName; ko: string; en: string }> = {
  OPERATION: { icon: 'flame', ko: '운전 상태', en: 'Operation' },
  DATA: { icon: 'checklist', ko: '데이터 관리', en: 'Data' },
  CALC: { icon: 'calculator', ko: '계산·분석', en: 'Calculation' },
  SYSTEM: { icon: 'server', ko: '시스템·AI', en: 'System & AI' },
}
const PAGES: ContextPage[] = ['dashboard', 'calculator', 'simulation', 'analysis', 'before-after', 'checklist']
const QUESTION: Record<NotifCategory, [string, string]> = {
  OPERATION: ['이 알림이 발생한 이유를 설명해 줘.', 'Explain why this notification occurred.'],
  DATA: ['어떤 추가 데이터가 필요한지 알려줘.', 'Which additional data is needed?'],
  CALC: ['이 계산 결과를 다시 검토하려면 무엇을 확인해야 해?', 'What should I check to review this calculation again?'],
  SYSTEM: ['이 시스템 알림은 무엇을 의미하고 어떻게 조치해야 해?', 'What does this system notification mean and what should I do?'],
}

export function relTime(iso: string, lang: 'ko' | 'en') {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return lang === 'ko' ? '방금' : 'just now'
  if (m < 60) return lang === 'ko' ? `${m}분 전` : `${m} min ago`
  if (m < 24 * 60) return lang === 'ko' ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 60)} h ago`
  return fmtDateTime(iso, lang)
}

/** 관련 화면으로 이동하고, 입력칸(in-…)이면 그 칸으로 스크롤합니다. 이동하면 읽음 처리. */
export function useNotificationActions() {
  const navigate = useNavigate()
  const lang = useApp((s) => s.lang)
  const markRead = useNotifications((s) => s.markRead)
  const go = (n: AppNotification) => {
    if (!n.readAt) markRead(n.id).catch(() => null)
    if (!n.targetRoute || !canAccess(useAuth.getState().user?.role, n.targetRoute)) return
    navigate(n.targetRoute)
    if (n.targetItemId.startsWith('in-')) {
      setTimeout(() => {
        const el = document.getElementById(n.targetItemId)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(el as HTMLInputElement | null)?.focus()
      }, 700)
    }
  }
  /** 'AI에게 설명 요청': 기존 Floating AI 를 열고, 서버가 만든 알림 내용 + 관련 화면 데이터를 첨부하고, 질문을 제안 */
  const askAi = (n: AppNotification) => {
    const path = n.targetRoute.split('?')[0].replace(/^\//, '') as ContextPage
    const page = PAGES.includes(path) ? path : 'dashboard'
    useCopilot.getState().setDraft('')
    useCopilot.getState().attachContext(page, QUESTION[n.category][lang === 'ko' ? 0 : 1], n.id)
    if (!n.readAt) markRead(n.id).catch(() => null)
  }
  return { go, askAi }
}

export function SeverityBadge({ s }: { s: NotifSeverity }) {
  const L = useL()
  const m = SEVERITY[s]
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${m.cls}`}><Icon name={m.icon} size={11} />{L(m.ko, m.en)}</span>
}

export function NotificationRow({ n, compact = false, onDone }: { n: AppNotification; compact?: boolean; onDone?: () => void }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [open, setOpen] = useState(false)
  const { go, askAi } = useNotificationActions()
  const markRead = useNotifications((s) => s.markRead)
  const cat = CATEGORY[n.category]
  const resolved = n.kind === 'STATE' && !!n.resolvedAt
  return (
    <li className={`relative rounded-xl border px-3 py-2.5 transition-colors ${n.readAt ? 'border-line bg-surface' : 'border-[rgb(var(--peach))] bg-accent-soft/40'} ${resolved ? 'opacity-75' : ''}`} data-notification={n.eventKey}>
      {!n.readAt && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent" aria-label={L('읽지 않음', 'Unread')} />}
      <div className="flex gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-slate" title={L(cat.ko, cat.en)}><Icon name={cat.icon} size={15} /></span>
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge s={n.severity} />
            {n.isDemo && <span className="rounded-md border border-dashed border-accent/60 px-1 text-[10px] font-bold text-accent-ink" title={L('DEMO 값 기반 — 실제 설비 경보 아님', 'Based on DEMO values — not a real plant alarm')}>DEMO</span>}
            {n.kind === 'STATE' && <span className={`text-[10.5px] font-semibold ${resolved ? 'text-good' : 'text-muted'}`}>{resolved ? `✓ ${L('해결됨', 'Resolved')}` : L('미해결', 'Open')}</span>}
            <span className="ml-auto text-[10.5px] text-faint" title={fmtDateTime(n.createdAt, lang)}>{relTime(n.createdAt, lang)}</span>
          </div>
          <button type="button" className="mt-1 block text-left text-[13px] font-semibold leading-snug text-ink hover:text-accent-ink" onClick={() => { setOpen(!open); if (!n.readAt) markRead(n.id).catch(() => null) }} aria-expanded={open}>
            {n.title[lang]}
          </button>
          <p className={`mt-0.5 text-xs text-muted ${open ? '' : 'line-clamp-2'}`}>{n.message[lang]}</p>
          {open && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-canvas px-2.5 py-2 text-[11px]">
              <dt className="text-faint">{L('분류', 'Category')}</dt><dd className="text-slate">{L(cat.ko, cat.en)}</dd>
              <dt className="text-faint">{L('출처', 'Source')}</dt><dd className="text-slate">{n.source}{n.isDemo ? ` · ${L('DEMO 값 (실제 설비 아님)', 'DEMO values (not a real plant)')}` : ''}</dd>
              <dt className="text-faint">{L('발생', 'Created')}</dt><dd className="text-slate">{fmtDateTime(n.createdAt, lang)}</dd>
              {n.kind === 'STATE' && <><dt className="text-faint">{L('해결', 'Resolved')}</dt><dd className="text-slate">{n.resolvedAt ? fmtDateTime(n.resolvedAt, lang) : L('아직 해결되지 않음 (읽음과 별개)', 'Not resolved yet (separate from read)')}</dd></>}
            </dl>
          )}
          {!compact && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {n.targetRoute && canAccess(useAuth.getState().user?.role, n.targetRoute) && <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => { go(n); onDone?.() }}>{L('관련 화면', 'Open')} →</button>}
              <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => { askAi(n); onDone?.() }}><Icon name="sparkles" size={12} className="text-accent" />{L('AI에게 설명 요청', 'Ask AI')}</button>
              <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => setOpen(!open)}>{open ? L('접기', 'Less') : L('자세히', 'Details')}</button>
              <button type="button" className="ml-auto text-[11px] font-semibold text-muted hover:text-ink" onClick={() => markRead(n.id, !n.readAt).catch(() => null)}>
                {n.readAt ? L('읽지 않음으로', 'Mark unread') : L('읽음', 'Mark read')}
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

type View = 'all' | 'unread' | 'resolved'

export default function NotificationCenter() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const { isOpen, setOpen, items, unread, status, outage, livePlantData, load, markAllRead } = useNotifications()
  const [view, setView] = useState<View>('all')
  const [cat, setCat] = useState<NotifCategory | ''>('')
  const [sev, setSev] = useState<NotifSeverity | ''>('')
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)

  // 바깥 클릭·Esc 로 닫기
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, setOpen])
  useEffect(() => {
    if (isOpen) load()
  }, [isOpen, load])

  const shown = useMemo(() => items.filter((n) => {
    const resolved = n.kind === 'STATE' && !!n.resolvedAt
    if (view === 'resolved' ? !resolved : resolved) return false
    if (view === 'unread' && n.readAt) return false
    return (!cat || n.category === cat) && (!sev || n.severity === sev)
  }), [items, view, cat, sev])

  return (
    <div ref={root} className="relative">
      <button type="button" className={`btn-icon relative ${isOpen ? 'bg-accent-soft text-accent-ink' : ''}`} onClick={() => setOpen(!isOpen)} aria-expanded={isOpen} aria-haspopup="dialog"
        aria-label={L(`알림 ${unread}개 읽지 않음`, `${unread} unread notifications`)} title={L('알림 센터', 'Notifications')} data-bell>
        <Icon name="bell" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white ring-2 ring-surface" data-unread>{unread > 99 ? '99+' : unread}</span>}
      </button>

      {/* 패널은 문서 맨 위(body)에 그립니다 — 헤더의 blur 효과 안에 갇히지 않게 (모바일 전체 화면) */}
      {isOpen && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-[rgb(var(--ink)/.3)] sm:hidden" aria-hidden="true" />
          <section ref={panel} role="dialog" aria-label={L('알림 센터', 'Notification center')} id="notification-center"
            className="fixed inset-0 z-50 flex flex-col bg-surface animate-sheet-in sm:inset-auto sm:right-4 sm:top-[64px] sm:max-h-[min(680px,calc(100dvh-90px))] sm:w-[420px] sm:animate-toast-in sm:rounded-[18px] sm:border sm:border-line sm:shadow-pop lg:right-8">
            <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 pb-3 pt-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name="bell" size={17} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold text-ink">{L('알림 센터', 'Notifications')}</h2>
                <p className="text-[11px] text-muted">{L(`읽지 않음 ${unread}개`, `${unread} unread`)}{!livePlantData && ` · ${L('앱 이벤트·서버 계산 기준 (실시간 설비 데이터 미연동)', 'From app events & server results (no live plant data)')}`}</p>
              </div>
              <button type="button" className="btn-ghost px-2 py-1 text-[11px]" disabled={unread === 0} onClick={() => markAllRead().catch(() => null)}><Icon name="check" size={13} />{L('모두 읽음', 'Read all')}</button>
              <button type="button" className="btn-icon h-8 w-8" onClick={() => setOpen(false)} aria-label={L('닫기', 'Close')}><Icon name="x" size={16} /></button>
            </header>

            <div className="shrink-0 space-y-2 border-b border-line px-4 py-2.5">
              <div className="flex gap-1 rounded-xl bg-sunken p-1 text-xs font-semibold" role="tablist">
                {([['all', L('전체', 'All')], ['unread', L('읽지 않음', 'Unread')], ['resolved', L('해결 이력', 'Resolved')]] as [View, string][]).map(([v, label]) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                    className={`flex-1 rounded-lg px-2 py-1.5 transition-all ${view === v ? 'bg-surface text-accent-ink shadow-card' : 'text-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['', 'OPERATION', 'DATA', 'CALC', 'SYSTEM'] as const).map((c) => (
                  <button key={c || 'all'} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${cat === c ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:border-[rgb(var(--peach))]'}`}>
                    {c ? L(CATEGORY[c].ko, CATEGORY[c].en) : L('전체 분류', 'All')}
                  </button>
                ))}
                <select className="ml-auto rounded-md border border-line bg-surface px-1.5 py-1 text-[11px]" value={sev} onChange={(e) => setSev(e.target.value as NotifSeverity | '')} aria-label={L('심각도', 'Severity')}>
                  <option value="">{L('모든 심각도', 'All severities')}</option>
                  {(Object.keys(SEVERITY) as NotifSeverity[]).map((s) => <option key={s} value={s}>{L(SEVERITY[s].ko, SEVERITY[s].en)}</option>)}
                </select>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              {outage && (
                <div className="mb-2 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger" role="alert">
                  <Icon name="alert" size={15} />
                  <span><b>{outage.kind === 'server_down' ? L('서버 연결 끊김', 'Server unreachable') : L('데이터베이스 연결 실패', 'Database connection failed')}</b> · {relTime(outage.since, lang)}<br />
                    {L('연결되면 알림 이력에 기록합니다 (지금은 서버에 쓸 수 없음).', 'Will be recorded once connected (cannot write to the server now).')}</span>
                </div>
              )}
              {status === 'error' && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-muted">
                  <Icon name="alert" size={14} className="text-caution" />{L('알림을 새로 불러오지 못했습니다. 마지막으로 받은 목록입니다.', 'Could not refresh — showing the last list.')}
                  <button type="button" className="ml-auto font-semibold text-accent-ink hover:underline" onClick={load}>{L('다시 시도', 'Retry')}</button>
                </div>
              )}
              {status === 'loading' && items.length === 0 ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-sunken" />)}</div>
              ) : shown.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-10 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-good-soft text-good"><Icon name="check" size={22} /></span>
                  <p className="mt-3 text-sm font-semibold text-ink">{view === 'resolved' ? L('해결된 알림 이력이 없습니다', 'No resolved notifications') : view === 'unread' ? L('읽지 않은 알림이 없습니다', 'No unread notifications') : L('표시할 알림이 없습니다', 'No notifications')}</p>
                  <p className="mt-1 text-xs text-muted">{L('필터를 바꾸거나, 계산·체크리스트 작업 후 다시 확인하세요.', 'Change filters, or check again after calculations or checklist work.')}</p>
                </div>
              ) : (
                <ul className="space-y-2">{shown.map((n) => <NotificationRow key={n.id} n={n} onDone={() => setOpen(false)} />)}</ul>
              )}
            </div>
          </section>
        </>,
        document.body,
      )}
    </div>
  )
}
