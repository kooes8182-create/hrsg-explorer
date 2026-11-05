import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { isOverview, type Overview, type OverviewKpi, type Point } from '../api/engine'
import LineChart from '../components/charts/LineChart'
import { Skeleton } from '../components/feedback'
import Icon from '../components/Icon'
import { CATEGORY, relTime, SeverityBadge, SEVERITY, useNotificationActions } from '../components/notifications/NotificationCenter'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum, fmtWon, unitLabel, useDisplay, unitDigits } from '../lib/format'
import { useApp } from '../store/app'
import { useCaseData } from '../store/caseData'
import { useCopilot } from '../store/copilot'
import { useNotifications } from '../store/notifications'
import { AsOf, BottomSheet, MCard, MoreLink, MTitle, StaleNotice, StateChip } from './ui'

// 모바일 홈: 5~10초 안에 '지금 상태 · 핵심 수치 · 확인할 일'을 보도록 위에서부터 중요도 순.
// 서버 집계(/overview/)와 알림 센터 값만 표시합니다. 계산하지 않으며, 값이 없으면 만들어 넣지 않습니다.

export default function MobileHome() {
  const L = useL()
  const caseId = useApp((s) => s.currentCaseId)
  const lastCalc = useCaseData((s) => s.results?.last_calculated_at)
  const inputHash = useCaseData((s) => s.inputs?.hash)
  const [o, setO] = useState<Overview | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (caseId === null) return
    try {
      const body = await api(`/cases/${caseId}/overview/`, {}, isOverview)
      if (body.case.id !== caseId) return
      setO(body)
      setFetchedAt(new Date())
      setFailed(false)
    } catch {
      setFailed(true) // 이미 받은 값은 지우지 않고 '오래된 값' 안내와 함께 보여 줌
    }
  }, [caseId])
  useEffect(() => {
    load()
  }, [load, lastCalc, inputHash])
  // 연결이 돌아오면 다시 읽기
  const health = useApp((s) => s.health.state)
  useEffect(() => {
    if (health === 'ok' && failed) load()
  }, [health, failed, load])

  if (!o || o.case.id !== caseId) {
    return failed ? (
      <MCard className="text-center"><p className="text-sm text-muted">{L('홈 정보를 불러오지 못했습니다.', 'Could not load the home view.')}</p>
        <button type="button" className="btn-primary mt-3 min-h-[44px]" onClick={load}>{L('다시 시도', 'Retry')}</button></MCard>
    ) : (
      <div className="space-y-3" aria-busy="true"><Skeleton className="h-48 rounded-2xl" /><div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-40 rounded-2xl" /></div>
    )
  }
  return (
    <div className="space-y-3">
      {failed && <StaleNotice at={fetchedAt} />}
      <StatusCard o={o} />
      <KpiGrid o={o} />
      <Attention />
      <TrendMini o={o} />
      <CleaningSummary o={o} />
      <QuickActions />
    </div>
  )
}

// ---------------------------------------------------------------- 운전 상태 요약
function StatusCard({ o }: { o: Overview }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const inputsAt = useCaseData((s) => s.inputs?.updated_at)
  const demo = o.mode === 'DEMO'
  const scen = { NORMAL: L('정상 운전', 'Normal operation'), ALARM: L('오염 진행', 'Fouling building up'), TRIP: L('세정 필요', 'Cleaning needed'), CUSTOM: L('직접 입력', 'Custom') }[o.scenario]
  const above = o.panel.referenceBand?.position === 'ABOVE'
  return (
    <MCard className={o.status.code === 'TRIP' ? 'border-danger/30' : o.status.code === 'ALARM' ? 'border-caution/40' : ''} as="section">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold text-muted">{L('HRSG 운전 현황', 'HRSG operating status')}</h2>
        {demo ? <ReliabilityBadge kind="DEMO" /> : <span className="rounded-md bg-info-soft px-1.5 py-0.5 text-[10px] font-bold text-info">{L('사용자 입력', 'User input')}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-home-status>
        <StateChip code={o.status.code} large />
        {demo && <span className="text-xs font-semibold text-muted">{L('가상 운전 상태 (실측 아님)', 'Virtual state (not measured)')}</span>}
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-ink">
        {above ? L('현재 배압이 공개 참고 세정 기준보다 높습니다 (판정 아님).', 'Back pressure is above the public cleaning reference (not a judgment).') : o.status.reason[lang]}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 text-[12px]">
        <div><dt className="text-faint">{L('현재 시나리오', 'Scenario')}</dt><dd className="font-semibold text-ink">{demo ? scen : L('사용자 입력', 'User input')}</dd></div>
        <div><dt className="text-faint">{L('데이터 기준', 'Data as of')}</dt><dd className="font-semibold text-ink">{inputsAt ? fmtDateTime(inputsAt, lang) : '—'}</dd></div>
        <div className="col-span-2"><dt className="text-faint">{L('마지막 계산', 'Last calculation')}</dt><dd className="font-semibold text-ink">{o.lastEvaluatedAt ? fmtDateTime(o.lastEvaluatedAt, lang) : L('계산 전', 'Not yet')}</dd></div>
      </dl>
      <Link to="/simulation" className="btn-ghost mt-3 min-h-[44px] w-full justify-center">{L('상세 상태 확인', 'View details')}<Icon name="chevronRight" size={15} /></Link>
    </MCard>
  )
}

// ---------------------------------------------------------------- 핵심 KPI 4개 (+ 전체 지표)
function KpiGrid({ o }: { o: Overview }) {
  const L = useL()
  const [all, setAll] = useState(false)
  const k = (key: OverviewKpi['key']) => o.kpis.find((x) => x.key === key)
  const four = [k('backPressure'), k('stackTemp'), k('lossMW'), k('readiness')].filter(Boolean) as OverviewKpi[]
  return (
    <section aria-label={L('핵심 지표', 'Key metrics')}>
      <div className="grid grid-cols-2 gap-3">{four.map((x) => <KpiCard key={x.key} k={x} />)}</div>
      <button type="button" className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1 text-[13px] font-semibold text-accent-ink" onClick={() => setAll(true)}>{L('전체 지표 보기', 'All metrics')}<Icon name="chevronRight" size={14} /></button>
      <BottomSheet open={all} onClose={() => setAll(false)} title={L('전체 지표', 'All metrics')}>
        <ul className="space-y-2">{o.kpis.map((x) => <li key={x.key}><KpiCard k={x} wide /></li>)}</ul>
      </BottomSheet>
    </section>
  )
}

function KpiCard({ k, wide = false }: { k: OverviewKpi; wide?: boolean }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const display = useDisplay()
  const stale = k.rel === 'REEVALUATION_REQUIRED'
  const raw = stale ? k.previous : k.value
  let text = '—', unit = ''
  if (Array.isArray(raw)) {
    text = `${fmtNum(raw[0], lang, 2)}~${fmtNum(raw[1], lang, 2)}`; unit = k.unit
  } else if (typeof raw === 'number') {
    if (k.unit === '원') text = fmtWon(raw, lang).short
    else {
      const d = display(raw, k.unit)
      text = fmtNum(d.value, lang, k.key === 'lossMW' ? 3 : d.unit !== k.unit ? unitDigits(d.unit, 1) : 1)
      unit = unitLabel(d.unit)
    }
  }
  const up = k.delta !== null && k.delta > 0
  return (
    <div className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${wide ? 'flex items-center gap-3' : ''}`} data-mkpi={k.key}>
      <div className={wide ? 'min-w-0 flex-1' : ''}>
        <div className="flex items-start justify-between gap-1">
          <span className="text-[12px] font-semibold leading-snug text-muted">{k.label[lang]}</span>
          {!wide && k.rel && <span className="shrink-0 scale-90 origin-top-right"><ReliabilityBadge kind={k.rel} /></span>}
        </div>
        {raw === null || raw === undefined ? <p className="mt-2 text-[12px] leading-snug text-muted">{k.reason?.[lang] ?? L('값 없음', 'No value')}</p> : (
          <div className={`mt-1.5 flex flex-wrap items-baseline gap-x-1 ${stale ? 'opacity-40' : ''}`}>
            <span className="text-[26px] font-bold leading-tight tracking-tight text-ink tabular-nums">{text}</span>
            {unit && <span className="text-[13px] font-semibold text-muted">{unit}</span>}
          </div>
        )}
        {stale && <p className="mt-1 text-[11px] font-semibold text-caution">{L('재평가 필요', 'Re-evaluate')}</p>}
        {k.delta !== null && !stale && raw !== null && (
          <p className={`mt-1 text-[11px] font-semibold ${up ? 'text-accent-ink' : 'text-muted'}`}>
            {up ? '▲' : k.delta < 0 ? '▼' : '='} {fmtNum(Math.abs(display(k.delta, k.unit).value ?? k.delta), lang, 1)}{k.changeRate !== null && ` (${k.changeRate > 0 ? '+' : ''}${fmtNum(k.changeRate, lang, 1)}%)`} <span className="font-normal text-faint">{L('기준 대비', 'vs base')}</span>
          </p>
        )}
      </div>
      {wide && k.rel && <ReliabilityBadge kind={k.rel} />}
    </div>
  )
}

// ---------------------------------------------------------------- 현재 확인할 항목 (미해결 알림 최대 3)
function Attention() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const items = useNotifications((s) => s.items)
  const status = useNotifications((s) => s.status)
  const { go } = useNotificationActions()
  const open = items.filter((n) => n.kind === 'STATE' && !n.resolvedAt)
    .sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || b.createdAt.localeCompare(a.createdAt))
  return (
    <MCard>
      <MTitle icon="alert" action={<MoreLink to="/notifications">{L(`전체 ${open.length}`, `All ${open.length}`)}</MoreLink>}>{L('현재 확인할 항목', 'Check now')}</MTitle>
      {status !== 'ready' && items.length === 0 ? <Skeleton className="h-16 rounded-xl" />
        : open.length === 0 ? <p className="flex items-center gap-2 rounded-xl bg-good-soft px-3 py-3 text-[13px] font-semibold text-good"><Icon name="check" size={15} />{L('해결되지 않은 항목이 없습니다.', 'Nothing unresolved.')}</p>
          : (
            <ul className="space-y-2">
              {open.slice(0, 3).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => go(n)} className="flex min-h-[56px] w-full items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left active:bg-accent-soft" data-attention={n.eventKey}>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5"><SeverityBadge s={n.severity} />{n.isDemo && <span className="rounded border border-dashed border-accent/60 px-1 text-[10px] font-bold text-accent-ink">DEMO</span>}<span className="text-[10.5px] text-faint">{L(CATEGORY[n.category].ko, CATEGORY[n.category].en)} · {relTime(n.createdAt, lang)}</span></span>
                      <span className="mt-1 block text-[13.5px] font-semibold leading-snug text-ink">{n.title[lang]}</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="mt-2 shrink-0 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          )}
    </MCard>
  )
}

// ---------------------------------------------------------------- 성능 추이 (서버 값만, 축·범례 최소)
type Metric = 'backPressure' | 'stackTempC' | 'lossMW'
function TrendMini({ o }: { o: Overview }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [m, setM] = useState<Metric>('backPressure')
  const c = o.comparison
  const virtual: Point[] = c?.virtual[m] ?? []
  const measured: Point[] = c?.measured[m] ?? []
  const unit = { backPressure: 'mmH₂O', stackTempC: '°C', lossMW: 'MW' }[m]
  return (
    <MCard>
      <MTitle icon="evaluation" action={<MoreLink to="/before-after">{L('상세 보기', 'Details')}</MoreLink>}>{L('성능 추이', 'Performance trend')}</MTitle>
      <div className="mb-2 flex gap-1 rounded-xl bg-sunken p-1 text-xs font-semibold" role="tablist">
        {([['backPressure', L('배압', 'BP')], ['stackTempC', L('스택 온도', 'Stack')], ['lossMW', L('발전 손실', 'Loss')]] as [Metric, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={m === id} onClick={() => setM(id)} className={`min-h-[36px] flex-1 rounded-lg ${m === id ? 'bg-surface text-accent-ink shadow-card' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      {virtual.length === 0 && measured.length === 0 ? <p className="rounded-xl bg-canvas px-3 py-6 text-center text-xs text-muted">{L('표시할 추이 데이터가 없습니다.', 'No trend data.')}</p> : (
        <LineChart ariaLabel={L('성능 추이', 'Performance trend')} height={170}
          series={[{ id: 'v', label: L('DEMO 가정', 'DEMO assumption'), color: 's1', area: true, points: virtual }, { id: 'm', label: L('실측', 'Measured'), color: 's2', markers: true, points: measured }]}
          xLabel="" yLabel={unit} fmtX={(x) => (x > 0 ? `+${x}` : String(x))} fmtY={(y) => fmtNum(y, lang, m === 'lossMW' ? 2 : 0)} vLines={[{ x: 0, label: 'D0' }]} empty={L('표시할 값이 없습니다.', 'Nothing to show.')} />
      )}
      <p className="mt-1 text-[11px] text-faint">{measured.length ? L(`실측 ${measured.length}점 · 영역은 DEMO 가정`, `${measured.length} measured · area = DEMO assumption`) : L('실측 없음 — DEMO 가정선만 (세정 후 경과일 D)', 'No measurements — DEMO line only (days from cleaning)')}</p>
    </MCard>
  )
}

// ---------------------------------------------------------------- 세정 효과 요약 (결과가 있을 때만)
function CleaningSummary({ o }: { o: Overview }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const ep = o.calc_economic_params
  const g = o.actual_performance_gap
  const shortest = o.economics?.methods.find((x) => x.key === o.economics?.shortestPayback)
  if (!ep && !g) return null
  const rows: [string, string, string][] = [
    ...(ep ? [[L('예상 회수 출력', 'Expected recovery'), `${fmtNum(ep.targetRecoveryMW, lang)} MW`, L('가정', 'Assumption')] as [string, string, string],
      [L('월 순편익 (가정)', 'Monthly net benefit'), fmtWon(ep.monthlyNetBenefit, lang).short, 'DEMO'] as [string, string, string],
      [L('손익분기', 'Break-even'), `${fmtNum(ep.bepDays, lang, 1)} ${L('일', 'd')}`, 'DEMO'] as [string, string, string]] : []),
    ...(shortest?.paybackMonths.value != null ? [[L('회수기간 (최단 공법)', 'Payback (shortest)'), `${fmtNum(shortest.paybackMonths.value, lang, 2)} ${L('개월', 'mo')}`, shortest.name[lang]] as [string, string, string]] : []),
    ...(g ? [[L('세정 전후 배압 변화', 'BP change (measured)'), `${fmtNum(g.d0_backPressure, lang, 1)} → ${fmtNum(g.current_backPressure, lang, 1)} mmH₂O`, L('실측', 'Measured')] as [string, string, string]] : []),
  ]
  return (
    <MCard>
      <MTitle icon="beforeAfter" action={<MoreLink to="/analysis?tab=economics">{L('분석', 'Analysis')}</MoreLink>}>{L('세정 효과 요약', 'Cleaning effect')}</MTitle>
      <dl className="grid grid-cols-2 gap-2">
        {rows.map(([a, b, src]) => (
          <div key={a} className="rounded-xl bg-canvas p-3">
            <dt className="text-[11px] text-muted">{a}</dt>
            <dd className="mt-0.5 break-words text-[15px] font-bold tabular-nums text-ink">{b}</dd>
            <dd className="mt-0.5 text-[10px] font-semibold text-accent-ink">{src}</dd>
          </div>
        ))}
      </dl>
      {o.economics && <p className="mt-2 text-[11px] text-faint">{o.economics.shortestNote[lang]}</p>}
      <div className="mt-2"><AsOf at={o.lastEvaluatedAt} label={L('계산 기준', 'Computed')} /></div>
    </MCard>
  )
}

// ---------------------------------------------------------------- 빠른 작업
function QuickActions() {
  const L = useL()
  const attach = useCopilot((s) => s.attachContext)
  const lang = useApp((s) => s.lang)
  const btn = 'flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-surface px-2 text-center text-[12px] font-semibold text-ink shadow-card active:bg-accent-soft'
  return (
    <section aria-label={L('빠른 작업', 'Quick actions')} className="grid grid-cols-3 gap-2">
      <Link to="/checklist" className={btn}><Icon name="checklist" size={20} className="text-accent" />{L('데이터 점검하기', 'Check data')}</Link>
      <Link to="/analysis" className={btn}><Icon name="analysis" size={20} className="text-accent" />{L('최근 분석 보기', 'Recent analysis')}</Link>
      <button type="button" className={btn} onClick={() => attach('dashboard', lang === 'ko' ? '현재 HRSG 상태를 요약하고 우선 확인할 사항을 알려줘.' : 'Summarize the current HRSG state and what to check first.')}>
        <Icon name="sparkles" size={20} className="text-accent" />{L('AI에게 질문하기', 'Ask AI')}
      </button>
    </section>
  )
}
