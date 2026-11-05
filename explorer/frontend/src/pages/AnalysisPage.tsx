import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Economics, Effects, Performance, Pinch, Position, Reference, SmpPayload, Source, Val } from '../api/engine'
import BarChart from '../components/charts/BarChart'
import LineChart from '../components/charts/LineChart'
import Icon from '../components/Icon'
import { CaseDataGate } from '../components/InputsPanel'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Kpi, Notice, Steps, Tabs, ValueText } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum, fmtWon } from '../lib/format'
import { useApp } from '../store/app'
import { AskAiButton } from '../components/chat/ChatThread'
import { PageActions } from '../components/shell'
import { dirtyKeys, useCaseData } from '../store/caseData'

type Tab = 'reference' | 'economics' | 'pinch' | 'basis'
const TABS: Tab[] = ['reference', 'economics', 'pinch', 'basis']

export default function AnalysisPage() {
  return (
    <CaseDataGate>
      <PageActions><AskAiButton page="analysis" question={['성능 추정·공법별 경제성·핀치/어프로치 결과를 해석해 줘.', 'Interpret the performance estimate, economics by method and pinch/approach.']} /></PageActions>
      <Analysis />
    </CaseDataGate>
  )
}

function Analysis() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [params, setParams] = useSearchParams()
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'reference') as Tab
  const { results, draft, inputs, run, running } = useCaseData()
  const r = results?.results
  const dirty = dirtyKeys(draft, inputs).length > 0
  const anyStale = !!r && Object.entries(r).some(([k, x]) => k !== 'comparison' && x?.stale)
  const missing = !r?.performance || !r?.economics || !r?.pinch || !r?.reference

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="card p-5">
        <Tabs
          tabs={[
            { id: 'reference', label: L('세정 효과 추정', 'Cleaning effect') },
            { id: 'economics', label: L('세정 경제성 비교', 'Cleaning economics') },
            { id: 'pinch', label: 'Pinch / Approach' },
            { id: 'basis', label: L('분석 근거', 'Basis') },
          ]}
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          {L('계산기·시뮬레이션에서 저장한 결과를 해석합니다. 이 화면은 별도 계산 엔진을 갖지 않습니다.', 'Interprets results saved from the calculator/simulation. No separate engine here.')}
          {r?.performance && <span>· {L('계산', 'Computed')} {fmtDateTime(r.performance.computed_at, lang)}</span>}
          {(missing || anyStale || dirty) && (
            <button type="button" className="btn-primary ml-auto px-2.5 py-1 text-xs" onClick={() => run('all')} disabled={running}>
              <Icon name="refresh" size={13} className={running ? 'animate-spin' : ''} />
              {missing ? L('분석 계산 실행', 'Run analysis') : L('현재 입력으로 다시 계산', 'Recalculate')}
            </button>
          )}
        </div>
        {(anyStale || dirty) && !missing && <div className="mt-2"><Notice tone="caution" icon="refresh">{L('입력이 바뀌어 아래 결과는 이전 입력 기준입니다.', 'Inputs changed; results below are for the previous inputs.')}</Notice></div>}
      </div>

      {missing && tab !== 'basis' ? (
        <Card><Notice tone="muted">{L('아직 계산 결과가 없습니다. [분석 계산 실행]을 누르세요.', 'No results yet. Press Run analysis.')}</Notice></Card>
      ) : (
        <div className={anyStale || dirty ? 'opacity-60' : ''}>
          {tab === 'reference' && <ReferenceTab ref_={r!.reference!.payload as Reference} perf={r!.performance!.payload as Performance} />}
          {tab === 'economics' && <EconomicsTab econ={r!.economics!.payload as Economics} />}
          {tab === 'pinch' && <PinchTab p={r!.pinch!.payload as Pinch} />}
          {tab === 'basis' && <BasisTab />}
        </div>
      )}
    </div>
  )
}

const POS = { BELOW: ['아래', 'below'], WITHIN: ['안', 'within'], ABOVE: ['위', 'above'] } as const
function PosText({ p }: { p: Position }) {
  const L = useL()
  if (!p) return <span className="text-muted">—</span>
  return <b className={p === 'WITHIN' ? '' : 'text-caution'}>{L(`참고 범위 ${POS[p][0]}`, `${POS[p][1]} reference range`)}</b>
}

function SourceChips({ sources }: { sources: Source[] }) {
  const lang = useApp((s) => s.lang)
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1 rounded-md border border-line bg-sunken px-2 py-0.5 text-[11px] text-muted" title={s.scope?.[lang]}>
          <Icon name="reference" size={11} />{typeof s.title === 'string' ? s.title : s.title[lang]}{s.year ? ` (${s.year})` : ''}
        </span>
      ))}
    </div>
  )
}

/** 범위 막대: low~high 와 참고 구간 */
function RangeBar({ low, high, max, unit }: { low: number; high: number; max: number; unit: string }) {
  const lang = useApp((s) => s.lang)
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <div>
      <div className="relative h-3 rounded-full bg-sunken">
        <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-soft to-accent" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})`, minWidth: 4 }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>0</span><span className="font-semibold text-ink">{fmtNum(low, lang)} ~ {fmtNum(high, lang)} {unit}</span><span>{fmtNum(max, lang)}</span></div>
    </div>
  )
}

function EffectsBlock({ e, title }: { e: Effects; title: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const lo = e.output_loss_pct.low.value ?? 0, hi = e.output_loss_pct.high.value ?? 0
  const mw = e.output_loss_mw
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold">{title}<ReliabilityBadge kind="PUBLIC_REF" /></div>
      <div>
        <div className="mb-1 text-xs text-muted">{L('가스터빈 출력 영향 범위 (GE ~ IST)', 'GT output effect range (GE – IST)')}</div>
        <RangeBar low={lo} high={hi} max={Math.max(2, Math.ceil(hi))} unit="%" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-4">
          <span className="text-xs font-semibold text-muted">{L('출력 (MW)', 'Output (MW)')}</span>
          <div className="mt-2 text-lg font-bold">
            {mw.low.value === null ? <span className="text-sm font-normal text-muted">{mw.low.reason?.[lang]}</span> : `${fmtNum(mw.low.value, lang)} ~ ${fmtNum(mw.high.value, lang)}`}
          </div>
        </div>
        <Kpi label={L('열소비율 증가', 'Heat rate increase')} v={e.heat_rate_increase_pct} />
        <Kpi label={L('배기온도 상승', 'Exhaust temp rise')} v={e.exhaust_temp_increase_c} />
      </div>
    </div>
  )
}

function ReferenceTab({ ref_, perf }: { ref_: Reference; perf: Performance }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const mw = (e: Effects | null) => e && e.output_loss_mw.low.value !== null ? `${fmtNum(e.output_loss_mw.low.value, lang)} ~ ${fmtNum(e.output_loss_mw.high.value, lang)} MW` : '—'
  return (
    <div className="space-y-4">
      <Notice tone="info">{ref_.notice[lang]}</Notice>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Kpi label={L('차압 증가 (현재 − 청정)', 'ΔP increase (current − clean)')} v={ref_.dp_increase.kpa} rel="USER_INPUT" sub={<>= <ValueText v={ref_.dp_increase.in_h2o} /></>} />
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs font-semibold text-muted">{L('세정 참고 기준과 비교 (3~4 inH₂O)', 'vs. cleaning rule of thumb (3–4 inH₂O)')}</div>
          <div className="mt-2 text-lg"><PosText p={ref_.trigger_position} /></div>
          <p className="mt-1 text-[11px] text-faint">POWER 2015 · {L('판정 아님', 'not a judgment')}</p>
        </div>
        <Kpi label={L('배압 기준 초과분 (계산기)', 'Excess BP (calculator)')} v={perf.excessBP} sub={L('배압 입력 기준 — 차압과 별도 입력', 'From BP inputs — separate from ΔP')} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={L('현재 오염에 따른 영향', 'Effect of current fouling')} icon="alert">
          {ref_.effects ? (
            <>
              <EffectsBlock e={ref_.effects} title={L(`출력 손실 참고 범위: ${mw(ref_.effects)}`, `Output loss reference range: ${mw(ref_.effects)}`)} />
            </>
          ) : <Notice tone="muted">{ref_.effects_reason?.[lang]}</Notice>}
        </Card>
        <Card title={L('세정 후 회복 가능 범위', 'Recoverable after cleaning')} icon="refresh">
          {ref_.recovery ? (
            <EffectsBlock e={ref_.recovery} title={L(`회복 참고 범위: ${mw(ref_.recovery)}`, `Recovery reference range: ${mw(ref_.recovery)}`)} />
          ) : <Notice tone="muted">{ref_.recovery_reason?.[lang]}</Notice>}
        </Card>
      </div>
      <Card title={L('참고 문헌별 비교', 'By source')} icon="reference">
        {ref_.effects ? (
          <BarChart
            ariaLabel={L('문헌별 출력 손실 비율', 'Output loss % by source')} unavailable={L('산출 불가', 'Not computable')}
            fmt={(v) => `${fmtNum(v, lang)} %`}
            bars={[
              { id: 'ge', label: 'GE GER-3567H', value: ref_.effects.output_loss_pct.low.value, color: 's1' },
              { id: 'ist', label: 'IST 2000', value: ref_.effects.output_loss_pct.high.value, color: 's2' },
            ]}
          />
        ) : <Notice tone="muted">{ref_.effects_reason?.[lang]}</Notice>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Kpi label={L('스팀터빈 출력 영향', 'Steam turbine effect')} v={ref_.steam_turbine_loss} />
          <Kpi label={L('스택 온도 영향', 'Stack temperature effect')} v={ref_.stack_temp_increase} />
        </div>
        <div className="mt-4"><SourceChips sources={ref_.sources} /></div>
        <p className="mt-2 text-xs text-muted">{L('가스터빈 출력 기준', 'GT output basis')}: {fmtNum(ref_.gtOutputMW.value, lang)} MW — {ref_.gtOutputMW.note[lang]}</p>
      </Card>
    </div>
  )
}

function EconomicsTab({ econ }: { econ: Economics }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const smpInput = useCaseData((s) => s.inputs?.values.smpWonPerKWh)
  const [smp, setSmp] = useState<SmpPayload | null>(null)
  useEffect(() => {
    api<SmpPayload>('/public/smp/').then(setSmp).catch(() => setSmp(null))
  }, [])
  const colors = ['s1', 's2', 's3'] as const
  const row = (label: string, pick: (m: Economics['methods'][number]) => Val, money = true) => (
    <tr className="border-t border-line">
      <td className="py-2 pl-5 pr-3 text-muted">{label}</td>
      {econ.methods.map((m) => <td key={m.key} className="px-3 text-right"><ValueText v={pick(m)} money={money} compact /></td>)}
    </tr>
  )
  return (
    <div className="space-y-4">
      <Notice tone="info">{econ.notice[lang]}</Notice>
      <Card title={L('공법별 경제성', 'Economics by method')} icon="calculator" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-sunken text-xs text-muted">
              <tr><th className="py-2 pl-5 text-left">{L('항목', 'Item')}</th>{econ.methods.map((m) => <th key={m.key} className="px-3 py-2 text-right">{m.name[lang]}{m.key === econ.shortestPayback && ' ●'}</th>)}</tr>
            </thead>
            <tbody>
              {row(L('세정 비용', 'Cleaning cost'), (m) => m.cost)}
              {row(L('정지 손실 (DEMO 계수 0.15)', 'Outage cost (DEMO 0.15)'), (m) => m.outageCost)}
              {row(L('총투자 비용', 'Total investment'), (m) => m.initialCost)}
              {row(L('회수 출력', 'Recovered output'), (m) => m.recoveryMW, false)}
              {row(L('월간 회수 편익', 'Monthly benefit'), (m) => m.monthlyBenefit)}
              {row(L('첫 1개월 순편익', 'First-month net'), (m) => m.firstMonthNet)}
              {row(L('투자 회수기간 (개월)', 'Payback (months)'), (m) => m.paybackMonths, false)}
              {row(L('손익분기 일수', 'Break-even days'), (m) => m.bepDays, false)}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={L('순편익 비교 (첫 1개월)', 'First-month net benefit')} icon="analysis">
        <BarChart ariaLabel={L('공법별 첫 달 순편익', 'First-month net by method')} unavailable={L('산출 불가', 'Not computable')}
          fmt={(v) => fmtWon(v, lang).short}
          bars={econ.methods.map((m, i) => ({ id: m.key, label: m.name[lang], value: m.firstMonthNet.value, reason: m.firstMonthNet.reason?.[lang], color: colors[i] }))} />
        <p className="mt-2 text-xs text-muted">{L('첫 달 기준 값이며 전체 투자기간의 누적 순편익이 아닙니다. 누적은 세정 전후 비교 화면에서 봅니다.', 'First month only — see Before/After for the cumulative curve.')}</p>
      </Card>
      <Card title={L('SMP 실적 (공개 통계)', 'SMP history (public)')} icon="evaluation" aside={<ReliabilityBadge kind="PUBLIC_REF" />}>
        {smp ? (
          <>
            <LineChart
              ariaLabel={L('월별 SMP', 'Monthly SMP')}
              series={[{ id: 'smp', label: `SMP (${smp.region[lang]})`, color: 's1', markers: true, points: smp.monthly.map((m, i) => ({ x: i, y: m.value })) }]}
              xLabel={L('월', 'Month')} yLabel="원/kWh" fmtX={(i) => smp.monthly[i]?.month.slice(2) ?? ''} fmtY={(y) => fmtNum(y, lang, 2)}
              refLines={smpInput ? [{ y: Number(smpInput), label: L(`현재 입력 ${smpInput} (DEMO)`, `Current input ${smpInput} (DEMO)`) }] : []}
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {smp.annual.map((a) => <span key={a.year} className="rounded-md bg-sunken px-2 py-1">{a.year}: <b>{fmtNum(a.value, lang)}</b></span>)}
            </div>
            <p className="mt-2 text-[11px] text-faint">{smp.average[lang]} · {smp.notice[lang]} · {L('확인일', 'Checked')} {smp.source.checked_on}</p>
          </>
        ) : <Notice tone="muted">{L('SMP 자료를 불러오지 못했습니다.', 'Could not load SMP data.')}</Notice>}
      </Card>
    </div>
  )
}

function TempScale({ label, value, demo, ist, design }: { label: string; value: number | null; demo: [number, number]; ist?: [number, number]; design?: number | null }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const vals = [value ?? 0, ...demo, ...(ist ?? []), design ?? 0]
  const lo = Math.min(0, ...vals) - 2, hi = Math.max(...vals) + 4
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-bold">{label}</span><span className="text-xl font-bold">{value === null ? '—' : `${fmtNum(value, lang)} °C`}</span></div>
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-4 h-1 rounded-full bg-sunken" />
        <div className="absolute top-2 h-5 rounded border border-dashed border-accent/60 bg-accent-soft/60" style={{ left: x(demo[0]), width: `calc(${x(demo[1])} - ${x(demo[0])})` }} title="DEMO" />
        {ist && <div className="absolute top-3 h-3 rounded bg-s1/30" style={{ left: x(ist[0]), width: `calc(${x(ist[1])} - ${x(ist[0])})` }} title="IST 2000" />}
        {design !== null && design !== undefined && <div className="absolute top-1 h-7 w-0.5 bg-muted" style={{ left: x(design) }} title={L('설계값', 'Design')} />}
        {value !== null && <div className="absolute top-1.5 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-surface bg-ink" style={{ left: x(value) }} />}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-dashed border-accent/60 bg-accent-soft" />DEMO {demo.join('~')} °C</span>
        {ist && <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-s1/30" />IST 2000 {ist.map((v) => fmtNum(v, lang, 1)).join('~')} °C</span>}
        {design !== null && design !== undefined && <span>| {L('설계값', 'Design')} {design} °C</span>}
      </div>
    </div>
  )
}

function PinchTab({ p }: { p: Pinch }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const values = useCaseData((s) => s.inputs?.values)
  return (
    <div className="space-y-4">
      <Notice tone="info">{p.notice[lang]}</Notice>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Kpi label={L('드럼 압력', 'Drum pressure')} v={{ value: Number(values?.drumPressureBar), unit: 'bar', reason: null }} rel="USER_INPUT" sub={`${p.basis === 'gauge' ? L('게이지', 'gauge') : L('절대', 'absolute')} → ${fmtNum(p.drumPressureAbsMPa, lang, 4)} MPa(a)`} />
        <Kpi label={L('포화온도 (IAPWS-IF97)', 'Saturation temp (IAPWS-IF97)')} v={p.saturationTempC} />
        <Kpi label={L('핀치 온도차', 'Pinch ΔT')} v={p.pinch} sub={p.designDiff?.pinch.value !== null && p.designDiff ? `${L('설계 대비', 'vs design')} ${fmtNum(p.designDiff.pinch.value, lang)} °C` : p.designDiff?.pinch.reason?.[lang]} />
        <Kpi label={L('어프로치 온도차', 'Approach ΔT')} v={p.approach} sub={p.designDiff?.approach.value !== null && p.designDiff ? `${L('설계 대비', 'vs design')} ${fmtNum(p.designDiff.approach.value, lang)} °C` : p.designDiff?.approach.reason?.[lang]} />
      </div>
      {p.warnings?.map((w, i) => <Notice key={i} tone="caution">{w[lang]}</Notice>)}
      <Card title={L('참고 범위와 비교', 'Against reference ranges')} icon="analysis">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TempScale label={L('핀치', 'Pinch')} value={p.pinch.value} demo={p.ranges.demo.pinch} ist={p.ranges.ist2000.pinch} design={values?.pinchDesignC as number | null} />
          <TempScale label={L('어프로치', 'Approach')} value={p.approach.value} demo={p.ranges.demo.approach} design={values?.approachDesignC as number | null} />
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>{L('핀치', 'Pinch')}: DEMO <PosText p={p.position?.demo.pinch ?? null} /> · IST <PosText p={p.position?.ist2000.pinch ?? null} /></div>
          <div>{L('어프로치', 'Approach')}: DEMO <PosText p={p.position?.demo.approach ?? null} /> · IST {L('일반값 약', 'typical about')} {fmtNum(p.ranges.ist2000.approachTypical, lang, 1)} °C</div>
        </div>
      </Card>
      <Card title={L('공학적 의미', 'What it means')} icon="info">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>{L('핀치가 작을수록 증발기에서 열을 더 회수하지만 전열면적이 커집니다. 운전 중 핀치가 커지면 증발기 전열 성능이 떨어졌을 수 있습니다(오염 등).', 'A smaller pinch recovers more heat but needs more surface. A growing pinch in operation can mean reduced evaporator heat transfer (e.g. fouling).')}</li>
          <li>{L('어프로치가 너무 작거나 0 이하이면 절탄기 안에서 증기가 생길 수 있어(steaming) 설계에서 피합니다.', 'A very small or negative approach risks economizer steaming, which designs avoid.')}</li>
          <li>{L('이 비교는 참고용입니다. 이 설비의 설계값·판정 기준은 제공되지 않았습니다.', 'This comparison is for reference; this plant’s design values and criteria were not provided.')}</li>
        </ul>
        <div className="mt-3"><SourceChips sources={p.sources} /></div>
      </Card>
    </div>
  )
}

function BasisTab() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const schema = useCaseData((s) => s.schema)
  const r = useCaseData((s) => s.results?.results)
  const [sources, setSources] = useState<Source[]>([])
  useEffect(() => {
    api<{ sources: Source[] }>('/public/sources/').then((x) => setSources(x.sources)).catch(() => setSources([]))
  }, [])
  const perf = r?.performance?.payload as Performance | undefined
  const econ = r?.economics?.payload as Economics | undefined
  const pinch = r?.pinch?.payload as Pinch | undefined
  return (
    <div className="space-y-4">
      <Card title={L('적용 공식', 'Formulas')} icon="calculator">
        {perf || econ ? <Steps steps={[...(perf?.steps ?? []), ...(econ?.steps ?? []), ...(pinch?.steps ?? [])]} /> : <Notice tone="muted">{L('계산을 실행하면 대입값과 함께 표시됩니다.', 'Run a calculation to see substituted values.')}</Notice>}
      </Card>
      <Card title={L('DEMO 계수·가정', 'DEMO coefficients & assumptions')} icon="flame">
        <ul className="divide-y divide-line text-sm">
          {schema?.coefficients.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-2 py-2">
              <ReliabilityBadge kind="DEMO" /><b>{c.label[lang]}</b><span className="tabular-nums">{String(c.value)}</span>
              <code className="ml-auto text-[11px] text-faint">{c.where}</code>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{L('출처: 사용자 제공 구현 프롬프트. 원 출처 문헌이 확인되지 않은 가상 가정이며 승인된 모델이 아닙니다.', 'Source: user-provided implementation prompt. Virtual assumptions without confirmed literature; not an approved model.')}</p>
      </Card>
      <Card title={L('참고 문헌 (원문 확인)', 'References (verified)')} icon="reference">
        <ul className="space-y-3">
          {sources.map((s) => (
            <li key={s.key} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-baseline gap-2"><b className="text-sm">{typeof s.title === 'string' ? s.title : s.title[lang]}</b><span className="text-xs text-muted">{s.author} {s.year ?? ''}</span><ReliabilityBadge kind="PUBLIC_REF" /></div>
              <div className="mt-1 text-xs text-muted">{s.where}</div>
              {s.quote && <blockquote className="mt-2 border-l-2 border-line pl-3 text-xs italic text-muted">“{s.quote}”</blockquote>}
              <div className="mt-2 text-xs"><b>{L('적용 한계', 'Limits')}:</b> {s.scope[lang]} · {L('확인일', 'Checked')} {s.checked_on}</div>
            </li>
          ))}
        </ul>
        <Link to="/reference" className="mt-3 inline-block text-sm font-semibold text-accent-ink hover:underline">{L('참고 자료·용어집 →', 'References & glossary →')}</Link>
      </Card>
    </div>
  )
}
