import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { isSnapshotList, type Economics, type MethodResult, type Performance, type Pinch, type SnapshotSummary } from '../api/engine'
import BarChart from '../components/charts/BarChart'
import Gauge from '../components/charts/Gauge'
import LineChart from '../components/charts/LineChart'
import Icon from '../components/Icon'
import InputsPanel, { CaseDataGate } from '../components/InputsPanel'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Kpi, Notice, Steps, Tabs, ValueText } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum, fmtWon, unitLabel } from '../lib/format'
import { useApp } from '../store/app'
import { toast } from '../store/toast'
import { useCopilot } from '../store/copilot'
import { dirtyKeys, useCaseData } from '../store/caseData'

const COLORS = ['s1', 's2', 's3', 's4'] as const // 공법 순서(키트 data)에 고정 — 정렬이 바뀌어도 색은 공법을 따라감

export default function CalculatorPage() {
  return (
    <CaseDataGate>
      <Calculator />
    </CaseDataGate>
  )
}

function Calculator() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const { schema, draft, inputs, results, running, runError, run, resetDefaults, setInputs, refreshResults } = useCaseData()
  const [metric, setMetric] = useState<'initialCost' | 'firstMonthNet' | 'paybackMonths'>('paybackMonths')
  const [sens, setSens] = useState<'smp' | 'hours'>('smp')
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([])
  const [msg, setMsg] = useState<{ tone: 'muted' | 'danger'; text: string } | null>(null)
  const [compareId, setCompareId] = useState<number | null>(null)
  const [compare, setCompare] = useState<SnapshotSummary | null>(null)

  const loadSnaps = () => caseId !== null && api(`/cases/${caseId}/snapshots/`, {}, isSnapshotList).then(setSnaps).catch(() => setSnaps([]))
  useEffect(() => {
    loadSnaps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])
  useEffect(() => {
    if (compareId === null || caseId === null) return setCompare(null)
    api<SnapshotSummary>(`/cases/${caseId}/snapshots/${compareId}/`).then(setCompare).catch(() => setCompare(null))
  }, [compareId, caseId])

  if (!schema || !draft) return null
  const dirty = dirtyKeys(draft, inputs)
  const r = results?.results
  const perf = r?.performance?.payload as Performance | undefined
  const econ = r?.economics?.payload as Economics | undefined
  const pinch = r?.pinch?.payload as Pinch | undefined
  const stale = !!r?.performance && (r.performance.stale || !!r.economics?.stale || dirty.length > 0)
  const best = econ?.methods.find((m) => m.key === econ.shortestPayback)
  const mName = (m: MethodResult) => m.name[lang]
  const colorOf = (key: string) => COLORS[Math.max(0, econ?.methods.findIndex((x) => x.key === key) ?? 0) % COLORS.length]
  // 비교 탭 정렬 = 키트 compareMethods('payback' | 'total' | 'net')
  const sorted = econ ? (econ.order?.[metric] ?? econ.methods.map((m) => m.key)).map((k) => econ.methods.find((m) => m.key === k)!).filter(Boolean) : []

  const snapshot = async (label: string) => {
    try {
      const s = await api<SnapshotSummary>(`/cases/${caseId}/snapshots/`, { method: 'POST', json: { label } })
      loadSnaps()
      return s
    } catch {
      setMsg({ tone: 'danger', text: L('현재 입력으로 계산한 뒤 저장할 수 있습니다.', 'Run the calculation for the current inputs first.') })
      return null
    }
  }
  const askAi = async () => {
    const s = await snapshot(L('AI 질문용', 'For AI question'))
    if (!s) return
    const c = useCopilot.getState()
    c.open()
    await c.attachSnapshot(s.id, L('이 계산 결과의 초과 배압과 출력 손실을 설명해 줘.', 'Explain the excess back pressure and output loss in this result.'))
  }
  const restore = async (id: number) => {
    try {
      const p = await api(`/cases/${caseId}/snapshots/${id}/restore/`, { method: 'POST' })
      setInputs(p as never)
      await refreshResults()
      setMsg({ tone: 'muted', text: L('스냅샷의 입력값을 불러왔습니다. 다시 계산하세요.', 'Snapshot inputs loaded. Run again.') })
    } catch {
      setMsg({ tone: 'danger', text: L('불러오지 못했습니다.', 'Could not load.') })
    }
  }

  const metricFmt = (v: number) => (metric === 'paybackMonths' ? `${fmtNum(v, lang)} ${L('개월', 'mo')}` : fmtWon(v, lang).short)

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* 동작 막대 */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button type="button" className="btn-primary" onClick={() => run('all')} disabled={running}>
          <Icon name="refresh" size={15} className={running ? 'animate-spin' : ''} />
          {running ? L('계산 중…', 'Calculating…') : L('계산 실행', 'Calculate')}
        </button>
        <button type="button" className="btn-ghost" disabled={!perf || stale} onClick={async () => (await snapshot(L('계산기', 'Calculator'))) && toast('ok', L('스냅샷을 저장했습니다.', 'Snapshot saved.'))}>
          <Icon name="folder" size={15} />{L('스냅샷 저장', 'Save snapshot')}
        </button>
        <button type="button" className="btn-ghost" onClick={resetDefaults}>{L('기본값 초기화', 'Reset to defaults')}</button>
        <button type="button" className="btn-ghost" disabled={!perf || stale} onClick={askAi} title={L('현재 결과를 스냅샷으로 저장해 AI 도우미에 첨부합니다.', 'Saves the current result as a snapshot and attaches it in the AI assistant.')}>
          <Icon name="ai" size={15} />{L('이 결과 질문하기', 'Ask about this result')}
        </button>
        <button type="button" className="btn-ghost" disabled={!perf} onClick={() => window.open(`/report?case=${caseId}`, '_blank')} title={stale ? L('재평가 전 결과는 보고서에 경고와 함께 표시됩니다', 'Stale results are flagged in the report') : undefined}>
          <Icon name="copy" size={15} />PDF {L('보고서', 'report')}
        </button>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted">
          <ReliabilityBadge kind="DEMO" />
          {L('DEMO 계산 엔진', 'DEMO engine')} · {r?.performance ? fmtDateTime(r.performance.computed_at, lang) : L('계산 기록 없음', 'not run')}
          {dirty.length > 0 && <b className="text-accent-ink">· {L(`입력 ${dirty.length}개 변경`, `${dirty.length} inputs changed`)}</b>}
        </span>
        {(msg || runError) && <div className="w-full"><Notice tone={runError ? 'danger' : msg!.tone}>{runError ? runError.text[lang] : msg!.text}</Notice></div>}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="space-y-3">
          <InputsPanel
            sections={[
              { title: L('A. 설비 및 운전', 'A. Equipment & operation'), keys: ['turbineModel', 'capacityMW', 'loadFactor', 'currentBP', 'baselineBP', 'stackTempC', 'baselineStackTempC', 'operatingHoursMonth', 'hrsgDpKpa', 'ambientTempC'] },
              { title: L('B. 열역학', 'B. Thermodynamics'), group: 'thermo', open: false },
              { title: L('C. 경제성', 'C. Economics'), group: 'economics' },
              ...schema.methods.map((m) => ({ title: lang === 'ko' ? m.ko : m.en, keys: [`cost${m.key}`, `outageDays${m.key}`, `indirectCost${m.key}`, `recoveryMW${m.key}`], open: m.key === 'DryIce' })),
            ]}
          />
        </div>

        <div className="relative space-y-5">
          {!perf || !econ ? (
            <Card><Notice tone="muted">{L('왼쪽 입력을 확인하고 [계산 실행]을 누르세요. 모든 계산은 서버에서 합니다.', 'Check the inputs and press Calculate. All calculation runs on the server.')}</Notice></Card>
          ) : (
            <>
              {stale && <Notice tone="caution" icon="refresh">{L('입력이 바뀌어 아래 결과는 이전 입력 기준입니다 (흐리게 표시). [계산 실행]을 누르면 갱신됩니다.', 'Inputs changed; results below are for the previous inputs (dimmed). Calculate to refresh.')}</Notice>}
              <div className={stale ? 'pointer-events-none opacity-50 blur-[1px]' : ''}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
                  <Kpi label={L('현재 배압', 'Current BP')} v={perf.currentBP} rel={inputs?.sources.currentBP ?? undefined} digits={1} />
                  <Kpi label={L('초과 배압', 'Excess BP')} v={perf.excessBP} digits={1} />
                  <Kpi label={L('발전 출력 손실', 'Output loss')} v={perf.lossMW} digits={2} tone="accent" />
                  <Kpi label={L('월간 발전 손실액', 'Monthly loss')} v={perf.lossWonMonth} money />
                  <Kpi label={L('세정 예상 회수 출력', 'Expected recovery')} v={best?.recoveryMW ?? null} rel="DEMO" digits={2} />
                  <Kpi label={L('세정 투자 비용', 'Cleaning investment')} v={best?.initialCost} money sub={best && mName(best)} />
                  <Kpi label={L('월간 추가 편익', 'Monthly extra benefit')} v={best?.monthlyBenefit} money />
                  <Kpi label={L('순편익 (첫 1개월)', 'Net benefit (1st month)')} v={best?.firstMonthNet} money sub={L('누적 아님', 'not cumulative')} />
                  <Kpi label={L('투자 회수기간', 'Payback')} v={best?.paybackMonths} digits={2} tone="accent" />
                  <Kpi label={L('손익분기 일수', 'Break-even days')} v={best?.bepDays} digits={1} />
                </div>
                <p className="mt-2 text-xs text-muted">{L('공법별 값은 회수기간이 가장 짧은 공법 기준입니다 (가정 기준, 추천 아님). 다른 공법은 아래 비교표를 보세요.', 'Method values use the shortest-payback method (under assumptions, not a recommendation). See the table for others.')}</p>
                <div className="mt-3 space-y-2">
                  {[...perf.warnings, ...econ.warnings].map((w, i) => <Notice key={i} tone="caution">{w[lang]}</Notice>)}
                </div>
              </div>

              <div className={`grid gap-5 lg:grid-cols-2 ${stale ? 'opacity-50' : ''}`}>
                <Card title={L('배압 상태 · 세정 필요도', 'Back pressure · cleaning index')} icon="dashboard">
                  <div className="flex flex-wrap items-center justify-around gap-4">
                    <Gauge value={perf.gauge?.valueMM ?? perf.excessBP.value} max={perf.gauge?.maxMM ?? Math.max(200, Math.ceil(((perf.excessBP.value ?? 0) * 1.3) / 50) * 50)} band={perf.gauge?.refMM ?? perf.referenceBand.mmH2O}
                      label={L('초과 배압 mmH₂O', 'Excess BP mmH₂O')} valueText={fmtNum(perf.excessBP.value, lang, 1)}
                      bandLabel={L(`공개 참고 ${fmtNum(perf.referenceBand.mmH2O[0], lang, 1)}~${fmtNum(perf.referenceBand.mmH2O[1], lang, 1)}`, `Public ref ${fmtNum(perf.referenceBand.mmH2O[0], lang, 1)}–${fmtNum(perf.referenceBand.mmH2O[1], lang, 1)}`)} />
                    <div className="min-w-[180px]">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted">{L('세정 필요도 지수', 'Cleaning-need index')}<ReliabilityBadge kind="DEMO" /></div>
                      <div className="mt-1 text-3xl font-bold">{perf.cleaningScore.value === null ? '—' : fmtNum(perf.cleaningScore.value, lang, 1)}<span className="text-sm text-muted"> / 100</span></div>
                      <div className="mt-1 text-xs text-muted">{L('배압 기여', 'BP part')} {fmtNum(perf.cleaningScore.bpPart, lang, 1)} · {L('온도 기여', 'Temp part')} {perf.cleaningScore.tempPart === null ? '—' : fmtNum(perf.cleaningScore.tempPart, lang, 1)}</div>
                      {perf.cleaningScore.reason && <p className="mt-2 text-xs text-caution">{perf.cleaningScore.reason[lang]}</p>}
                      <p className="mt-2 text-[11px] text-faint">{perf.cleaningScore.note[lang]}</p>
                    </div>
                  </div>
                </Card>
                <Card title={L('배압-손실 곡선', 'Back pressure vs loss')} icon="analysis">
                  {perf.lossCurve ? (
                    <LineChart
                      ariaLabel={L('초과 배압에 따른 출력 손실', 'Output loss by excess back pressure')}
                      series={[{ id: 'loss', label: L('출력 손실 (DEMO)', 'Output loss (DEMO)'), color: 's1', area: true, points: perf.lossCurve }]}
                      xLabel={L('초과 배압 (mmH₂O)', 'Excess BP (mmH₂O)')} yLabel="MW" height={220}
                      fmtY={(y) => fmtNum(y, lang, 3)} fmtX={(x) => fmtNum(x, lang, 1)}
                      vLines={[{ x: perf.excessBP.value ?? 0, label: L('현재', 'Now') }]}
                    />
                  ) : <Notice tone="muted">{perf.lossMW.reason?.[lang]}</Notice>}
                </Card>
              </div>

              <Card title={L('세정 공법별 비교', 'Cleaning methods')} icon="beforeAfter" className={stale ? 'opacity-50' : ''}
                aside={<Tabs tabs={[{ id: 'paybackMonths' as const, label: L('회수기간', 'Payback') }, { id: 'initialCost' as const, label: L('총투자', 'Investment') }, { id: 'firstMonthNet' as const, label: L('첫 달 순편익', '1st-mo net') }]} value={metric} onChange={setMetric} />}>
                <BarChart
                  ariaLabel={L('공법별 비교', 'Method comparison')} unavailable={L('산출 불가', 'Not computable')} fmt={metricFmt}
                  bars={sorted.map((m) => ({ id: m.key, label: mName(m), value: m[metric].value, reason: (m.message ?? m[metric].reason)?.[lang]?.replace(/^산출 불가 — /, ''), color: colorOf(m.key), highlight: m.key === econ.shortestPayback }))}
                />
                <div className="-mx-5 mt-5 overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[760px] text-sm [&_td]:whitespace-nowrap">
                    <thead className="bg-sunken text-xs text-muted">
                      <tr>
                        {[L('공법', 'Method'), L('비용', 'Cost'), L('정지일수', 'Outage'), L('회수 출력', 'Recovery'), L('월간 편익', 'Monthly'), L('정지 손실', 'Outage cost'), L('총투자', 'Investment'), L('회수기간', 'Payback'), L('첫 달 순편익', '1st-mo net')].map((h) => (
                          <th key={h} className="px-3 py-2 text-right first:pl-5 first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((m) => (
                        <tr key={m.key} className="border-t border-line">
                          <td className="py-2 pl-5 pr-3 font-semibold">{mName(m)}{m.key === econ.shortestPayback && <span className="ml-1 text-[10px] text-accent-ink">● {L('최단', 'shortest')}</span>}</td>
                          {m.available === false ? <td colSpan={8} className="px-3 text-right text-xs text-muted" data-unavailable>{m.message?.[lang]}</td> : <>
                          <td className="px-3 text-right"><ValueText v={m.cost} money compact /></td>
                          <td className="px-3 text-right"><ValueText v={m.outageDays} digits={1} compact /></td>
                          <td className="px-3 text-right"><ValueText v={m.recoveryMW} compact /></td>
                          <td className="px-3 text-right"><ValueText v={m.monthlyBenefit} money compact /></td>
                          <td className="px-3 text-right"><ValueText v={m.outageCost} money compact /></td>
                          <td className="px-3 text-right"><ValueText v={m.initialCost} money compact /></td>
                          <td className="px-3 text-right font-semibold"><ValueText v={m.paybackMonths} compact /></td>
                          <td className="px-3 text-right"><ValueText v={m.firstMonthNet} money compact /></td>
                          </>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted">{econ.shortestNote[lang]} · {econ.doubleCountNote[lang]}</p>
              </Card>

              <Card title={L('민감도 분석 (회수기간)', 'Sensitivity (payback)')} icon="evaluation" className={stale ? 'opacity-50' : ''}
                aside={<Tabs tabs={[{ id: 'smp' as const, label: 'SMP' }, { id: 'hours' as const, label: L('운전시간', 'Hours') }]} value={sens} onChange={setSens} />}>
                <LineChart
                  ariaLabel={L('회수기간 민감도', 'Payback sensitivity')}
                  series={Object.entries(econ.sensitivity[sens].series).map(([k, ys]) => ({
                    id: k, label: mName(econ.methods.find((m) => m.key === k)!), color: colorOf(k), markers: true,
                    points: econ.sensitivity[sens].x.map((x, i) => ({ x, y: ys[i] })),
                  }))}
                  xLabel={sens === 'smp' ? 'SMP (원/kWh)' : L('월간 가동시간 (h)', 'Monthly hours (h)')} yLabel={L('개월', 'months')}
                  fmtY={(y) => fmtNum(y, lang, 2)}
                  vLines={[{ x: Number(sens === 'smp' ? inputs?.values.smpWonPerKWh : inputs?.values.operatingHoursMonth), label: L('현재 입력', 'Current') }]}
                  empty={L('회수기간을 계산할 수 있는 공법이 없습니다.', 'No method has a computable payback.')}
                />
              </Card>

              {pinch && (
                <Card title={L('핀치·어프로치 요약', 'Pinch / approach summary')} icon="flame" className={stale ? 'opacity-50' : ''}>
                  <div className="grid grid-cols-3 gap-3">
                    <Kpi label={L('포화온도 (IAPWS-IF97)', 'Tsat (IAPWS-IF97)')} v={pinch.saturationTempC} />
                    <Kpi label={L('핀치', 'Pinch')} v={pinch.pinch} digits={1} sub={pinch.design ? `${L('설계', 'design')} ${pinch.design.pinch_c} °C · DEMO ${pinch.ranges.demo.pinch.join('~')} °C` : `DEMO ${pinch.ranges.demo.pinch.join('~')} °C`} />
                    <Kpi label={L('어프로치', 'Approach')} v={pinch.approach} digits={1} sub={pinch.design ? `${L('설계', 'design')} ${pinch.design.approach_c} °C · DEMO ${pinch.ranges.demo.approach.join('~')} °C` : `DEMO ${pinch.ranges.demo.approach.join('~')} °C`} />
                  </div>
                  {pinch.warnings?.map((w, i) => <div key={i} className="mt-2"><Notice tone="caution">{w[lang]}</Notice></div>)}
                  {pinch.level === 'normal' && pinch.message && <div className="mt-2" data-pinch-message><Notice tone="muted">{pinch.message[lang]}</Notice></div>}
                </Card>
              )}

              <Card title={L('단계별 계산식', 'Step-by-step formulas')} icon="calculator">
                <Steps steps={[...perf.steps, ...econ.steps, ...(pinch?.steps ?? [])]} />
              </Card>
            </>
          )}

          <Card title={L('데이터 인벤토리', 'Data inventory')} icon="database" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>{[L('변수', 'Variable'), L('입력값', 'Value'), L('단위', 'Unit'), L('출처·신뢰성', 'Source'), L('실제 데이터 필요', 'Real data needed'), L('계산에 사용된 시점', 'Used at')].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {schema.fields.map((f) => {
                    const v = inputs?.values[f.key]
                    const src = inputs?.sources[f.key]
                    return (
                      <tr key={f.key} className="border-t border-line">
                        <td className="px-4 py-1.5"><div className="font-medium">{f.label[lang]}</div><code className="text-[11px] text-faint">{f.key}</code></td>
                        <td className="px-4 py-1.5 tabular-nums">{v === null || v === undefined ? '—' : typeof v === 'number' ? fmtNum(v, lang, 3) : v}</td>
                        <td className="px-4 py-1.5 text-muted">{unitLabel(f.unit)}</td>
                        <td className="px-4 py-1.5">{src ? <ReliabilityBadge kind={src} /> : <ReliabilityBadge kind="UNAVAILABLE" />}</td>
                        <td className="px-4 py-1.5 text-xs">{L('예 (실측·승인값 미제공)', 'Yes (no real data)')}</td>
                        <td className="px-4 py-1.5 text-xs text-muted">{r?.performance ? fmtDateTime(r.performance.computed_at, lang) : '—'}</td>
                      </tr>
                    )
                  })}
                  {schema.coefficients.map((c) => (
                    <tr key={c.key} className="border-t border-line bg-accent-soft/30">
                      <td className="px-4 py-1.5"><div className="font-medium">{c.label[lang]}</div><code className="text-[11px] text-faint">{c.where}</code></td>
                      <td className="px-4 py-1.5 tabular-nums">{String(c.value)}</td>
                      <td className="px-4 py-1.5 text-muted">—</td>
                      <td className="px-4 py-1.5"><ReliabilityBadge kind="DEMO" /></td>
                      <td className="px-4 py-1.5 text-xs">{L('예 (승인 모델 필요)', 'Yes (approved model needed)')}</td>
                      <td className="px-4 py-1.5 text-xs text-muted">{schema.engine_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={L('저장된 스냅샷', 'Saved snapshots')} icon="folder">
            {snaps.length === 0 ? <p className="text-sm text-muted">{L('저장된 스냅샷이 없습니다.', 'No snapshots.')}</p> : (
              <ul className="divide-y divide-line">
                {snaps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-semibold">{s.label || `#${s.id}`}</span>
                    <span className="text-xs text-muted">{fmtDateTime(s.created_at, lang)} · {s.mode} · {s.scenario}</span>
                    <span className="text-xs tabular-nums text-muted">{L('손실', 'Loss')} {fmtNum(s.summary.lossMW, lang, 3)} MW</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setCompareId(compareId === s.id ? null : s.id)}>{compareId === s.id ? L('비교 닫기', 'Close') : L('비교', 'Compare')}</button>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => restore(s.id)}>{L('불러오기', 'Load')}</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {compare?.values && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-sunken text-muted"><tr><th className="px-3 py-1.5 text-left">{L('입력', 'Input')}</th><th className="px-3 py-1.5 text-right">{compare.label || `#${compare.id}`}</th><th className="px-3 py-1.5 text-right">{L('현재 저장값', 'Current saved')}</th></tr></thead>
                  <tbody>
                    {schema.fields.filter((f) => String(compare.values![f.key]) !== String(inputs?.values[f.key])).map((f) => (
                      <tr key={f.key} className="border-t border-line"><td className="px-3 py-1">{f.label[lang]}</td><td className="px-3 py-1 text-right">{String(compare.values![f.key] ?? '—')}</td><td className="px-3 py-1 text-right font-semibold">{String(inputs?.values[f.key] ?? '—')}</td></tr>
                    ))}
                  </tbody>
                </table>
                {schema.fields.every((f) => String(compare.values![f.key]) === String(inputs?.values[f.key])) && <p className="p-3 text-xs text-muted">{L('입력값이 같습니다.', 'Inputs are identical.')}</p>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
