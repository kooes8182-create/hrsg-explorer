import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Economics, Overview, Performance, Pinch, Reference, ResultsPayload, Schema, Source } from '../api/engine'
import type { Case } from '../api/types'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum, fmtWon, unitLabel } from '../lib/format'
import { useApp } from '../store/app'

// PDF 분석 보고서: 서버 값만 인쇄용으로 배치합니다 (계산 없음). 브라우저 인쇄 → 'PDF로 저장'.
// 필수 포함: DEMO 표시, 입력 조건, 계산 가정, 출처, 제한사항 (프롬프트 11-9)
export default function ReportPage() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [params] = useSearchParams()
  const prefCase = useApp((s) => s.currentCaseId)
  const caseId = Number(params.get('case')) || prefCase
  const [d, setD] = useState<{ c: Case; o: Overview; r: ResultsPayload; s: Schema; src: Source[] } | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    // 인쇄는 항상 밝은 테마로
    const html = document.documentElement
    const wasDark = html.classList.contains('dark')
    html.classList.remove('dark')
    return () => {
      if (wasDark) html.classList.add('dark')
    }
  }, [])
  useEffect(() => {
    if (!caseId) return setErr(true)
    Promise.all([
      api<Case>(`/cases/${caseId}/`), api<Overview>(`/cases/${caseId}/overview/`), api<ResultsPayload>(`/cases/${caseId}/results/`),
      api<Schema>('/inputs/schema/'), api<{ sources: Source[] }>('/public/sources/'),
    ]).then(([c, o, r, s, src]) => setD({ c, o, r, s, src: src.sources })).catch(() => setErr(true))
  }, [caseId])

  if (err) return <p className="p-8 text-sm text-danger">{L('보고서를 만들 수 없습니다 (케이스를 확인하세요).', 'Cannot build the report (check the case).')}</p>
  if (!d) return <p className="p-8 text-sm text-muted">{L('불러오는 중…', 'Loading…')}</p>
  const { c, o, r, s, src } = d
  const perf = r.results.performance?.payload as Performance | undefined
  const econ = r.results.economics?.payload as Economics | undefined
  const pinch = r.results.pinch?.payload as Pinch | undefined
  const ref = r.results.reference?.payload as Reference | undefined
  const stale = Object.entries(r.results).some(([k, x]) => k !== 'comparison' && x?.stale)
  const n = (v: number | null | undefined, digits = 3) => fmtNum(v ?? null, lang, digits)
  const h2 = 'mt-6 mb-2 border-b-2 border-ink pb-1 text-base font-bold break-after-avoid'

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[12px] leading-relaxed text-black print:p-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <button type="button" className="btn-primary" onClick={() => window.print()}>{L('PDF로 저장 (인쇄)', 'Save as PDF (print)')}</button>
        <button type="button" className="btn-ghost" onClick={() => window.close()}>{L('닫기', 'Close')}</button>
        <span className="self-center text-xs text-muted">{L('인쇄 창에서 대상: "PDF로 저장"을 고르세요.', 'Choose "Save as PDF" in the print dialog.')}</span>
      </div>

      <div className="rounded border-2 border-dashed border-[#ea6c1a] px-3 py-2 text-center font-bold text-[#b44806]">
        DEMO — {L('가상 데이터와 DEMO 계수로 만든 보고서입니다. 실제 발전소 운전·안전 판단에 사용하지 마세요.', 'Built from virtual data and DEMO coefficients. Not for real plant operation or safety decisions.')}
      </div>
      <h1 className="mt-4 text-xl font-bold">HRSG Explorer — {L('성능·경제성 분석 보고서', 'Performance & Economics Report')}</h1>
      <p className="text-[11px] text-gray-600">
        {L('케이스', 'Case')}: <b>{c.name}</b> · {L('평가 모드', 'Mode')}: {o.mode} · {L('시나리오', 'Scenario')}: {o.scenario} · {L('계산 엔진', 'Engine')}: {s.engine_version} ·{' '}
        {L('마지막 계산', 'Last calc')}: {fmtDateTime(r.last_calculated_at, lang)} · {L('작성', 'Generated')}: {new Date().toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US')}
      </p>
      {stale && <p className="mt-2 rounded bg-[#fef3d6] px-2 py-1 font-semibold text-[#8a5a00]">{L('주의: 입력이 바뀐 뒤 재평가하지 않은 결과가 있습니다. 아래 값은 이전 입력 기준일 수 있습니다.', 'Warning: some results were not re-evaluated after inputs changed.')}</p>}

      <h2 className={h2}>1. {L('요약', 'Summary')}</h2>
      <table className="w-full border-collapse">
        <tbody>
          {o.kpis.map((k) => (
            <tr key={k.key} className="border-b border-gray-200">
              <td className="py-1 pr-2">{k.label[lang]}</td>
              <td className="py-1 text-right font-semibold">
                {k.value === null ? (k.reason?.[lang] ?? '—') : Array.isArray(k.value) ? `${n(k.value[0], 2)} ~ ${n(k.value[1], 2)} ${k.unit}` : k.unit === '원' ? fmtWon(k.value, lang).full : `${n(k.value, 3)} ${unitLabel(k.unit)}`}
              </td>
              <td className="py-1 pl-2 text-[10px] text-gray-500">{k.rel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px]">{L('운전 상태', 'Status')}: <b>{o.status.label[lang]}</b> — {o.status.reason[lang]}</p>

      <h2 className={h2}>2. {L('입력 조건', 'Inputs')}</h2>
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="border-b border-gray-400 text-left"><th className="py-1">{L('항목', 'Field')}</th><th className="py-1 text-right">{L('값', 'Value')}</th><th className="py-1 pl-2">{L('단위', 'Unit')}</th><th className="py-1 pl-2">{L('출처', 'Source')}</th></tr></thead>
        <tbody>
          {s.fields.map((f) => (
            <tr key={f.key} className="border-b border-gray-100">
              <td className="py-0.5">{f.label[lang]}</td>
              <td className="py-0.5 text-right">{o.values[f.key] === null || o.values[f.key] === undefined ? '—' : String(o.values[f.key])}</td>
              <td className="py-0.5 pl-2">{unitLabel(f.unit)}</td>
              <td className="py-0.5 pl-2 text-gray-500">{o.sources[f.key] ?? L('비어 있음', 'empty')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={h2}>3. {L('계산 결과', 'Results')}</h2>
      {perf && (
        <p>{L('초과 배압', 'Excess BP')} {n(perf.excessBP.value, 1)} mmH₂O ({n(perf.excessBP_inH2O.value, 2)} inH₂O) · {L('출력 손실', 'Output loss')} {perf.lossMW.value === null ? perf.lossMW.reason?.[lang] : `${n(perf.lossMW.value)} MW`} ·{' '}
          {L('월간 손실액', 'Monthly loss')} {perf.lossWonMonth.value === null ? '—' : fmtWon(perf.lossWonMonth.value, lang).full} · {L('세정 필요도 지수', 'Cleaning index')} {perf.cleaningScore.value === null ? (perf.cleaningScore.reason?.[lang] ?? '—') : n(perf.cleaningScore.value, 1)}</p>
      )}
      {econ && (
        <table className="mt-2 w-full border-collapse text-[11px]">
          <thead><tr className="border-b border-gray-400 text-left">{[L('공법', 'Method'), L('총투자', 'Investment'), L('월간 편익', 'Monthly benefit'), L('회수기간', 'Payback'), 'BEP', L('첫 달 순편익', '1st-month net')].map((h) => <th key={h} className="py-1">{h}</th>)}</tr></thead>
          <tbody>
            {econ.methods.map((m) => (
              <tr key={m.key} className="border-b border-gray-100">
                <td className="py-0.5">{m.name[lang]}</td>
                <td className="py-0.5">{m.initialCost.value === null ? L('입력 필요', 'needs input') : fmtWon(m.initialCost.value, lang).full}</td>
                <td className="py-0.5">{m.monthlyBenefit.value === null ? '—' : fmtWon(m.monthlyBenefit.value, lang).full}</td>
                <td className="py-0.5">{m.paybackMonths.value === null ? '—' : `${n(m.paybackMonths.value, 2)} ${L('개월', 'mo')}`}</td>
                <td className="py-0.5">{m.bepDays.value === null ? '—' : `${n(m.bepDays.value, 1)} ${L('일', 'd')}`}</td>
                <td className="py-0.5">{m.firstMonthNet.value === null ? '—' : fmtWon(m.firstMonthNet.value, lang).full}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pinch && <p className="mt-2">{L('포화온도', 'Tsat')} {n(pinch.saturationTempC.value, 2)} °C (IAPWS-IF97) · {L('핀치', 'Pinch')} {n(pinch.pinch.value, 2)} °C · {L('어프로치', 'Approach')} {n(pinch.approach.value, 2)} °C ({L('DEMO 참고 범위 핀치 8~15, 어프로치 5~12 °C — 판정 아님', 'DEMO ref. ranges 8–15 / 5–12 °C — not criteria')})</p>}
      {ref?.effects && <p className="mt-1">{L('문헌 참고 출력 영향', 'Literature output effect')}: {n(ref.effects.output_loss_pct.low.value, 2)}~{n(ref.effects.output_loss_pct.high.value, 2)} % (GE GER-3567H ~ IST 2000)</p>}
      {[...(perf?.warnings ?? []), ...(econ?.warnings ?? [])].map((w, i) => <p key={i} className="mt-1 text-[#8a5a00]">⚠ {w[lang]}</p>)}

      <h2 className={h2}>4. {L('계산 가정 · DEMO 계수', 'Assumptions · DEMO coefficients')}</h2>
      <ul className="list-disc pl-5">
        {s.coefficients.map((k) => <li key={k.key}>{k.label[lang]}: <b>{String(k.value)}</b> — <code>{k.where}</code></li>)}
        <li>{L('월간 가동시간 기본값 720 h = 30일 × 24 h (DEMO 가정)', 'Default monthly hours 720 h = 30 days × 24 h (DEMO assumption)')}</li>
        <li>{L('운전 상태는 DEMO 시나리오에 지정된 값이며 임계값 판정이 아닙니다.', 'Status is assigned by the DEMO scenario, not a threshold judgment.')}</li>
      </ul>

      <h2 className={h2}>5. {L('데이터 준비 상태', 'Data readiness')}</h2>
      <p>{L('수령', 'Received')} {o.checklist_readiness.receivedCount}/{o.checklist_readiness.totalCount} · {L('검증 완료', 'Verified')} {o.checklist_readiness.verifiedCount} · {L('미수령 필수', 'Missing required')} {o.checklist_readiness.missingRequiredCount}
        {o.checklist.missingRequired.length > 0 && ` (${o.checklist.missingRequired.map((m) => m.id).join(', ')})`}</p>

      <h2 className={h2}>6. {L('출처', 'Sources')}</h2>
      <ul className="list-disc pl-5 text-[11px]">
        {src.map((x) => <li key={x.key}>{typeof x.title === 'string' ? x.title : x.title[lang]} — {x.author}{x.year ? `, ${x.year}` : ''} · {x.where} · {L('확인일', 'checked')} {x.checked_on}</li>)}
        <li>{L('DEMO 공식·계수: 사용자 제공 구현 프롬프트 (원 출처 문헌 미확인)', 'DEMO formulas/coefficients: user-provided prompt (no confirmed literature)')}</li>
      </ul>

      <h2 className={h2}>7. {L('제한사항', 'Limitations')}</h2>
      <ul className="list-disc pl-5">
        <li>{L('승인된 성능 모델·GT 운전 한계표·실제 플랜트 데이터가 연결되지 않았습니다. 결과는 DEMO 계산입니다.', 'No approved performance model, GT limits or real plant data are connected; results are DEMO calculations.')}</li>
        <li>{L('공개 문헌 값은 다른 기종·사례의 값을 비례 적용한 참고 범위입니다.', 'Literature values are reference ranges scaled from other machines and cases.')}</li>
        <li>{L('경제성은 일정한 회수 출력·SMP 를 가정한 단순 비교이며 추천이 아닙니다.', 'Economics assume constant recovery and SMP; not a recommendation.')}</li>
        <li>{L('산출할 수 없는 값은 0 이 아니라 "—"·사유로 표시했습니다.', 'Values that cannot be computed are shown as "—" with a reason, never as 0.')}</li>
      </ul>
    </div>
  )
}
