import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { isSnapshotList, type Performance, type Reference, type Scenario, type SnapshotSummary } from '../api/engine'
import Gauge from '../components/charts/Gauge'
import HrsgDiagram from '../components/HrsgDiagram'
import Icon from '../components/Icon'
import InputsPanel, { CaseDataGate } from '../components/InputsPanel'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Kpi, Notice, StatusPill } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum } from '../lib/format'
import { useApp } from '../store/app'
import { toast } from '../store/toast'
import { AskAiButton } from '../components/chat/ChatThread'
import { PageActions } from '../components/shell'
import { dirtyKeys, effectiveScenario, useCaseData } from '../store/caseData'

const num = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))

export default function SimulationPage() {
  return (
    <CaseDataGate>
      <PageActions><AskAiButton page="simulation" question={['이 시나리오의 운전 상태와 평가 결과를 설명해 줘.', 'Explain the operating state and results of this scenario.']} /></PageActions>
      <Simulation />
    </CaseDataGate>
  )
}

function Simulation() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const { schema, draft, inputs, results, running, runError } = useCaseData()
  const { setMode, applyScenario, revertToSaved, run } = useCaseData()
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([])
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const loadSnaps = () => caseId !== null && api(`/cases/${caseId}/snapshots/`, {}, isSnapshotList).then(setSnaps).catch(() => setSnaps([]))
  useEffect(() => {
    loadSnaps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  if (!schema || !draft) return null
  const dirty = dirtyKeys(draft, inputs)
  const scenario: Scenario = effectiveScenario(draft, schema)
  const perfEntry = results?.results.performance
  const perf = perfEntry?.payload as Performance | undefined
  const ref = results?.results.reference?.payload as Reference | undefined
  const stale = !!perfEntry && (perfEntry.stale || dirty.length > 0)
  const presetChanged = draft.scenario !== 'CUSTOM' && scenario === 'CUSTOM'

  const saveSnapshot = async () => {
    setSaveMsg(null)
    try {
      await api(`/cases/${caseId}/snapshots/`, { method: 'POST', json: { label: L('시뮬레이션', 'Simulation') + ' · ' + (schema.scenarios.find((x) => x.id === scenario)?.label[lang] ?? L('직접 입력', 'Custom')) } })
      setSaveMsg(L('결과를 스냅샷으로 저장했습니다.', 'Saved as a snapshot.'))
      toast('ok', L('스냅샷을 저장했습니다.', 'Snapshot saved.'))
      loadSnaps()
    } catch {
      setSaveMsg(L('현재 입력으로 평가한 뒤 저장할 수 있습니다.', 'Run the evaluation for the current inputs first.'))
    }
  }

  const prev = snaps[0]
  const statusTone = perf?.status.code === 'TRIP' ? 'danger' : perf?.status.code === 'ALARM' ? 'caution' : perf?.status.code === 'UNKNOWN' ? 'unknown' : 'neutral'
  const recovery = ref?.recovery?.output_loss_mw

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ---------------- 조건 설정 */}
      <div className="space-y-4">
        <Card title={L('평가 모드 · 시나리오', 'Mode · scenario')} icon="simulation">
          <div className="mb-4 flex gap-1 rounded-xl bg-sunken p-1 text-sm font-semibold" role="group" aria-label={L('평가 모드', 'Mode')}>
            {(['DEMO', 'USER'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={draft.mode === m} onClick={() => setMode(m)}
                className={`flex-1 rounded-lg px-3 py-2 transition-all ${draft.mode === m ? 'bg-surface text-accent-ink shadow-card' : 'text-muted hover:text-ink'}`}>
                {m === 'DEMO' ? 'DEMO' : L('사용자 입력', 'User input')}
              </button>
            ))}
          </div>
          {draft.mode === 'USER' && (
            <div className="mb-3">
              <Notice tone="muted">{L('사용자 입력 모드는 검증된 성능 모델이 있어야 결과를 냅니다. 현재는 모델이 연동되지 않아 운전 상태·출력 손실을 "모델 미연동"으로 표시합니다.', 'User mode needs a validated performance model. None is connected, so status and loss show "model not connected".')}</Notice>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[...schema.scenarios, null].map((sc) => {
              const id = (sc?.id ?? 'CUSTOM') as Scenario
              const active = scenario === id
              return (
                <button key={id} type="button" disabled={!sc || draft.mode !== 'DEMO'} onClick={() => sc && applyScenario(sc.id)} aria-pressed={active}
                  className={`relative rounded-xl border p-3 text-left transition-all disabled:cursor-default ${active ? 'border-accent bg-accent-soft shadow-card ring-1 ring-accent/30' : 'border-line bg-surface enabled:hover:-translate-y-0.5 enabled:hover:border-[rgb(var(--peach))] enabled:hover:shadow-card'} ${!sc ? 'opacity-90' : ''}`}>
                  {active && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />}
                  <div className="text-[13px] font-bold">{sc ? sc.label[lang] : 'Custom'}</div>
                  <div className="mt-1.5">
                    {sc ? <StatusPill code={sc.status as 'NORMAL'} label={sc.status_label} /> : <span className="text-[11px] text-muted">{L('직접 입력', 'Your values')}</span>}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] text-faint">{schema.scenario_note[lang]}</p>
        </Card>

        <InputsPanel
          sections={[
            { title: L('가스터빈·운전 조건', 'Gas turbine & operation'), keys: ['turbineModel', 'capacityMW', 'loadFactor', 'currentBP', 'baselineBP', 'operatingHoursMonth', 'ambientTempC'] },
            { title: L('HRSG 측정값', 'HRSG measurements'), keys: ['hrsgDpKpa', 'hrsgDpCleanKpa', 'hrsgDpPostKpa', 'stackTempC', 'baselineStackTempC'] },
            { title: L('열역학 (드럼·온도)', 'Thermodynamics'), group: 'thermo', open: false },
            { title: L('세정 비용·SMP', 'Cleaning cost & SMP'), keys: ['smpWonPerKWh', 'targetRecoveryMW', 'costDryIce', 'outageDaysDryIce'], open: false },
          ]}
        />

        <div className="card sticky bottom-3 z-10 flex flex-wrap items-center gap-2 p-3 shadow-pop">
          <button type="button" className="btn-primary" onClick={() => run('all')} disabled={running}>
            <Icon name="refresh" size={15} className={running ? 'animate-spin' : ''} />
            {running ? L('평가 실행 중…', 'Running…') : L('평가 실행', 'Run evaluation')}
          </button>
          {presetChanged && draft.scenario !== 'CUSTOM' && (
            <button type="button" className="btn-ghost" onClick={() => applyScenario(draft.scenario as 'NORMAL')}>{L('시나리오 값 복원', 'Restore preset')}</button>
          )}
          {dirty.length > 0 && <button type="button" className="btn-ghost" onClick={revertToSaved}>{L('저장된 값으로', 'Revert')}</button>}
          <span className="ml-auto text-xs font-medium text-muted">
            {dirty.length > 0 ? L(`조건 ${dirty.length}개 변경됨`, `${dirty.length} changed`) : L('저장된 입력과 같음', 'Matches saved inputs')}
          </span>
          {runError && <div className="w-full"><Notice tone="danger">{runError.text[lang]}</Notice></div>}
        </div>
      </div>

      {/* ---------------- 결과 */}
      <div className="space-y-4">
        <Card title={L('핵심 결과', 'Key results')} icon="dashboard"
          aside={perfEntry && <span className="text-xs text-muted">{L('계산', 'Computed')} {fmtDateTime(perfEntry.computed_at, lang)}</span>}>
          {!perf ? (
            <Notice tone="muted">{L('아직 평가하지 않았습니다. 시나리오를 고르거나 값을 넣고 [평가 실행]을 누르세요.', 'Not evaluated yet. Pick a scenario or enter values, then Run.')}</Notice>
          ) : (
            <div className="relative">
              {stale && (
                <div className="absolute inset-0 z-10 flex items-start justify-center rounded-xl bg-surface/60 pt-10 backdrop-blur-[2px]">
                  <div className="card max-w-sm p-4 text-center shadow-pop">
                    <ReliabilityBadge kind="REEVALUATION_REQUIRED" />
                    <p className="mt-2 text-sm">{L('입력이 바뀌어 이전 결과를 현재 결과로 볼 수 없습니다. [평가 실행]을 누르세요. 이전 스냅샷은 그대로 보관됩니다.', 'Inputs changed, so the previous result is not current. Run again. Saved snapshots are kept.')}</p>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill code={perf.status.code} label={perf.status.label} large />
                <ReliabilityBadge kind={perf.status.rel} />
                <span className="text-xs text-muted">{perf.status.reason[lang]}</span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="flex flex-col items-center justify-center rounded-xl border border-line p-3">
                  <Gauge value={perf.gauge?.valueMM ?? perf.excessBP.value} max={perf.gauge?.maxMM ?? Math.max(200, Math.ceil(((perf.excessBP.value ?? 0) * 1.3) / 50) * 50)} band={perf.gauge?.refMM ?? perf.referenceBand.mmH2O}
                    label={L('초과 배압 (mmH₂O)', 'Excess BP (mmH₂O)')} valueText={fmtNum(perf.excessBP.value, lang, 0)}
                    bandLabel={L('참고 3~4 inH₂O', 'Ref. 3–4 inH₂O')} tone={statusTone} />
                  <p className="mt-1 text-center text-[10px] text-faint">{perf.referenceBand.note[lang]}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Kpi label={L('현재 배압', 'Current BP')} v={perf.currentBP} rel={inputs?.sources.currentBP ?? undefined} digits={1} />
                  <Kpi label={L('기준 초과분', 'Excess over baseline')} v={perf.excessBP} digits={1} sub={`= ${fmtNum(perf.excessBP_inH2O.value, lang)} inH₂O`} />
                  <Kpi label={L('예상 성능 손실', 'Expected output loss')} v={perf.lossMW} digits={3} />
                  <Kpi label={L('월간 손실액', 'Monthly loss')} v={perf.lossWonMonth} money />
                  <div className="col-span-2 rounded-xl border border-line p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-muted">{L('세정 회복 효과 (공개 문헌 참고 범위)', 'Cleaning recovery (literature range)')}</span>
                      <ReliabilityBadge kind={recovery ? 'PUBLIC_REF' : 'UNAVAILABLE'} />
                    </div>
                    <div className="mt-2 text-xl font-bold">
                      {recovery && recovery.low.value !== null
                        ? `${fmtNum(recovery.low.value, lang)} ~ ${fmtNum(recovery.high.value, lang)} MW`
                        : <span className="text-sm font-normal text-muted">{ref?.recovery_reason?.[lang] ?? L('HRSG 차압 입력 후 평가하면 표시됩니다.', 'Enter HRSG ΔP and run.')}</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-faint">{L('GE GER-3567H ~ IST 2000 계수를 차압 감소분에 비례 적용 — 이 설비의 예측 아님', 'GE GER-3567H to IST 2000 factors scaled to the ΔP reduction — not a forecast for this plant')}</p>
                  </div>
                </div>
              </div>
              {perf.warnings.map((w, i) => <div key={i} className="mt-3"><Notice tone="caution">{w[lang]}</Notice></div>)}
            </div>
          )}
        </Card>

        <Card title={L('HRSG 도식', 'HRSG diagram')} icon="flame">
          <HrsgDiagram
            values={{ currentBP: num(draft.values.currentBP), hrsgDpKpa: num(draft.values.hrsgDpKpa), stackTempC: num(draft.values.stackTempC),
                      drumPressureBar: num(draft.values.drumPressureBar), evaGasTempC: num(draft.values.evaOutletGasTempC),
                      ecoWaterTempC: num(draft.values.ecoOutletWaterTempC), status: stale ? 'UNKNOWN' : perf?.status.code }}
            note={L('지금 입력한 값 기준입니다 (저장 전 값 포함). 오염 표시는 평가된 시나리오 상태를 따릅니다.', 'Shows current inputs (including unsaved). Fouling follows the evaluated scenario status.')}
          />
        </Card>

        <Card title={L('이전 결과 비교', 'Compare with previous')} icon="clock"
          aside={<button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={saveSnapshot} disabled={!perf || stale}>{L('결과 저장', 'Save result')}</button>}>
          {saveMsg && <div className="mb-3"><Notice tone="muted">{saveMsg}</Notice></div>}
          {!prev ? (
            <p className="text-sm text-muted">{L('저장된 스냅샷이 없습니다. [결과 저장]을 누르면 지금 결과가 비교 기준이 됩니다.', 'No snapshots yet. Save a result to compare later.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">{L('항목', 'Item')}</th><th className="py-1.5 text-right">{prev.label || `#${prev.id}`}<div className="font-normal">{fmtDateTime(prev.created_at, lang)}</div></th><th className="py-1.5 text-right">{L('현재', 'Current')}</th></tr></thead>
              <tbody>
                {[
                  [L('초과 배압 (mmH₂O)', 'Excess BP (mmH₂O)'), prev.summary.excessBP, perf?.excessBP.value],
                  [L('출력 손실 (MW)', 'Output loss (MW)'), prev.summary.lossMW, perf?.lossMW.value],
                  [L('세정 필요도', 'Cleaning index'), prev.summary.cleaningScore, perf?.cleaningScore.value],
                ].map(([label, a, b]) => (
                  <tr key={String(label)} className="border-t border-line">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtNum(a as number | null, lang, 3)}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${stale ? 'opacity-40' : ''}`}>{fmtNum((b as number | null) ?? null, lang, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link to="/analysis?tab=economics" className="mt-3 inline-block text-sm font-semibold text-accent-ink hover:underline">{L('심층 분석에서 경제성까지 보기 →', 'Open economics in Analysis →')}</Link>
        </Card>
      </div>
    </div>
  )
}
