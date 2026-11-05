import { useEffect, useMemo, useState } from 'react'
import type { AppNotification } from '../api/notifications'
import { Skeleton } from '../components/feedback'
import Icon from '../components/Icon'
import { CATEGORY, relTime, SeverityBadge, useNotificationActions } from '../components/notifications/NotificationCenter'
import { useL } from '../i18n'
import { fmtDateTime } from '../lib/format'
import { useApp } from '../store/app'
import { useNotifications } from '../store/notifications'
import { canAccess } from '../app/access'
import { useAuth } from '../store/auth'
import { BottomSheet } from './ui'

// 알림 화면 (모바일 하단 '알림' 탭 · PC 에서는 /notifications 주소). 알림 센터와 같은 서버 알림을 씁니다.
// 읽음 ≠ 해결: 읽어도 미해결 상태는 그대로이며, 조건이 풀리면 서버가 해결 처리합니다.

type Tab = 'all' | 'severe' | 'DATA' | 'CALC' | 'SYSTEM'
type State = 'open' | 'all' | 'resolved'

export default function MobileAlerts() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const { items, unread, status, load, markAllRead, livePlantData } = useNotifications()
  const [tab, setTab] = useState<Tab>('all')
  const [state, setState] = useState<State>('all')
  const [sel, setSel] = useState<AppNotification | null>(null)
  useEffect(() => {
    load()
  }, [load])
  // 상세를 연 알림이 서버에서 바뀌면(읽음 등) 최신 값으로
  useEffect(() => {
    if (sel) setSel(items.find((x) => x.id === sel.id) ?? sel)
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => items.filter((n) => {
    const resolved = n.kind === 'STATE' && !!n.resolvedAt
    if (state === 'open' && (n.kind !== 'STATE' || resolved)) return false
    if (state === 'resolved' && !resolved) return false
    if (state === 'all' && resolved) return false
    if (tab === 'severe') return n.severity === 'CRITICAL' || n.severity === 'WARNING'
    if (tab === 'all') return true
    return n.category === tab || (tab === 'CALC' && n.category === 'OPERATION' && n.severity === 'INFO')
  }), [items, tab, state])

  const tabs: [Tab, string][] = [['all', L('전체', 'All')], ['severe', L('위험/주의', 'Critical/Warning')], ['DATA', L('데이터', 'Data')], ['CALC', L('분석', 'Analysis')], ['SYSTEM', L('시스템', 'System')]]
  return (
    <div className="mx-auto max-w-2xl space-y-3" data-alerts-page>
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">{L('알림', 'Alerts')}</h1>
          <p className="text-xs text-muted">{L(`읽지 않음 ${unread}개`, `${unread} unread`)}{!livePlantData && ` · ${L('앱 이벤트·서버 계산 기준 (실시간 설비 데이터 아님)', 'From app events & server results (not live plant data)')}`}</p>
        </div>
        <button type="button" className="btn-ghost min-h-[40px] px-3 text-xs" disabled={unread === 0} onClick={() => markAllRead().catch(() => null)}><Icon name="check" size={14} />{L('모두 읽음', 'Read all')}</button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5" role="tablist" aria-label={L('알림 분류', 'Categories')}>
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`min-h-[40px] whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold ${tab === id ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-muted'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-1 rounded-xl bg-sunken p-1 text-xs font-semibold">
        {([['all', L('현재', 'Current')], ['open', L('미해결만', 'Unresolved')], ['resolved', L('해결 이력', 'Resolved')]] as [State, string][]).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={state === id} onClick={() => setState(id)} className={`min-h-[36px] flex-1 rounded-lg ${state === id ? 'bg-surface text-accent-ink shadow-card' : 'text-muted'}`}>{label}</button>
        ))}
      </div>

      {status === 'error' && <p className="rounded-xl border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution">{L('알림을 새로 불러오지 못했습니다. 마지막으로 받은 목록입니다.', 'Could not refresh — showing the last list.')}</p>}
      {status === 'loading' && items.length === 0 ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : shown.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-line bg-surface px-4 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-good-soft text-good"><Icon name="check" size={22} /></span>
            <p className="mt-3 text-sm font-semibold text-ink">{state === 'resolved' ? L('해결된 알림 이력이 없습니다', 'No resolved alerts') : L('표시할 알림이 없습니다', 'No alerts')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => setSel(n)} data-alert={n.eventKey}
                  className={`relative flex w-full gap-3 rounded-2xl border p-4 text-left shadow-card active:bg-accent-soft ${n.readAt ? 'border-line bg-surface' : 'border-[rgb(var(--peach))] bg-accent-soft/50'}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-slate"><Icon name={CATEGORY[n.category].icon} size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge s={n.severity} />
                      {n.isDemo ? <span className="rounded border border-dashed border-accent/60 px-1 text-[10px] font-bold text-accent-ink">DEMO</span> : <span className="rounded bg-sunken px-1 text-[10px] font-bold text-muted">{L('비 DEMO', 'Not DEMO')}</span>}
                      {n.kind === 'STATE' && <span className={`text-[10.5px] font-semibold ${n.resolvedAt ? 'text-good' : 'text-muted'}`}>{n.resolvedAt ? `✓ ${L('해결됨', 'Resolved')}` : L('미해결', 'Open')}</span>}
                      <span className="ml-auto text-[11px] text-faint">{relTime(n.createdAt, lang)}</span>
                    </span>
                    <span className="mt-1 block text-[14px] font-semibold leading-snug text-ink">{n.title[lang]}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{n.message[lang]}</span>
                  </span>
                  {!n.readAt && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent" aria-label={L('읽지 않음', 'Unread')} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      <AlertSheet n={sel} onClose={() => setSel(null)} />
    </div>
  )
}

function AlertSheet({ n, onClose }: { n: AppNotification | null; onClose: () => void }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const markRead = useNotifications((s) => s.markRead)
  const { go, askAi } = useNotificationActions()
  useEffect(() => {
    if (n && !n.readAt) markRead(n.id).catch(() => null) // 상세를 열면 읽음 (해결은 아님)
  }, [n?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!n) return null
  return (
    <BottomSheet open onClose={onClose} label={n.title[lang]} title={<span className="flex flex-wrap items-center gap-1.5"><SeverityBadge s={n.severity} />{n.isDemo && <span className="rounded border border-dashed border-accent/60 px-1 text-[10px] font-bold text-accent-ink">DEMO</span>}</span>}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost min-h-[48px] justify-center" onClick={() => { askAi(n); onClose() }}><Icon name="sparkles" size={16} className="text-accent" />{L('AI에게 설명 요청', 'Ask AI')}</button>
          <button type="button" className="btn-primary min-h-[48px] justify-center" disabled={!n.targetRoute || !canAccess(useAuth.getState().user?.role, n.targetRoute)} onClick={() => { go(n); onClose() }}>{L('관련 화면', 'Open')}<Icon name="chevronRight" size={16} /></button>
        </div>
      }>
      <div className="space-y-4" data-alert-detail>
        <div>
          <h3 className="text-[17px] font-bold leading-snug text-ink">{n.title[lang]}</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-slate">{n.message[lang]}</p>
        </div>
        {(n.data?.length ?? 0) > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">{L('관련 수치 · 기준값', 'Values & reference')}</h4>
            <dl className="divide-y divide-line rounded-xl border border-line">
              {n.data!.map((d) => <div key={d.label.ko} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[13px]"><dt className="text-muted">{d.label[lang]}</dt><dd className="break-words text-right font-semibold tabular-nums text-ink">{d.value}</dd></div>)}
            </dl>
          </section>
        )}
        {n.condition && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">{L('발생 조건', 'Condition')}</h4>
            <p className="rounded-xl bg-canvas px-3 py-2.5 text-[13px] text-slate">{n.condition[lang]}</p>
          </section>
        )}
        {(n.checks?.length ?? 0) > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">{L('추가 확인 사항', 'Things to check')}</h4>
            <ul className="space-y-1.5">{n.checks!.map((c) => <li key={c.ko} className="flex items-start gap-2 text-[13px] text-slate"><Icon name="check" size={14} className="mt-0.5 shrink-0 text-accent" />{c[lang]}</li>)}</ul>
          </section>
        )}
        <dl className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-xl bg-canvas p-2.5"><dt className="text-faint">{L('출처', 'Source')}</dt><dd className="font-semibold text-ink">{n.source}</dd></div>
          <div className="rounded-xl bg-canvas p-2.5"><dt className="text-faint">{L('데이터', 'Data')}</dt><dd className="font-semibold text-ink">{n.isDemo ? L('DEMO 값 (실제 설비 아님)', 'DEMO values (not a plant)') : L('DEMO 아님', 'Not DEMO')}</dd></div>
          <div className="rounded-xl bg-canvas p-2.5"><dt className="text-faint">{L('발생', 'Created')}</dt><dd className="font-semibold text-ink">{fmtDateTime(n.createdAt, lang)}</dd></div>
          <div className="rounded-xl bg-canvas p-2.5"><dt className="text-faint">{L('해결', 'Resolved')}</dt><dd className="font-semibold text-ink">{n.kind !== 'STATE' ? L('해당 없음 (사건 기록)', 'N/A (event)') : n.resolvedAt ? fmtDateTime(n.resolvedAt, lang) : L('미해결', 'Open')}</dd></div>
        </dl>
        <button type="button" className="min-h-[44px] w-full text-[13px] font-semibold text-muted" onClick={() => markRead(n.id, !n.readAt).catch(() => null)}>
          {n.readAt ? L('읽지 않음으로 표시', 'Mark unread') : L('읽음으로 표시', 'Mark read')}
        </button>
      </div>
    </BottomSheet>
  )
}
