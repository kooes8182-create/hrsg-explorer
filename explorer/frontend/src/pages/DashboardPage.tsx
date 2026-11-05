import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { isOverview, type Overview, type OverviewKpi, type Point } from '../api/engine'
import BarChart from '../components/charts/BarChart'
import Donut from '../components/charts/Donut'
import Gauge from '../components/charts/Gauge'
import Heatmap from '../components/charts/Heatmap'
import LineChart from '../components/charts/LineChart'
import { ErrorState, PageSkeleton } from '../components/feedback'
import HrsgDiagram from '../components/HrsgDiagram'
import Icon, { type IconName } from '../components/Icon'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { PageActions } from '../components/shell'
import { Card, Notice, StatusPill, Tabs } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum, fmtWon, unitDigits, unitLabel, useDisplay } from '../lib/format'
import { useApp } from '../store/app'
import { useCaseData } from '../store/caseData'
import { AskAiButton } from '../components/chat/ChatThread'
import { useCopilot } from '../store/copilot'
import type { AppNotification } from '../api/notifications'
import { CATEGORY, relTime, SeverityBadge, SEVERITY, useNotificationActions } from '../components/notifications/NotificationCenter'
import { useNotifications } from '../store/notifications'
import { toast } from '../store/toast'

// 대시보드: 서버 집계(/overview/)만 표시합니다. 계산하지 않습니다 (평가 실행은 공통 계산 엔진 호출).
export default function DashboardPage() {
  const L = useL()
  const caseId = useApp((s) => s.currentCaseId)
  // 계산·입력 저장이 일어나면(다른 화면 포함) 다시 불러옵니다.
  const lastCalc = useCaseData((s) => s.results?.last_calculated_at)
  const inputHash = useCaseData((s) => s.inputs?.hash)
  const [o, setO] = useState<Overview | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (caseId === null) return
    try {
      const body = await api(`/cases/${caseId}/overview/`, {}, isOverview)
      if (body.case.id === caseId) setO(body)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [caseId])
  useEffect(() => {
    load()
  }, [load, lastCalc, inputHash])

  if (failed) return <ErrorState text={L('대시보드를 불러오지 못했습니다.', 'Could not load the dashboard.')} onRetry={load} />
  if (!o || o.case.id !== caseId) return <PageSkeleton />
  return <Dashboard o={o} />
}

function Actions({ caseId }: { caseId: number }) {
  const L = useL()
  const run = useCaseData((s) => s.run)
  const running = useCaseData((s) => s.running)
  return (
    <PageActions>
      <AskAiButton page="dashboard" question={['현재 HRSG 성능을 설명하고 세정이 필요한지 검토해 줘.', 'Explain the current HRSG performance and review whether cleaning is needed.']} />
      <button type="button" className="btn-ghost" onClick={() => window.open(`/report?case=${caseId}`, '_blank')}>
        <Icon name="copy" size={15} />{L('보고서', 'Report')}
      </button>
      <button type="button" className="btn-primary" disabled={running}
        onClick={async () => {
          const ok = await run('all')
          toast(ok ? 'ok' : 'error', ok ? L('평가를 실행했습니다.', 'Evaluation complete.') : L('평가하지 못했습니다. 입력값을 확인하세요.', 'Evaluation failed — check inputs.'))
        }}>
        <Icon name="refresh" size={15} className={running ? 'animate-spin' : ''} />{running ? L('평가 중…', 'Running…') : L('평가 실행', 'Run evaluation')}
      </button>
    </PageActions>
  )
}

function Dashboard({ o }: { o: Overview }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const display = useDisplay()
  const p = o.panel
  const k = (key: OverviewKpi['key']) => o.kpis.find((x) => x.key === key)!
  const stack = k('stackTemp')
  const overlays = [
    ...(p.excessBP !== null ? [{ label: L('초과 배압', 'Excess BP'), value: `${fmtNum(display(p.excessBP, 'mmH2O').value, lang, unitDigits(display(1, 'mmH2O').unit, 1))} ${unitLabel(display(p.excessBP, 'mmH2O').unit)}`, tone: (p.referenceBand?.position === 'BELOW' ? 'neutral' : 'caution') as 'neutral' | 'caution' }] : []),
    ...(stack.delta !== null ? [{ label: L('스택 온도 상승', 'Stack ΔT'), value: `${stack.delta > 0 ? '+' : ''}${fmtNum(stack.delta, lang, 1)} °C`, tone: (stack.delta > 0 ? 'caution' : 'neutral') as 'neutral' | 'caution' }] : []),
    ...(o.calc_summary_kpi?.lossMW != null ? [{ label: L('출력 손실 (DEMO)', 'Output loss (DEMO)'), value: `${fmtNum(o.calc_summary_kpi.lossMW, lang, 3)} MW` }] : []),
  ]

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <Actions caseId={o.case.id} />
      <Workflow o={o} />
      <Attention />
      {o.alerts.length > 0 && <div className="space-y-2">{o.alerts.slice(0, 3).map((a, i) => <Notice key={i} tone={a.tone}>{a.text[lang]}</Notice>)}</div>}

      {/* A. 운전 상태(큰 카드) + 핵심 KPI 4 */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <StatusHero o={o} className="xl:col-span-4" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-8">
          <KpiCard k={k('backPressure')} viz="bp" o={o} />
          <KpiCard k={k('stackTemp')} viz="delta" o={o} />
          <KpiCard k={k('lossMW')} o={o} emphasis />
          <KpiCard k={k('lossMonthlyWon')} o={o} />
        </div>
      </div>

      {/* B. 성능 추이(넓게) + 세정 필요도 게이지 */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Trend o={o} className="xl:col-span-8" />
        <CleaningGauge o={o} className="xl:col-span-4" />
      </div>

      {/* C. 공정 흐름도 + 세정 경제성 */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title={L('HRSG 공정 흐름도', 'HRSG process flow')} icon="flame" sub={L('저장된 입력 기준 · 설비를 누르면 설명과 관련 화면', 'Saved inputs · click equipment for details')} className="xl:col-span-7">
          <HrsgDiagram
            values={{ currentBP: p.currentBP, hrsgDpKpa: p.hrsgDpKpa, stackTempC: p.stackTempC, drumPressureBar: o.values.drumPressureBar as number,
                      evaGasTempC: o.values.evaOutletGasTempC as number, ecoWaterTempC: o.values.ecoOutletWaterTempC as number, status: o.status.code }}
            overlays={overlays}
          />
        </Card>
        <Economics o={o} className="xl:col-span-5" />
      </div>

      {/* D. 데이터 준비도(도넛) · 수급 히트맵 · 다음 작업 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
        <Readiness o={o} className="xl:col-span-4" />
        <SupplyHeatmap o={o} className="xl:col-span-4" />
        <NextAndRecent o={o} className="lg:col-span-2 xl:col-span-4" />
      </div>

      <QuickAsk />
    </div>
  )
}

// ---------------------------------------------------------------- 현재 주의사항 (알림 센터의 미해결 알림, 심각도 → 최신 순, 최대 5개)
function Attention() {
  const L = useL()
  const items = useNotifications((s) => s.items)
  const status = useNotifications((s) => s.status)
  const setOpen = useNotifications((s) => s.setOpen)
  const open = items
    .filter((n) => n.kind === 'STATE' && !n.resolvedAt)
    .sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || b.createdAt.localeCompare(a.createdAt))
  return (
    <Card title={L('현재 주의사항', 'Current attention items')} icon="alert" sub={L('해결되지 않은 알림 · 심각도·최신 순 · 누르면 관련 화면으로', 'Unresolved notifications · by severity & time · click to open')}
      aside={<button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => setTimeout(() => setOpen(true))}>{L(`알림 센터 (${open.length})`, `Notification center (${open.length})`)} →</button>}>
      {status !== 'ready' && items.length === 0 ? <div className="h-14 animate-pulse rounded-xl bg-sunken" />
        : open.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-good-soft px-3 py-2.5 text-[13px] font-semibold text-good"><Icon name="check" size={15} />{L('해결되지 않은 주의사항이 없습니다.', 'No unresolved items.')}</p>
        ) : <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">{open.slice(0, 5).map((n) => <AttentionRow key={n.id} n={n} />)}</ul>}
    </Card>
  )
}

function AttentionRow({ n }: { n: AppNotification }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const { go, askAi } = useNotificationActions()
  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:border-[rgb(var(--peach))]">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => go(n)}>
        <span className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge s={n.severity} />
          {n.isDemo && <span className="rounded-md border border-dashed border-accent/60 px-1 text-[10px] font-bold text-accent-ink">DEMO</span>}
          <span className="text-[10.5px] text-faint">{L(CATEGORY[n.category].ko, CATEGORY[n.category].en)} · {relTime(n.createdAt, lang)}</span>
        </span>
        <span className="mt-1 block text-[13px] font-semibold text-ink">{n.title[lang]}</span>
        <span className="block truncate text-xs text-muted" title={n.message[lang]}>{n.message[lang]}</span>
      </button>
      <button type="button" className="btn-icon h-8 w-8 shrink-0" onClick={() => askAi(n)} aria-label={L('AI에게 설명 요청', 'Ask AI')} title={L('AI에게 설명 요청', 'Ask AI')}><Icon name="sparkles" size={15} className="text-accent" /></button>
    </li>
  )
}

// ---------------------------------------------------------------- 작업 진행 (가로 스텝)
const STEP_ICON: Record<string, IconName> = { data: 'checklist', simulation: 'simulation', analysis: 'analysis', ai: 'ai' }
function Workflow({ o }: { o: Overview }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const name = { data: L('자료 준비', 'Data'), simulation: L('시뮬레이션', 'Simulation'), analysis: L('분석', 'Analysis'), ai: L('AI 검토', 'AI review') }
  const state = {
    done: { dot: 'bg-accent text-white', text: L('완료', 'Done'), tc: 'text-accent-ink' },
    progress: { dot: 'bg-peach text-accent-ink', text: L('진행 중', 'In progress'), tc: 'text-accent-ink' },
    todo: { dot: 'bg-sunken text-faint', text: L('시작 전', 'To do'), tc: 'text-faint' },
    stale: { dot: 'bg-caution-soft text-caution', text: L('재평가 필요', 'Re-run'), tc: 'text-caution' },
    unavailable: { dot: 'bg-sunken text-faint', text: L('준비 중', 'Not yet'), tc: 'text-faint' },
  }
  return (
    <nav aria-label={L('작업 진행 현황', 'Workflow')} className="card p-2">
      <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-4">
        {o.workflow.map((w, i) => {
          const s = state[w.state]
          return (
            <li key={w.key}>
              <Link to={w.link} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent-soft">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${s.dot}`}>
                  {w.state === 'done' ? <Icon name="check" size={16} /> : <Icon name={STEP_ICON[w.key]} size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
                    <span className="font-mono text-[10px] text-faint">0{i + 1}</span>{name[w.key]}
                    <span className={`text-[11px] font-semibold ${s.tc}`}>· {s.text}</span>
                  </span>
                  <span className="block truncate text-xs text-muted" title={w.detail[lang]}>{w.detail[lang]}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------- 운전 상태 (큰 카드)
function StatusHero({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const display = useDisplay()
  const p = o.panel
  const pr = (v: number | null, u: string, d = 1) => {
    const x = display(v, u)
    return x.value === null ? '—' : `${fmtNum(x.value, lang, x.unit !== u ? unitDigits(x.unit, d) : d)} ${unitLabel(x.unit)}`
  }
  const scenarioName = { NORMAL: L('정상 운전', 'Normal operation'), ALARM: L('오염 진행', 'Fouling building up'), TRIP: L('세정 필요', 'Cleaning needed'), CUSTOM: 'Custom' }[o.scenario]
  // 배압 막대: 기준 배압 ~ 기준 + 참고 띠 위쪽까지 눈금 (값은 서버 값 그대로)
  const top = Math.max(p.currentBP, p.baselineBP + (p.referenceBand?.mmH2O[1] ?? 100)) * 1.15
  const pos = (v: number) => `${Math.min(100, (v / top) * 100)}%`
  const facts: [string, string][] = [
    [L('가스터빈 등급', 'GT class'), p.turbineModel], [L('발전 용량', 'Capacity'), `${fmtNum(p.capacityMW, lang)} MW`],
    [L('운전 부하율', 'Load factor'), `${fmtNum(p.loadFactor, lang)} %`], [L('HRSG 차압', 'HRSG ΔP'), pr(p.hrsgDpKpa, 'kPa', 2)],
    [L('스택 온도', 'Stack temp'), pr(p.stackTempC, '°C')], [L('현재 시나리오', 'Scenario'), o.mode === 'DEMO' ? scenarioName : L('사용자 입력', 'User input')],
  ]
  return (
    <Card title={L('운전 상태', 'Operating status')} icon="server" className={className}
      aside={<Link to="/simulation" className="text-xs font-semibold text-accent-ink hover:underline">{L('조건 바꾸기', 'Change')} →</Link>}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill code={o.status.code} label={o.status.label} large />
        <ReliabilityBadge kind={o.status.rel} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{o.status.reason[lang]}</p>
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-muted">{L('현재 배압', 'Current BP')}</span>
          <span className="text-[13px] text-muted">{L('기준', 'Baseline')} {pr(p.baselineBP, 'mmH2O')}</span>
        </div>
        <div className="kpi-number mt-1">{pr(p.currentBP, 'mmH2O')}</div>
        <div className="relative mt-3 h-2.5 rounded-full bg-sunken" role="img" aria-label={L('현재·기준 배압과 공개 참고 구간', 'Current vs baseline back pressure and public reference band')}>
          {p.referenceBand && <div className="absolute inset-y-0 rounded-full border border-dashed border-caution/70 bg-caution-soft" style={{ left: pos(p.baselineBP + p.referenceBand.mmH2O[0]), width: `calc(${pos(p.baselineBP + p.referenceBand.mmH2O[1])} - ${pos(p.baselineBP + p.referenceBand.mmH2O[0])})` }} />}
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-peach to-accent" style={{ width: pos(p.currentBP) }} />
          <div className="absolute -top-1 w-0.5 bg-ink" style={{ left: pos(p.baselineBP), height: 18 }} title={L('기준 배압', 'Baseline')} />
        </div>
        <p className="mt-1.5 text-[11px] text-faint">{L('│ 기준 배압 · ┄ 공개 참고 세정 기준(기준 + 3~4 inH₂O, 판정 아님)', '│ baseline · ┄ public cleaning reference (baseline + 3–4 inH₂O, not a limit)')}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-4 text-[13px]">
        {facts.map(([a, b]) => <div key={a}><dt className="text-[11px] text-faint">{a}</dt><dd className="font-semibold tabular-nums text-ink">{b}</dd></div>)}
      </dl>
      <div className="mt-4 rounded-xl bg-canvas px-3 py-2.5 text-xs">
        <span className="font-semibold text-ink">{L('운전 상태 알림', 'State alerts')}: </span>
        {o.status.code === 'ALARM' || o.status.code === 'TRIP'
          ? <span className="text-caution">{L(`DEMO 시나리오 상태 ${o.status.label.ko} (가상 — 실제 설비 경보 아님)`, `DEMO scenario state ${o.status.label.en} (virtual — not a real alarm)`)}</span>
          : <span className="text-muted">{L('없음 (실제 설비 경보 미연동)', 'None (no real alarms connected)')}</span>}
        <div className="mt-1 text-faint">{L('마지막 평가', 'Last evaluation')} {fmtDateTime(o.lastEvaluatedAt, lang)}</div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- KPI 카드
function KpiCard({ k, viz, o, emphasis }: { k: OverviewKpi; viz?: 'bp' | 'delta'; o: Overview; emphasis?: boolean }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const display = useDisplay()
  const val = (n: number | null) => {
    if (n === null) return '—'
    if (k.unit === '원') return fmtWon(n, lang).short
    const d = display(n, k.unit)
    return fmtNum(d.value, lang, k.key === 'lossMW' ? 3 : d.unit !== k.unit ? unitDigits(d.unit, 1) : 1)
  }
  const unit = k.unit === '원' ? '' : unitLabel(display(1, k.unit).unit)
  const stale = k.rel === 'REEVALUATION_REQUIRED'
  const missing = k.value === null
  const up = k.delta !== null && k.delta > 0
  // 미니 막대: 현재 값이 기준보다 얼마나 높은지 (배압은 공개 참고 띠 대비)
  const band = o.panel.referenceBand?.mmH2O[1]
  const barPct = viz === 'bp' && k.delta !== null && band ? Math.min(100, (Math.max(0, k.delta) / (band * 1.5)) * 100)
    : viz === 'delta' && k.delta !== null ? Math.min(100, (Math.max(0, k.delta) / 30) * 100) : null
  return (
    <div className={`card card-hover flex min-h-[156px] flex-col p-5 ${emphasis ? 'bg-gradient-to-br from-accent-soft via-surface to-surface' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[13px] font-semibold leading-snug text-muted">{k.label[lang]}</span>
        {k.rel && <span className="shrink-0"><ReliabilityBadge kind={k.rel} /></span>}
      </div>
      <div className="mt-3 flex-1">
        {missing && !stale ? <p className="text-[13px] leading-snug text-muted">{k.reason?.[lang] ?? '—'}</p> : (
          <div className={`flex items-baseline gap-1.5 ${stale ? 'opacity-35 blur-[1.5px]' : ''}`} title={stale ? L('이전 입력 기준 값', 'Value for previous inputs') : undefined}>
            <span className="kpi-number">{stale ? val(k.previous) : val(k.value as number)}</span>
            {unit && <span className="text-sm font-semibold text-muted">{unit}</span>}
          </div>
        )}
        {stale && <p className="mt-1 text-[11px] text-caution">{L('재평가 전에는 현재 값으로 보지 않습니다', 'Not current until re-evaluated')}</p>}
        {k.baseline !== null && k.delta !== null && !missing && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold ${up ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-muted'}`}>
              {up ? '▲' : k.delta < 0 ? '▼' : '='} {fmtNum(Math.abs(display(k.delta, k.unit).value ?? k.delta), lang, unitDigits(display(1, k.unit).unit, 1))}{k.changeRate !== null && ` (${k.changeRate > 0 ? '+' : ''}${fmtNum(k.changeRate, lang, 1)}%)`}
            </span>
            <span className="text-faint">{L('기준', 'vs baseline')} {val(k.baseline)}</span>
          </div>
        )}
        {k.baseline !== null && k.delta === null && !missing && k.reason && <p className="mt-2 text-xs text-faint">{k.reason[lang]}</p>}
      </div>
      {barPct !== null && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-gradient-to-r from-soft to-accent" style={{ width: `${barPct}%` }} /></div>}
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-faint">
        <span className="truncate">{k.note?.[lang] ?? (k.status && k.key === 'backPressure' ? '' : '')}</span>
        {k.computedAt && <span className="shrink-0">{fmtDateTime(k.computedAt, lang)}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 세정 필요도 게이지 + 회수 효과
function CleaningGauge({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const score = o.kpis.find((x) => x.key === 'cleaningScore')!
  const rec = o.kpis.find((x) => x.key === 'recoveryPct')!
  const v = typeof score.value === 'number' ? score.value : null
  const stale = score.rel === 'REEVALUATION_REQUIRED'
  const range = Array.isArray(rec.value) ? rec.value : null
  return (
    <Card title={L('세정 필요도', 'Cleaning need')} icon="flame" className={className} aside={<ReliabilityBadge kind={stale ? 'REEVALUATION_REQUIRED' : 'DEMO'} />}>
      <div className={`flex flex-col items-center ${stale ? 'opacity-40' : ''}`}>
        <Gauge value={stale ? score.previous : v} max={100} label={L('세정 필요도 지수 (0~100)', 'Cleaning-need index (0–100)')} valueText={v === null && !stale ? '—' : fmtNum(stale ? score.previous : v, lang, 0)} unit="/ 100" />
      </div>
      {v === null && !stale && <p className="mt-1 text-center text-xs text-muted">{score.reason?.[lang]}</p>}
      <p className="mt-1 text-center text-[11px] text-faint">{L('DEMO 휴리스틱 — 실제 세정 판정 기준 아님', 'DEMO heuristic — not a real cleaning criterion')}</p>
      <div className="mt-4 rounded-xl border border-line bg-canvas p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted">{rec.label[lang]}</span>
          <ReliabilityBadge kind={(rec.rel ?? 'UNAVAILABLE') as 'PUBLIC_REF'} />
        </div>
        {range ? <div className="mt-1.5 text-[22px] font-bold tabular-nums text-ink">{fmtNum(range[0], lang, 2)}~{fmtNum(range[1], lang, 2)}<span className="ml-1 text-sm text-muted">%</span></div>
          : <p className="mt-1.5 text-xs text-muted">{rec.reason?.[lang]}</p>}
        {rec.note && <p className="mt-1 text-[11px] text-faint">{rec.note[lang]}</p>}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- 성능 추이 (넓은 영역 차트)
type Metric = 'backPressure' | 'stackTempC' | 'lossMW'
type Period = 'all' | 'before' | 'after'
function Trend({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [metric, setMetric] = useState<Metric>('backPressure')
  const [period, setPeriod] = useState<Period>('all')
  const c = o.comparison
  const inPeriod = (pt: Point) => period === 'all' || (period === 'before' ? pt.x < 0 : pt.x >= 0)
  const virtual = (c?.virtual[metric] ?? []).filter(inPeriod)
  const measured = (c?.measured[metric] ?? []).filter(inPeriod)
  const base = o.panel.baselineBP
  const band = o.panel.referenceBand
  const unit = { backPressure: 'mmH₂O', stackTempC: '°C', lossMW: 'MW' }[metric]
  return (
    <Card title={L('HRSG 운전 성능 추이', 'HRSG performance trend')} icon="evaluation" sub={L('세정 후 경과일 기준', 'By days from cleaning')} className={className}
      aside={<Tabs tabs={[{ id: 'backPressure' as const, label: L('배압', 'BP') }, { id: 'stackTempC' as const, label: L('스택 온도', 'Stack') }, { id: 'lossMW' as const, label: L('발전 손실', 'Loss') }]} value={metric} onChange={setMetric} />}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        {(['all', 'before', 'after'] as const).map((pp) => (
          <button key={pp} type="button" aria-pressed={period === pp} onClick={() => setPeriod(pp)}
            className={`rounded-full border px-2.5 py-1 font-semibold transition-colors ${period === pp ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:border-[rgb(var(--peach))]'}`}>
            {{ all: 'D-30 ~ D+60', before: L('세정 전', 'Before'), after: L('세정 후', 'After') }[pp]}
          </button>
        ))}
        <span className="ml-auto text-muted">{measured.length ? L(`실측 ${measured.length}점`, `${measured.length} measured`) : L('실측 없음 — DEMO 가정선만', 'No measurements — DEMO line only')}</span>
      </div>
      <LineChart
        ariaLabel={L('성능 추이', 'Performance trend')} height={270}
        series={[
          { id: 'v', label: L('DEMO 가정 (기준선)', 'DEMO assumption'), color: 's1', area: true, points: virtual },
          { id: 'm', label: L('사용자 실측', 'Measured'), color: 's2', markers: true, points: measured },
        ]}
        xLabel={L('경과일 D', 'Day D')} yLabel={unit} fmtX={(x) => (x > 0 ? `+${x}` : String(x))} fmtY={(y) => fmtNum(y, lang, metric === 'lossMW' ? 3 : 0)}
        bands={metric === 'backPressure' && band ? [{ y0: base + band.mmH2O[0], y1: base + band.mmH2O[1], label: L('공개 참고 세정 기준 — 판정 아님', 'Public cleaning reference — not a limit') }] : []}
        refLines={metric === 'backPressure' ? [{ y: base, label: L('기준 배압', 'Baseline') }] : []}
        vLines={period !== 'before' ? [{ x: 0, label: 'D0' }] : []}
        markX={measured.length ? [{ x: measured[measured.length - 1].x, label: L('현재', 'Now') }] : []}
        empty={L('표시할 값이 없습니다.', 'Nothing to show.')}
      />
      <p className="mt-2 text-[11px] text-faint">{L('승인된 운전 한계가 없어 경보선은 그리지 않고, 공개 문헌의 세정 참고 범위만 띠로 표시합니다. 영역은 DEMO 가정이며 불확실성 범위가 아닙니다.', 'No approved limit, so no alarm line — only the public reference band. The shaded area is the DEMO assumption, not an uncertainty range.')}</p>
    </Card>
  )
}

// ---------------------------------------------------------------- 세정 경제성 + 세정 전후 요약
function Economics({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const navigate = useNavigate()
  const g = o.actual_performance_gap
  const ep = o.calc_economic_params
  const colors = ['s1', 's2', 's3'] as const
  const cells: [string, string, boolean][] = [
    [L('세정 직후 배압', 'BP right after'), g ? `${fmtNum(g.d0_backPressure, lang, 1)} mmH₂O` : '—', !!g],
    [L('현재 배압', 'Current BP'), g ? `${fmtNum(g.current_backPressure, lang, 1)} mmH₂O` : '—', !!g],
    [L('예상 회수 출력', 'Expected recovery'), ep ? `${fmtNum(ep.targetRecoveryMW, lang)} MW` : '—', false],
    [L('손익분기 (BEP)', 'Break-even'), ep ? `${fmtNum(ep.bepDays, lang, 1)} ${L('일', 'd')}` : '—', false],
  ]
  return (
    <Card title={L('세정 경제성 · 전후 요약', 'Cleaning economics · before/after')} icon="beforeAfter" className={className}
      aside={<button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => navigate('/before-after')}>{L('상세 분석', 'Details')} →</button>}>
      <div className="text-xs font-semibold text-muted">{L('공법별 투자 회수기간 (개월, 가정 기준)', 'Payback by method (months, assumptions)')}</div>
      <div className="mt-2.5">
        <BarChart ariaLabel={L('공법별 회수기간', 'Payback by method')} unavailable={L('입력 필요', 'Needs input')} fmt={(v) => `${fmtNum(v, lang, 2)} ${L('개월', 'mo')}`}
          bars={(o.economics?.methods ?? []).map((m, i) => ({ id: m.key, label: m.name[lang], value: m.paybackMonths.value, reason: m.paybackMonths.reason?.[lang], color: colors[i], highlight: o.economics?.shortestPayback === m.key }))} />
      </div>
      {o.economics && <p className="mt-2 text-[11px] text-faint">{o.economics.shortestNote[lang]}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {cells.map(([a, b, meas]) => (
          <div key={a} className="rounded-xl bg-canvas p-3">
            <div className="flex items-center justify-between gap-1 text-[11px] text-muted">{a}{b !== '—' && <span className="text-[9px] font-bold text-accent-ink">{meas ? L('실측', 'MEAS') : 'DEMO'}</span>}</div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums text-ink">{b}</div>
          </div>
        ))}
      </div>
      {!g && <p className="mt-2 text-[11px] text-faint">{L('세정 전후 실측값이 없어 실측 칸은 비어 있습니다.', 'No before/after measurements yet.')}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------- 데이터 준비도 (도넛)
function Readiness({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const s = o.checklist.summary
  const ok = s.missingRequiredCount === 0
  return (
    <Card title={L('데이터 준비도', 'Data readiness')} icon="checklist" className={className} aside={<Link to="/checklist" className="text-xs font-semibold text-accent-ink hover:underline">{L('체크리스트', 'Checklist')} →</Link>}>
      <Donut ariaLabel={L('수급 상태', 'Supply status')} center={`${Math.round(s.readinessRate ?? 0)}%`} sub={L('수령률', 'received')}
        slices={[
          { label: L('수령 완료', 'Received'), value: s.bySupply.RECEIVED, color: 'rgb(var(--accent))' },
          { label: L('검증 필요', 'Needs check'), value: s.bySupply.NEEDS_CHECK, color: 'rgb(var(--soft))' },
          { label: L('요청 필요', 'Request needed'), value: s.bySupply.REQUEST_NEEDED, color: 'rgb(var(--peach))' },
          { label: L('실측 미입력', 'Not entered'), value: s.bySupply.NOT_ENTERED, color: 'rgb(var(--line))' },
        ]} />
      <div className={`mt-4 rounded-xl px-3 py-2 text-[13px] font-semibold ${ok ? 'bg-good-soft text-good' : 'bg-caution-soft text-caution'}`}>
        {ok ? L('분석 가능 — 필수 항목 모두 수령', 'Ready — all required received') : L(`필수 ${s.missingRequiredCount}개 미수령 · 현재는 DEMO 값으로 계산`, `${s.missingRequiredCount} required missing · DEMO values used`)}
      </div>
      {o.checklist.missingRequired.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] text-muted">{L('누락 필수 항목 (누르면 이동)', 'Missing required (click)')}</div>
          <div className="mt-1.5 flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto">
            {o.checklist.missingRequired.map((m) => (
              <Link key={m.id} to={`/checklist?item=${m.id}`} className="rounded-full border border-line px-2 py-0.5 text-[11px] hover:border-accent hover:bg-accent-soft hover:text-accent-ink" title={m.name[lang]}>
                <span className="font-mono">{m.id}</span> {m.name[lang]}
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- 수급 히트맵 (범주 × 상태)
function SupplyHeatmap({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const navigate = useNavigate()
  const m = o.checklist.summary.matrix
  return (
    <Card title={L('데이터 수급 현황', 'Data supply map')} icon="analysis" sub={L('범주 × 수급 상태 항목 수 (누르면 해당 목록)', 'Items by category × status (click to filter)')} className={className}>
      <Heatmap ariaLabel={L('범주별 수급 상태', 'Supply status by category')}
        rows={[{ key: 'A', label: L('A 가스터빈/운전', 'A GT/operation') }, { key: 'B', label: L('B HRSG 열역학', 'B HRSG thermo') }, { key: 'C', label: L('C 세정/유지보수', 'C Cleaning') }, { key: 'E', label: L('E 확장', 'E Extended') }]}
        cols={[{ key: 'NOT_ENTERED', label: L('미입력', 'Not entered') }, { key: 'REQUEST_NEEDED', label: L('요청', 'Request') }, { key: 'NEEDS_CHECK', label: L('검증 필요', 'Check') }, { key: 'RECEIVED', label: L('수령', 'Received') }]}
        values={m} onCell={(r, c) => navigate(`/checklist?cat=${r}&supply=${c}`)} />
      <p className="mt-3 text-[11px] text-faint">{L('색이 진할수록 항목이 많습니다. 실제 체크리스트 집계 값입니다.', 'Darker = more items. Values are live checklist counts.')}</p>
    </Card>
  )
}

// ---------------------------------------------------------------- 다음 작업 · 최근 활동
function NextAndRecent({ o, className }: { o: Overview; className?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const health = useApp((s) => s.health)
  const kindName = { performance: L('성능 평가', 'Performance'), economics: L('경제성', 'Economics'), pinch: L('핀치', 'Pinch'), reference: L('문헌 추정', 'Literature'), comparison: L('세정 전후', 'Before/after') }
  const tone = { accent: 'border-[rgb(var(--peach))] bg-accent-soft', caution: 'border-caution/30 bg-caution-soft', info: 'border-line bg-canvas' }
  return (
    <Card title={L('다음 작업 · 최근 활동', 'Next steps · activity')} icon="clock" className={className}>
      <ul className="space-y-1.5">
        {o.recommendations.slice(0, 4).map((r) => (
          <li key={r.key}>
            <Link to={r.link} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] transition-colors hover:border-accent ${tone[r.tone]}`}>
              <span className="flex-1">{r.text[lang]}</span><Icon name="chevronRight" size={14} className="text-faint" />
            </Link>
          </li>
        ))}
        {o.recommendations.length === 0 && <li className="text-sm text-muted">{L('추천할 작업이 없습니다.', 'Nothing to suggest.')}</li>}
      </ul>
      <div className="eyebrow mt-4">{L('최근 활동', 'Recent activity')}</div>
      <ul className="mt-1.5 divide-y divide-line text-[13px]">
        {o.activity.slice(0, 5).map((a, i) => (
          <li key={i} className="flex items-center gap-2 py-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-soft" aria-hidden="true" />
            <span className="flex-1 truncate">
              {a.type === 'result' ? `${L('계산', 'Calc')}: ${kindName[a.kind!]}` : a.type === 'snapshot' ? `${L('스냅샷', 'Snapshot')}: ${a.label}` : `${L('실측 입력', 'Measurement')}: ${a.label}`}
              {a.stale && <span className="ml-1 text-[10px] font-semibold text-caution">{L('재평가 필요', 'stale')}</span>}
            </span>
            <span className="text-[11px] text-faint">{fmtDateTime(a.at, lang)}</span>
          </li>
        ))}
        {o.activity.length === 0 && <li className="py-1.5 text-muted">{L('아직 활동이 없습니다.', 'No activity yet.')}</li>}
      </ul>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
        <Icon name="server" size={13} />{L('시스템', 'System')}: {health.state === 'ok' ? L('서버·DB 정상', 'Server & DB OK') : L('연결 확인 필요', 'Check connection')} · {L('검색', 'Search')} {health.data?.search.status === 'ready' ? L('사용 가능', 'ready') : L('불가', 'off')} · AI {health.data?.ai.status === 'ready' ? L('연결', 'on') : L('꺼짐', 'off')}
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------- AI 빠른 질문
function QuickAsk() {
  const L = useL()
  const [q, setQ] = useState('')
  const copilot = useCopilot()
  const groups = [L('열역학 및 성능', 'Thermodynamics & performance'), L('세정 공법 및 경제성', 'Cleaning methods & economics'), L('핀치·어프로치', 'Pinch / approach'), L('필요 데이터', 'Required data')]
  return (
    <section className="card overflow-hidden">
      <div className="grid gap-5 bg-gradient-to-r from-accent-soft via-surface to-surface p-5 lg:grid-cols-[1fr_1.4fr] lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"><Icon name="ai" size={16} /></span>
            <h2 className="text-[15px] font-bold text-ink">{L('AI 빠른 질문', 'Quick AI question')}</h2>
            <ReliabilityBadge kind="UNCONFIRMED" />
          </div>
          <p className="mt-2 text-xs text-muted">{L('오른쪽 아래 AI 도우미 창에 이 대시보드 값(서버 저장값)을 첨부해 엽니다. 답은 공식 문헌 근거로 만듭니다.', 'Opens the AI assistant with the dashboard server values attached; answers are grounded in the official literature.')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{groups.map((g) => <span key={g} className="rounded-full border border-dashed border-line bg-surface px-2.5 py-1 text-[11px] text-faint">{g}</span>)}</div>
        </div>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault()
          if (!q.trim()) return
          copilot.setDraft(q)
          await copilot.attachContext('dashboard') // 대시보드 값(서버)을 함께 첨부하고 창을 엽니다. 전송은 사용자가 확인 후
          setQ('')
        }}>
          <input className="input h-11 flex-1 rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('예: 차압이 커지면 가스터빈 출력은 왜 줄어드나요?', 'e.g. Why does higher ΔP reduce GT output?')} aria-label={L('빠른 질문', 'Quick question')} />
          <button type="submit" className="btn-primary h-11 px-5">{L('질문', 'Ask')}</button>
        </form>
      </div>
    </section>
  )
}
