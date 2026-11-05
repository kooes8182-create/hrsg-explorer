import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { isMeasurementList, type Comparison, type Measurement, type Point } from '../api/engine'
import type { Bilingual } from '../api/types'
import LineChart from '../components/charts/LineChart'
import Icon from '../components/Icon'
import { CaseDataGate } from '../components/InputsPanel'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Kpi, Notice, Tabs } from '../components/ui'
import { useL } from '../i18n'
import { fmtNum, fmtWon } from '../lib/format'
import { useApp } from '../store/app'
import { dirtyKeys, useCaseData } from '../store/caseData'
import { toast } from '../store/toast'
import { AskAiButton } from '../components/chat/ChatThread'
import { PageActions } from '../components/shell'
import { PageSkeleton } from '../components/feedback'

type Metric = 'backPressure' | 'stackTempC' | 'lossMW' | 'cumulativeNet'
const EMPTY = { dayOffset: '', backPressure: '', stackTempC: '', loadFactor: '', ambientTempC: '', measuredOn: '', memo: '' }
type Form = typeof EMPTY

export default function BeforeAfterPage() {
  return (
    <CaseDataGate>
      <PageActions><AskAiButton page="before-after" question={['세정 전후 비교값과 회수 출력, 누적 순편익을 해석해 줘.', 'Interpret the before/after values, recovered output and cumulative net benefit.']} /></PageActions>
      <BeforeAfter />
    </CaseDataGate>
  )
}

function BeforeAfter() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const { results, refreshResults, draft, inputs } = useCaseData()
  const [rows, setRows] = useState<Measurement[]>([])
  const [form, setForm] = useState<Form>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, Bilingual>>({})
  const [busy, setBusy] = useState(false)
  const [metric, setMetric] = useState<Metric>('backPressure')

  const comp = results?.results.comparison?.payload as Comparison | undefined
  const stale = !!results?.results.comparison?.stale

  /** 실측값이 바뀌면 서버에서 세정 전후 비교를 다시 계산합니다. */
  const reload = useCallback(async () => {
    if (caseId === null) return
    const list = await api(`/cases/${caseId}/measurements/`, {}, isMeasurementList)
    setRows(list)
    await api(`/cases/${caseId}/evaluate/comparison/`, { method: 'POST' })
    await refreshResults()
  }, [caseId, refreshResults])

  useEffect(() => {
    reload().catch(() => undefined)
  }, [reload])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : k === 'memo' || k === 'measuredOn' ? v : Number(v)]))
    try {
      await api(editId ? `/cases/${caseId}/measurements/${editId}/` : `/cases/${caseId}/measurements/`, { method: editId ? 'PATCH' : 'POST', json: body })
      setForm(EMPTY)
      setEditId(null)
      toast('ok', editId ? L('실측값을 수정했습니다.', 'Measurement updated.') : L('실측값을 추가했습니다.', 'Measurement added.'))
      await reload()
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, Array.isArray(v) ? { ko: v[0], en: v[0] } : v])))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: number) => {
    if (!window.confirm(L('이 실측값을 삭제할까요? 되돌릴 수 없습니다.', 'Delete this measurement? This cannot be undone.'))) return
    await api(`/cases/${caseId}/measurements/${id}/`, { method: 'DELETE' })
    if (editId === id) {
      setEditId(null)
      setForm(EMPTY)
    }
    await reload()
  }
  const edit = (m: Measurement) => {
    setEditId(m.id)
    setForm({ dayOffset: String(m.dayOffset), backPressure: String(m.backPressure), stackTempC: m.stackTempC?.toString() ?? '', loadFactor: m.loadFactor?.toString() ?? '',
              ambientTempC: m.ambientTempC?.toString() ?? '', measuredOn: m.measuredOn ?? '', memo: m.memo })
  }

  const yUnit: Record<Metric, string> = { backPressure: 'mmH₂O', stackTempC: '°C', lossMW: 'MW', cumulativeNet: L('원', 'KRW') }
  const fmtY = (y: number) => (metric === 'cumulativeNet' ? fmtWon(y, lang).short : fmtNum(y, lang, metric === 'lossMW' ? 3 : 1))
  const virtual: Point[] = (comp?.virtual[metric] as Point[] | null) ?? []
  const measured: Point[] = (comp?.measured[metric] as Point[] | null | undefined) ?? []
  const bep = comp?.virtualBepDays ?? null

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {dirtyKeys(draft, inputs).length > 0 && <Notice tone="caution">{L('계산기에 저장하지 않은 입력이 있습니다. 세정 전후 비교는 저장된 입력값을 씁니다.', 'There are unsaved calculator inputs; this page uses saved inputs.')}</Notice>}
      {!comp ? <PageSkeleton variant="cards" /> : (
        <>
          <div className={`grid grid-cols-2 gap-3 lg:grid-cols-6 ${stale ? 'opacity-50' : ''}`}>
            <Kpi label={L('세정 전 배압 (평균)', 'BP before (avg)')} v={comp.kpi?.backPressureBefore ?? null} rel={comp.kpi ? 'MEASURED' : 'UNAVAILABLE'} digits={1} />
            <Kpi label={L('세정 후 배압 (최근)', 'BP after (latest)')} v={comp.kpi?.backPressureAfter ?? null} rel={comp.kpi ? 'MEASURED' : 'UNAVAILABLE'} digits={1}
              sub={comp.kpi?.backPressureAfter.day !== undefined ? `D+${comp.kpi.backPressureAfter.day}` : undefined} />
            <Kpi label={L('배압 변화', 'BP change')} v={comp.kpi?.backPressureChange ?? null} digits={1} rel={comp.kpi ? 'MEASURED' : 'UNAVAILABLE'} />
            <Kpi label={L('스택 온도 변화', 'Stack temp change')} v={comp.kpi?.stackTempChange ?? null} digits={1} />
            <Kpi label={L('회수 출력 (실측 → DEMO 환산)', 'Recovered (measured → DEMO)')} v={comp.kpi?.recoveryMW ?? null} digits={3} />
            <Kpi label={L('누적 순편익 (최근일까지)', 'Cumulative net (to date)')} v={comp.kpi?.cumulativeNet ?? null} money />
          </div>
          {comp.kpiReason && <Notice tone="muted">{comp.kpiReason[lang]} {L('아래에서 실측값을 추가하세요. 실측이 없으면 가상 시나리오(점선)만 표시합니다.', 'Add measurements below. Without them only the virtual scenario (dashed) is shown.')}</Notice>}
          {comp.deviation?.exceeded && (
            <Notice tone="danger">
              <b>{comp.deviation.message?.[lang]}</b>{' '}
              {L(`부하율 차이 ${fmtNum(comp.deviation.loadDiffPP, lang)}%p (기준 ${comp.deviation.limits.loadPP}%p), 외기 온도 차이 ${fmtNum(comp.deviation.ambientDiffC, lang)} °C (기준 ${comp.deviation.limits.ambientC} °C)`,
                `Load diff ${fmtNum(comp.deviation.loadDiffPP, lang)} pp (limit ${comp.deviation.limits.loadPP}), ambient diff ${fmtNum(comp.deviation.ambientDiffC, lang)} °C (limit ${comp.deviation.limits.ambientC})`)}
              {' · '}{comp.deviation.note[lang]}
            </Notice>
          )}
          {comp.deviation && !comp.deviation.exceeded && comp.deviation.missing && <Notice tone="muted">{L('부하율 또는 외기 온도 실측이 없어 운전 조건 편차를 확인하지 못했습니다.', 'Load or ambient measurements missing — condition deviation not checked.')}</Notice>}
          {comp.warnings.map((w, i) => <Notice key={i} tone="caution">{w[lang]}</Notice>)}

          <Card title={L('세정 전후 추이 (D-30 ~ D+60)', 'Before/after trend (D-30 – D+60)')} icon="beforeAfter"
            aside={<Tabs tabs={[{ id: 'backPressure' as const, label: L('배압', 'BP') }, { id: 'stackTempC' as const, label: L('스택 온도', 'Stack') }, { id: 'lossMW' as const, label: L('출력 손실', 'Loss') }, { id: 'cumulativeNet' as const, label: L('누적 순편익', 'Cumulative') }]} value={metric} onChange={setMetric} />}>
            <LineChart
              ariaLabel={L('세정 전후 추이', 'Before/after trend')}
              series={[
                { id: 'v', label: L('가상 시나리오 (DEMO 가정)', 'Virtual scenario (DEMO)'), color: 'muted', dashed: true, points: virtual },
                { id: 'm', label: L('사용자 실측', 'Measured'), color: 's1', markers: true, area: true, points: measured },
              ]}
              xLabel={L('세정 후 경과일 (D)', 'Days from cleaning (D)')} yLabel={yUnit[metric]} fmtX={(x) => (x > 0 ? `+${x}` : String(x))} fmtY={fmtY}
              vLines={[{ x: 0, label: L('세정 D0', 'Cleaning D0') }, ...(metric === 'cumulativeNet' && bep !== null && bep <= 60 ? [{ x: Math.round(bep), label: `BEP D+${fmtNum(bep, lang, 1)}` }] : [])]}
              refLines={metric === 'cumulativeNet' ? [{ y: 0, label: L('손익분기', 'Break-even') }] : []}
              empty={L('표시할 값이 없습니다 (기준 스택 온도 등 입력 필요).', 'Nothing to show (e.g. baseline stack temperature needed).')}
            />
            <p className="mt-2 text-xs text-muted">{comp.virtual.assumption[lang]}</p>
            {metric === 'cumulativeNet' && (
              <p className="mt-1 text-xs text-muted">
                {L('기준 공법', 'Method')}: <b>{comp.methodName?.[lang] ?? '—'}</b> · {L('초기 비용', 'Initial cost')} {fmtWon(comp.initialCost.value, lang).short}
                {bep !== null && <> · {L('가상 BEP', 'Virtual BEP')} D+{fmtNum(bep, lang, 1)} {bep > 60 && L('(그래프 범위 밖)', '(beyond chart)')}</>}
                {comp.actualPerformanceGap?.bepAchieved !== null && comp.actualPerformanceGap && <> · {L('실측 기준 손익분기 도달', 'Measured break-even reached')}: <b>{comp.actualPerformanceGap.bepAchieved ? L('예', 'yes') : L('아니요', 'no')}</b></>}
              </p>
            )}
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title={editId ? L('실측값 수정', 'Edit measurement') : L('실측값 추가', 'Add measurement')} icon="edit" aside={<ReliabilityBadge kind="MEASURED" />}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
            {([
              ['dayOffset', L('경과일 D (세정 전은 음수)', 'Day D (negative = before)'), L('일', 'd'), true],
              ['backPressure', L('배압', 'Back pressure'), 'mmH₂O', true],
              ['stackTempC', L('스택 온도', 'Stack temp'), '°C', false],
              ['loadFactor', L('운전 부하율', 'Load factor'), '%', false],
              ['ambientTempC', L('외기 온도', 'Ambient'), '°C', false],
            ] as const).map(([k, label, unit, req]) => (
              <div key={k}>
                <label className="label" htmlFor={`m-${k}`}>{label}{req && <span className="text-danger"> *</span>}</label>
                <div className="relative">
                  <input id={`m-${k}`} inputMode="decimal" className={`input pr-14 ${errors[k] ? 'border-danger' : ''}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">{unit}</span>
                </div>
                {errors[k] && <p className="mt-1 text-[11px] text-danger">{errors[k][lang]}</p>}
              </div>
            ))}
            <div>
              <label className="label" htmlFor="m-date">{L('측정 날짜', 'Date')}</label>
              <input id="m-date" type="date" className="input" value={form.measuredOn} onChange={(e) => setForm({ ...form, measuredOn: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="m-memo">{L('메모', 'Memo')}</label>
              <input id="m-memo" className="input" maxLength={200} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
            </div>
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy}><Icon name={editId ? 'check' : 'plus'} size={15} />{editId ? L('저장', 'Save') : L('추가', 'Add')}</button>
              {editId && <button type="button" className="btn-ghost" onClick={() => { setEditId(null); setForm(EMPTY); setErrors({}) }}>{L('취소', 'Cancel')}</button>}
            </div>
            <p className="col-span-2 text-[11px] text-faint">{L('부하율 허용 범위 30~105% (DEMO 입력 규격). 스택 온도 300 °C 초과는 DEMO 경고 임계값으로 경고만 합니다 (트립 기준 아님).', 'Load 30–105% (DEMO spec). Stack temperature above 300 °C triggers a DEMO warning only (not a trip limit).')}</p>
          </form>
        </Card>
        <Card title={L(`실측 기록 (${rows.length})`, `Measurements (${rows.length})`)} icon="database" bodyClass="p-0">
          {rows.length === 0 ? <p className="p-5 text-sm text-muted">{L('입력한 실측값이 없습니다. 가상 값은 실측으로 표시하지 않습니다.', 'No measurements. Virtual values are never shown as measured.')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-sunken text-xs text-muted">
                  <tr>{['D', L('배압', 'BP'), L('스택', 'Stack'), L('부하', 'Load'), L('외기', 'Amb.'), L('날짜', 'Date'), ''].map((h, i) => <th key={i} className="px-3 py-2 text-right first:pl-5 first:text-left">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className={`border-t border-line ${editId === m.id ? 'bg-accent-soft/40' : ''}`}>
                      <td className="py-1.5 pl-5 font-semibold tabular-nums">{m.dayOffset > 0 ? `+${m.dayOffset}` : m.dayOffset}</td>
                      <td className="px-3 text-right tabular-nums">{fmtNum(m.backPressure, lang, 1)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtNum(m.stackTempC, lang, 1)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtNum(m.loadFactor, lang, 1)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtNum(m.ambientTempC, lang, 1)}</td>
                      <td className="px-3 text-right text-xs text-muted">{m.measuredOn ?? '—'}</td>
                      <td className="px-3 text-right">
                        <button type="button" className="btn-icon" aria-label={L('수정', 'Edit')} onClick={() => edit(m)}><Icon name="edit" size={15} /></button>
                        <button type="button" className="btn-icon hover:text-danger" aria-label={L('삭제', 'Delete')} onClick={() => remove(m.id)}><Icon name="trash" size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
