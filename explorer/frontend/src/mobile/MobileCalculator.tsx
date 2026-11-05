import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { isSnapshotList, type Economics, type Performance, type SnapshotSummary } from '../api/engine'
import Icon from '../components/Icon'
import { CaseDataGate } from '../components/InputsPanel'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Steps } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum, fmtWon } from '../lib/format'
import CalculatorPage from '../pages/CalculatorPage'
import { useApp } from '../store/app'
import { dirtyKeys, useCaseData } from '../store/caseData'
import { useCopilot } from '../store/copilot'
import { toast } from '../store/toast'
import { AsOf, MCard, MTitle } from './ui'

// 모바일 계산기: 결과 조회가 먼저. 계산은 PC 와 같은 서버 계산(evaluate)이며, 상세 입력·전체 결과는 아래 펼치기에서
// PC 계산기 화면을 그대로 씁니다 (계산 로직·입력 검증을 따로 만들지 않음).

export default function MobileCalculator() {
  return (
    <CaseDataGate>
      <Summary />
    </CaseDataGate>
  )
}

function Summary() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const { draft, inputs, results, running, run } = useCaseData()
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([])
  const [detail, setDetail] = useState(false)
  useEffect(() => {
    if (caseId !== null) api(`/cases/${caseId}/snapshots/`, {}, isSnapshotList).then(setSnaps).catch(() => setSnaps([]))
  }, [caseId, results?.last_calculated_at])
  if (!draft) return null
  const r = results?.results
  const perf = r?.performance?.payload as Performance | undefined
  const econ = r?.economics?.payload as Economics | undefined
  const dirty = dirtyKeys(draft, inputs)
  const stale = !!r?.performance && (r.performance.stale || !!r.economics?.stale || dirty.length > 0)
  const best = econ?.methods.find((m) => m.key === econ.shortestPayback)
  const v = inputs?.values ?? {}
  const askAi = async () => {
    try {
      const s = await api<SnapshotSummary>(`/cases/${caseId}/snapshots/`, { method: 'POST', json: { label: L('모바일 AI 질문용', 'Mobile AI question') } })
      const c = useCopilot.getState()
      c.open()
      await c.attachSnapshot(s.id, L('현재 발전 손실 계산 결과를 설명해 줘.', 'Explain the current output-loss result.'))
    } catch {
      toast('error', L('현재 입력으로 계산한 뒤 질문할 수 있습니다.', 'Run the calculation for the current inputs first.'))
    }
  }
  const cell = (label: string, value: string, rel?: string) => (
    <div className="rounded-xl bg-canvas p-3">
      <div className="flex items-start justify-between gap-1 text-[11px] text-muted">{label}{rel && <span className="text-[9.5px] font-bold text-accent-ink">{rel}</span>}</div>
      <div className="mt-0.5 break-words text-[20px] font-bold leading-tight tabular-nums text-ink">{value}</div>
    </div>
  )

  return (
    <div className="space-y-3" data-mobile-calculator>
      <div className="flex items-end justify-between gap-2">
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{L('계산 결과', 'Results')}</h1>
        <ReliabilityBadge kind={inputs?.mode === 'DEMO' ? 'DEMO' : 'USER_INPUT'} />
      </div>
      {stale && (
        <div className="flex items-start gap-2 rounded-xl border border-caution/30 bg-caution-soft px-3 py-2.5 text-[13px] text-caution" role="status" data-stale>
          <Icon name="alert" size={15} className="mt-px" /><span>{L('재평가 필요 — 입력이 바뀌어 아래 결과는 이전 입력 기준입니다.', 'Re-evaluation needed — results below are for previous inputs.')}</span>
        </div>
      )}
      <MCard>
        <MTitle icon="calculator">{L('주요 결과', 'Key results')}</MTitle>
        {!perf ? <p className="rounded-xl bg-canvas px-3 py-5 text-center text-[13px] text-muted">{L('아직 계산하지 않았습니다. [계산 실행]을 누르세요.', 'Not calculated yet. Tap Calculate.')}</p> : (
          <div className={`grid grid-cols-2 gap-2 ${stale ? 'opacity-60' : ''}`}>
            {cell(L('초과 배압', 'Excess BP'), perf.excessBP.value === null ? '—' : `${fmtNum(perf.excessBP.value, lang, 1)} mmH₂O`)}
            {cell(L('발전 출력 손실', 'Output loss'), perf.lossMW.value === null ? '—' : `${fmtNum(perf.lossMW.value, lang, 3)} MW`, 'DEMO')}
            {cell(L('월간 손실액', 'Monthly loss'), perf.lossWonMonth.value === null ? '—' : fmtWon(perf.lossWonMonth.value, lang).short, 'DEMO')}
            {cell(L('세정 필요도', 'Cleaning index'), perf.cleaningScore.value === null ? '—' : `${fmtNum(perf.cleaningScore.value, lang, 0)} / 100`, 'DEMO')}
            {best && cell(L('최단 회수기간', 'Shortest payback'), best.paybackMonths.value === null ? '—' : `${fmtNum(best.paybackMonths.value, lang, 2)} ${L('개월', 'mo')}`, best.name[lang])}
            {best && cell(L('손익분기', 'Break-even'), best.bepDays.value === null ? '—' : `${fmtNum(best.bepDays.value, lang, 1)} ${L('일', 'd')}`, L('가정', 'Assumption'))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><AsOf at={results?.last_calculated_at} label={L('계산', 'Computed')} />
          {perf && <span className="text-[11px] text-faint">{perf.notice[lang].slice(0, 40)}…</span>}</div>
      </MCard>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-primary min-h-[48px] justify-center" disabled={running} onClick={async () => { const ok = await run('all'); toast(ok ? 'ok' : 'error', ok ? L('계산했습니다.', 'Calculated.') : L('계산하지 못했습니다. 상세 입력에서 오류를 확인하세요.', 'Calculation failed — check the detailed inputs.')) }}>
          <Icon name="refresh" size={16} className={running ? 'animate-spin' : ''} />{running ? L('계산 중…', 'Calculating…') : L('계산 실행', 'Calculate')}
        </button>
        <button type="button" className="btn-ghost min-h-[48px] justify-center" disabled={!perf || stale} onClick={askAi}><Icon name="sparkles" size={16} className="text-accent" />{L('AI에게 질문', 'Ask AI')}</button>
      </div>

      <MCard>
        <MTitle icon="simulation">{L('입력 조건 요약', 'Inputs')}</MTitle>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          {([[L('현재 배압', 'Current BP'), `${v.currentBP ?? '—'} mmH₂O`], [L('기준 배압', 'Baseline BP'), `${v.baselineBP ?? '—'} mmH₂O`], [L('발전 용량', 'Capacity'), `${v.capacityMW ?? '—'} MW`],
            [L('부하율', 'Load'), `${v.loadFactor ?? '—'} %`], [L('스택 온도', 'Stack temp'), `${v.stackTempC ?? '—'} °C`], ['SMP', `${v.smpWonPerKWh ?? '—'} ${L('원/kWh', 'KRW/kWh')}`]] as [string, string][]).map(([a, b]) => (
            <div key={a}><dt className="text-[11px] text-faint">{a}</dt><dd className="font-semibold tabular-nums text-ink">{b}</dd></div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] text-faint">{L('입력 저장', 'Inputs saved')} {inputs?.updated_at ? fmtDateTime(inputs.updated_at, lang) : '—'} · {inputs?.mode === 'DEMO' ? L('DEMO 값', 'DEMO values') : L('사용자 입력', 'User input')}</p>
      </MCard>

      {perf && perf.steps.length > 0 && (
        <MCard>
          <MTitle icon="analysis">{L('계산 근거', 'Calculation steps')}</MTitle>
          <Steps steps={perf.steps} />
        </MCard>
      )}

      <MCard>
        <MTitle icon="folder">{L('결과 스냅샷', 'Snapshots')}</MTitle>
        {snaps.length === 0 ? <p className="text-[13px] text-muted">{L('저장된 스냅샷이 없습니다.', 'No snapshots.')}</p> : (
          <ul className="divide-y divide-line" data-snapshots>
            {snaps.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2.5 text-[13px]">
                <span className="min-w-0"><b className="text-ink">#{s.id}</b> <span className="text-muted">{s.label}</span><span className="block text-[11px] text-faint">{fmtDateTime(s.created_at, lang)}</span></span>
                <span className="shrink-0 text-right text-[12px] tabular-nums text-slate">{s.summary.lossMW ?? '—'} MW<span className="block text-[10px] text-faint">{L('출력 손실', 'loss')}</span></span>
              </li>
            ))}
          </ul>
        )}
      </MCard>

      <details className="rounded-2xl border border-line bg-surface shadow-card" open={detail} onToggle={(e) => setDetail((e.target as HTMLDetailsElement).open)}>
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-4 text-[14px] font-semibold text-ink">
          <Icon name="edit" size={16} className="text-accent" />{L('상세 입력·전체 계산 화면', 'Detailed inputs & full calculator')}
          <Icon name="chevronDown" size={16} className={`ml-auto text-faint transition-transform ${detail ? 'rotate-180' : ''}`} />
        </summary>
        {detail && <div className="border-t border-line p-3"><CalculatorPage /></div>}
      </details>
    </div>
  )
}
