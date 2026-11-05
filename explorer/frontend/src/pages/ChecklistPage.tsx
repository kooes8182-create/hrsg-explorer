import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { isChecklist, type ChecklistItem, type ChecklistPayload, type ChecklistState, type RequestText, type Supply, type Verify } from '../api/engine'
import Donut from '../components/charts/Donut'
import Heatmap from '../components/charts/Heatmap'
import ExcelTools from '../components/ExcelImport'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Notice } from '../components/ui'
import { useL } from '../i18n'
import { fmtNum, unitLabel } from '../lib/format'
import { useApp } from '../store/app'
import { toast } from '../store/toast'
import { AskAiButton } from '../components/chat/ChatThread'
import { PageActions } from '../components/shell'
import { ErrorState, PageSkeleton } from '../components/feedback'

const SUPPLY: Supply[] = ['NOT_ENTERED', 'REQUEST_NEEDED', 'RECEIVED', 'NEEDS_CHECK', 'NA']
const VERIFY: Verify[] = ['UNVERIFIED', 'IN_PROGRESS', 'VERIFIED', 'FAILED']
const SUPPLY_CLS: Record<Supply, string> = { NOT_ENTERED: 'text-muted', REQUEST_NEEDED: 'text-caution', RECEIVED: 'text-good', NEEDS_CHECK: 'text-info', NA: 'text-faint' }
const VERIFY_CLS: Record<Verify, string> = { UNVERIFIED: 'text-muted', IN_PROGRESS: 'text-info', VERIFIED: 'text-good', FAILED: 'text-danger' }

type Patch = Partial<ChecklistState> & { id: string }

export default function ChecklistPage() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const [data, setData] = useState<ChecklistPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [itemErr, setItemErr] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [supply, setSupply] = useState('')
  const [reqOnly, setReqOnly] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [mail, setMail] = useState(false)
  const [params, setParams] = useSearchParams()
  const focusId = params.get('item')
  const catParam = params.get('cat')
  const supplyParam = params.get('supply')
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  const load = useCallback(async () => {
    if (caseId === null) return
    try {
      setData(await api(`/cases/${caseId}/checklist/`, {}, isChecklist))
      setError(null)
    } catch {
      setError(L('체크리스트를 불러오지 못했습니다.', 'Could not load the checklist.'))
    }
  }, [caseId, L])
  useEffect(() => {
    setData(null)
    load()
  }, [load])

  // 대시보드·AI 에서 항목 ID 로 들어오면 그 행으로 이동해 강조합니다.
  useEffect(() => {
    if (!data || !focusId) return
    setOpen(focusId)
    setQ('')
    setCat('')
    setSupply('')
    setReqOnly(false)
    setTimeout(() => rowRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }, [data, focusId])

  // 대시보드 히트맵에서 범주·상태로 들어오면 그 조건으로 목록을 거릅니다.
  useEffect(() => {
    if (!catParam && !supplyParam) return
    setCat(catParam ?? '')
    setSupply(supplyParam ?? '')
    setQ('')
    setReqOnly(false)
  }, [catParam, supplyParam])
  const applyFilter = (c: string, s: string) => {
    setCat(c)
    setSupply(s)
    setParams({}, { replace: true })
  }

  /** 자동 저장: 한 번의 요청으로 여러 항목을 함께 (일괄 처리도 전부 또는 전무) */
  const save = async (updates: Patch[]) => {
    useApp.setState({ saveState: 'pending' })
    try {
      const body = await api(`/cases/${caseId}/checklist/`, { method: 'PATCH', json: { updates } }, isChecklist)
      setData(body)
      setItemErr({})
      useApp.setState({ saveState: 'saved' })
      if (updates.length > 1) toast('ok', L(`${updates.length}개 항목을 저장했습니다.`, `Saved ${updates.length} items.`))
      return true
    } catch (e) {
      useApp.setState({ saveState: 'failed' })
      const errs: Record<string, string> = {}
      if (e instanceof ApiError) for (const [k, v] of Object.entries(e.fields)) errs[k.split('.')[0]] = Array.isArray(v) ? v[0] : v[lang]
      setItemErr(errs)
      toast('error', L('저장하지 못했습니다. 표시된 항목을 확인하세요.', 'Not saved — check the highlighted item.'))
      await load() // 화면을 서버 상태로 되돌림
      return false
    }
  }

  // 목록 필터 = 서버의 키트 filterItems (검색: ID·항목명·이유, 카테고리, 수급 상태, 필수만)
  const [filtered, setFiltered] = useState<string[] | null>(null)
  useEffect(() => {
    if (caseId === null || !data) return
    if (!q.trim() && !cat && !supply && !reqOnly) return setFiltered(null)
    let gone = false
    const t = setTimeout(async () => {
      const ps = new URLSearchParams({ q: q.trim(), category: cat || 'all', supply: supply || 'all', required: reqOnly ? '1' : '0' })
      try {
        const body = await api(`/cases/${caseId}/checklist/?${ps}`, {}, isChecklist)
        if (!gone) setFiltered(body.filtered ?? null)
      } catch {
        /* 필터 요청 실패 시 이전 결과 유지 */
      }
    }, 200)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [caseId, data, q, cat, supply, reqOnly])
  const items = useMemo(() => {
    if (!data) return []
    if (!filtered) return data.items
    const keep = new Set(filtered)
    return data.items.filter((i) => keep.has(i.id))
  }, [data, filtered])

  if (error) return <ErrorState text={error} onRetry={load} />
  if (!data) return <PageSkeleton variant="table" />
  const sm = data.summary
  const supplyColor: Record<Supply, string> = { RECEIVED: 'rgb(var(--accent))', NEEDS_CHECK: 'rgb(var(--soft))', REQUEST_NEEDED: 'rgb(var(--peach))', NOT_ENTERED: 'rgb(var(--line))', NA: 'rgb(var(--faint))' }
  const selected = [...sel].filter((id) => items.some((i) => i.id === id))
  // 요청 메일 초안 (n): 표에서 체크한 ID (키트 emailDraft ids). 체크가 없으면 아직 받지 않은 항목 전부 (해당 없음 제외)
  const mailIds = selected.length > 0 ? selected : null
  const unreceived = data.items.filter((i) => !['RECEIVED', 'NEEDS_CHECK', 'NA'].includes(i.state.supply_status)).length

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageActions><AskAiButton page="checklist" question={['평가를 위해 어떤 데이터가 더 필요하고, 검증이 필요한 항목은 무엇인지 알려 줘.', 'Which additional data is needed, and which items need verification?']} /></PageActions>
      {/* 진행률 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [L('데이터 수령률', 'Received'), sm.readinessRate, `${sm.receivedCount}/${sm.totalCount}`],
          [L('검토 진행률', 'Reviewed'), sm.reviewRate, `${sm.reviewedCount}/${sm.totalCount}`],
          [L('검증 완료율', 'Verified'), sm.verifiedRate, `${sm.verifiedCount}/${sm.totalCount}`],
          [L('필수 항목 충족률', 'Required met'), sm.requiredMetRate, `${sm.requiredMetCount}/${sm.requiredCount}`],
        ].map(([label, rate, frac]) => (
          <div key={String(label)} className="card card-hover p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted">{label}{label === L('필수 항목 충족률', 'Required met') && sm.provisional && <ReliabilityBadge kind="UNCONFIRMED" title={L('필수 기준은 임시입니다', 'Required criteria are provisional')} />}</div>
            <div className="mt-1 flex items-baseline gap-2"><span data-kpi className="text-[28px] font-bold tracking-tight text-ink">{fmtNum(rate as number, lang, 1)}<span className="ml-0.5 text-base text-muted">%</span></span><span className="text-xs text-muted">{frac}</span></div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-gradient-to-r from-soft to-accent" style={{ width: `${rate ?? 0}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title={L('카테고리별 수령률', 'Received by category')} icon="analysis">
          <div className="space-y-3">
            {data.categories.map((c) => {
              const b = sm.byCategory[c.code]
              return b ? (
                <button key={c.code} type="button" onClick={() => applyFilter(c.code, '')} className="grid w-full grid-cols-[minmax(110px,40%)_1fr_52px] items-center gap-3 rounded-lg text-left text-[13px] hover:text-accent-ink">
                  <span className="truncate text-muted">{c.code}. {c.label[lang]}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${b.rate ?? 0}%` }} /></div>
                  <span className="text-right text-xs tabular-nums text-ink">{b.received}/{b.total}</span>
                </button>
              ) : null
            })}
          </div>
        </Card>
        <Card title={L('수급 상태 분포', 'Supply status')} icon="checklist">
          <Donut ariaLabel={L('수급 상태', 'Supply status')} center={String(sm.totalCount)} sub={L('전체 항목', 'items')} size={120}
            slices={(['RECEIVED', 'NEEDS_CHECK', 'REQUEST_NEEDED', 'NOT_ENTERED', 'NA'] as Supply[]).map((s) => ({ label: data.labels.supply[s][lang], value: sm.bySupply[s], color: supplyColor[s] }))} />
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
            {VERIFY.map((s) => <div key={s} className="flex justify-between"><span className={VERIFY_CLS[s]}>◆ {data.labels.verify[s][lang]}</span><b className="tabular-nums text-ink">{sm.byVerify[s]}</b></div>)}
          </div>
          {sm.missingRequired.length > 0 && <p className="mt-3 text-xs text-muted">{L('미수령 필수 항목', 'Missing required')}: {sm.missingRequired.map((id) => <button key={id} type="button" className="mr-1 font-mono text-accent-ink hover:underline" onClick={() => setOpen(id)}>{id}</button>)}</p>}
        </Card>
        <Card title={L('범주 × 수급 상태', 'Category × status')} icon="analysis" sub={L('칸을 누르면 목록을 거릅니다', 'Click a cell to filter')} className="lg:col-span-2 xl:col-span-1">
          <Heatmap ariaLabel={L('범주별 수급 상태', 'Supply status by category')}
            rows={data.categories.map((c) => ({ key: c.code, label: `${c.code}. ${c.label[lang]}` }))}
            cols={SUPPLY.map((s) => ({ key: s, label: data.labels.supply[s][lang] }))}
            values={sm.matrix} onCell={(r, c) => applyFilter(r, c)} />
        </Card>
      </div>

      {/* 목록 */}
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input className="input h-9 max-w-[220px]" placeholder={L('검색 (ID·항목명·이유)', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('검색', 'Search')} />
          <select className="input h-9 w-auto py-0" value={cat} onChange={(e) => applyFilter(e.target.value, supply)} aria-label={L('카테고리', 'Category')}>
            <option value="">{L('전체 카테고리', 'All categories')}</option>
            {data.categories.map((c) => <option key={c.code} value={c.code}>{c.code}. {c.label[lang]}</option>)}
          </select>
          <select className="input h-9 w-auto py-0" value={supply} onChange={(e) => applyFilter(cat, e.target.value)} aria-label={L('수급 상태', 'Supply status')}>
            <option value="">{L('전체 상태', 'All statuses')}</option>
            {SUPPLY.map((s) => <option key={s} value={s}>{data.labels.supply[s][lang]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={reqOnly} onChange={(e) => setReqOnly(e.target.checked)} />{L('필수만', 'Required only')}</label>
          <span className="text-xs text-muted">{items.length}/{data.items.length}</span>
          {(cat || supply || reqOnly || q) && <button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => { applyFilter('', ''); setReqOnly(false); setQ('') }}>{L('필터 해제', 'Clear filters')}</button>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.length > 0 && (
              <>
                <span className="text-xs font-semibold">{L(`${selected.length}개 선택`, `${selected.length} selected`)}</span>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={async () => (await save(selected.map((id) => ({ id, reviewed: true })))) && setSel(new Set())}>{L('검토 완료', 'Mark reviewed')}</button>
                <select className="input h-8 w-auto py-0 text-xs" value="" onChange={async (e) => e.target.value && (await save(selected.map((id) => ({ id, supply_status: e.target.value as Supply })))) && setSel(new Set())} aria-label={L('수급 상태 일괄 변경', 'Bulk supply status')}>
                  <option value="">{L('수급 상태 변경…', 'Set supply status…')}</option>
                  {SUPPLY.map((s) => <option key={s} value={s}>{data.labels.supply[s][lang]}</option>)}
                </select>
              </>
            )}
            <ExcelTools caseId={caseId!} onApplied={load} />
            <button type="button" className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => setMail(true)}><Icon name="copy" size={14} />{L('요청 메일 초안', 'Request e-mail draft')} ({mailIds ? mailIds.length : unreceived})</button>
          </div>
        </div>
        {sm.provisional && <div className="border-b border-line px-4 py-2 text-xs text-muted">{L('필수 여부·우선순위는 확정 기준이 없어 임시 기준입니다 (계산에 쓰이는 항목 = 필수). A·B·C 22개는 구현 프롬프트, E는 기존 HRSG 앱 항목입니다.', 'Required/priority are provisional (items used in calculations = required). A·B·C (22) from the prompt; E from the existing HRSG app.')}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-canvas text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
              <tr>
                <th className="w-8 py-2 pl-4"><input type="checkbox" aria-label={L('전체 선택', 'Select all')} checked={items.length > 0 && items.every((i) => sel.has(i.id))} onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} /></th>
                <th className="py-2">ID</th><th className="py-2">{L('항목', 'Item')}</th><th className="py-2">{L('필수·우선', 'Req·prio')}</th>
                <th className="py-2">{L('측정값', 'Value')}</th><th className="py-2">{L('수급 상태', 'Supply')}</th><th className="py-2">{L('검증 상태', 'Verification')}</th><th className="py-2 pr-4 text-center">{L('검토', 'Rev.')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Fragment key={i.id}>
                  <tr ref={(el) => (rowRefs.current[i.id] = el)}
                    className={`border-t border-line align-middle transition-colors hover:bg-canvas ${focusId === i.id ? 'bg-accent-soft/60 ring-2 ring-inset ring-accent' : open === i.id ? 'bg-sunken' : ''}`}>
                    <td className="py-2 pl-4"><input type="checkbox" aria-label={i.id} checked={sel.has(i.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(i.id) : n.delete(i.id); setSel(n) }} /></td>
                    <td className="py-2 font-mono text-xs">{i.id}</td>
                    <td className="max-w-[320px] py-2 pr-3">
                      <button type="button" className="text-left font-medium hover:text-accent-ink" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}>
                        {i.name[lang]}{i.unit && <span className="ml-1 text-xs text-faint">({unitLabel(i.unit)})</span>}
                      </button>
                      <div className="truncate text-xs text-muted" title={i.reason[lang]}>{i.reason[lang]}</div>
                      {itemErr[i.id] && <div className="text-xs text-danger">{itemErr[i.id]}</div>}
                    </td>
                    <td className="py-2 text-xs">
                      {i.required && <span className="mr-1 rounded bg-danger-soft px-1 font-semibold text-danger">{lang === 'ko' && i.priority_label ? i.priority_label.split(' · ')[0] : 'Req'}</span>}
                      <span className="text-muted">{lang === 'ko' && i.priority_label ? i.priority_label.split(' · ').pop() : { HIGH: 'High', MEDIUM: 'Med', LOW: 'Low' }[i.priority]}</span>
                    </td>
                    <td className="py-2 pr-2 tabular-nums">{i.data_type === 'document' ? (i.state.document_confirmed ? L('✓ 문서 확인', '✓ Doc confirmed') : <span className="text-faint">{L('문서', 'Document')}</span>) : (i.state.value ?? <span className="text-faint">{i.measure_cell ?? '—'}</span>)}</td>
                    <td className="py-2 pr-2">
                      <select className={`input h-8 w-auto py-0 text-xs font-semibold ${SUPPLY_CLS[i.state.supply_status]}`} value={i.state.supply_status} aria-label={`${i.id} ${L('수급 상태', 'supply')}`}
                        onChange={(e) => save([{ id: i.id, supply_status: e.target.value as Supply }])}>
                        {SUPPLY.map((s) => <option key={s} value={s}>{data.labels.supply[s][lang]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select className={`input h-8 w-auto py-0 text-xs font-semibold ${VERIFY_CLS[i.state.verify_status]}`} value={i.state.verify_status} aria-label={`${i.id} ${L('검증 상태', 'verification')}`}
                        onChange={(e) => save([{ id: i.id, verify_status: e.target.value as Verify }])}>
                        {VERIFY.map((s) => <option key={s} value={s}>{data.labels.verify[s][lang]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-4 text-center"><input type="checkbox" aria-label={`${i.id} ${L('검토', 'reviewed')}`} checked={i.state.reviewed} onChange={(e) => save([{ id: i.id, reviewed: e.target.checked }])} /></td>
                  </tr>
                  {open === i.id && <tr className="bg-sunken"><td colSpan={8} className="px-4 pb-4"><Detail item={i} onSave={save} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <p className="p-5 text-sm text-muted">{L('조건에 맞는 항목이 없습니다.', 'No matching items.')}</p>}
        </div>
      </Card>
      {mail && <MailDialog caseId={caseId!} ids={mailIds} requestKey={(mailIds ?? data.items.filter((i) => !['RECEIVED', 'NEEDS_CHECK', 'NA'].includes(i.state.supply_status)).map((i) => i.id)).slice().sort().join(',')} onClose={() => setMail(false)} />}
    </div>
  )
}

/** 항목 상세: 칸을 벗어날 때 바뀐 값만 자동 저장 */
function Detail({ item, onSave }: { item: ChecklistItem; onSave: (u: Patch[]) => Promise<boolean> }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [f, setF] = useState(item.state)
  useEffect(() => setF(item.state), [item.state])
  const commit = (k: keyof ChecklistState, v: unknown) => {
    if (v === item.state[k] || (v === '' && item.state[k] === null)) return
    onSave([{ id: item.id, [k]: v === '' && k === 'value' ? null : v }])
  }
  const text = (k: 'value' | 'unit' | 'location' | 'condition' | 'data_source' | 'memo', label: string, wide = false) => (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="label" htmlFor={`${item.id}-${k}`}>{label}</label>
      <input id={`${item.id}-${k}`} className="input h-9" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} onBlur={(e) => commit(k, e.target.value)} />
    </div>
  )
  return (
    <div className="grid gap-3 pt-3 sm:grid-cols-4">
      <div className="space-y-1 text-xs text-muted sm:col-span-4">
        <div><b>{L('필요 이유', 'Why needed')}:</b> {item.reason[lang]}</div>
        <div>
          <b>{L('데이터 유형', 'Type')}:</b> {item.data_type} · <b>{L('출처', 'Source')}:</b> {{ PROMPT_GUIDE: L('구현 프롬프트', 'Prompt'), PLAN_DRAFT: L('기존 앱 (계획서 초안)', 'Existing app (plan draft)'), KIT: L('키트', 'Kit'), PUBLIC_REF: L('공개 자료 참고', 'Public reference') }[item.source]}
          {item.calc_field && <> · <b>{L('계산 입력', 'Calc input')}:</b> <code>{item.calc_field}</code></>}
          {item.legacy.length > 0 && <> · <b>{L('기존 키', 'Legacy')}:</b> <code>{item.legacy.join(', ')}</code></>}
        </div>
      </div>
      {item.data_type !== 'document' ? text('value', L('측정값', 'Value')) : (
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.document_confirmed} onChange={(e) => onSave([{ id: item.id, document_confirmed: e.target.checked }])} />{L('문서 첨부·확인함', 'Document attached & checked')}</label>
      )}
      {text('unit', L('단위', 'Unit'))}
      {text('location', L('측정 위치', 'Location'))}
      {text('condition', L('측정 조건', 'Conditions'))}
      <div>
        <label className="label" htmlFor={`${item.id}-at`}>{L('측정 일시', 'Measured at')}</label>
        <input id={`${item.id}-at`} type="datetime-local" className="input h-9" value={f.measured_at ? f.measured_at.slice(0, 16) : ''}
          onChange={(e) => setF({ ...f, measured_at: e.target.value || null })} onBlur={(e) => commit('measured_at', e.target.value || null)} />
      </div>
      {text('data_source', L('데이터 출처', 'Data source'))}
      {text('memo', L('메모', 'Memo'), true)}
    </div>
  )
}

function MailDialog({ caseId, ids, requestKey, onClose }: { caseId: number; ids: string[] | null; requestKey: string; onClose: () => void }) {
  const L = useL()
  const appLang = useApp((s) => s.lang)
  const [opts, setOpts] = useState({ lang: appLang as 'ko' | 'en', format: 'markdown' as 'markdown' | 'html', customer: '', plant: '', subject: '', purpose: '' })
  const [draft, setDraft] = useState<RequestText | null>(null)
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)
  const generate = async () => {
    const r = await api<RequestText>(`/cases/${caseId}/checklist/request-text/`, { method: 'POST', json: { ...opts, ...(ids ? { ids } : {}) } })
    setDraft(r)
    setBody(r.body)
    setCopied(false)
  }
  const changed = draft && draft.items_key !== requestKey
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${draft!.subject}\n\n${body}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Modal wide title={L('데이터 요청 메일 초안', 'Data request e-mail draft')} onClose={onClose}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <Notice tone="muted">{ids ? L(`표에서 체크한 ${ids.length}개 항목만 포함합니다.`, `Only the ${ids.length} checked items are included.`) : L('체크한 항목이 없어 아직 받지 않은 항목 전부를 포함합니다 (해당 없음 제외).', 'Nothing checked, so all items not yet received are included.')} {L('본문은 키트 문구(한국어)입니다. 실제 발송 기능은 없습니다. 발전소명은 직접 입력하세요 (실명 사용 주의).', 'The body is the kit wording (Korean). No sending. Enter the plant name yourself.')}</Notice>
        <div className="grid grid-cols-2 gap-2">
          <select className="input h-9 py-0" value={opts.lang} onChange={(e) => setOpts({ ...opts, lang: e.target.value as 'ko' })} aria-label={L('언어', 'Language')}><option value="ko">한국어</option><option value="en">English</option></select>
          <select className="input h-9 py-0" value={opts.format} onChange={(e) => setOpts({ ...opts, format: e.target.value as 'html' })} aria-label={L('형식', 'Format')}><option value="markdown">Markdown</option><option value="html">HTML</option></select>
          <input className="input h-9" placeholder={L('고객사', 'Customer')} value={opts.customer} onChange={(e) => setOpts({ ...opts, customer: e.target.value })} />
          <input className="input h-9" placeholder={L('발전소명', 'Plant')} value={opts.plant} onChange={(e) => setOpts({ ...opts, plant: e.target.value })} />
          <input className="input col-span-2 h-9" placeholder={L('요청 제목 (비우면 자동)', 'Subject (auto if empty)')} value={opts.subject} onChange={(e) => setOpts({ ...opts, subject: e.target.value })} />
          <input className="input col-span-2 h-9" placeholder={L('요청 목적 (비우면 자동)', 'Purpose (auto if empty)')} value={opts.purpose} onChange={(e) => setOpts({ ...opts, purpose: e.target.value })} />
        </div>
        <button type="button" className="btn-primary" onClick={generate}>{draft ? L('다시 생성', 'Regenerate') : L('초안 생성', 'Generate')}</button>
        {changed && <Notice tone="caution">{L('초안을 만든 뒤 대상 항목이 바뀌었습니다. 다시 생성하세요.', 'The included items changed since this draft. Regenerate.')}</Notice>}
        {draft && (
          <>
            {draft.count === 0 && <Notice tone="caution">{L('요청할 항목이 없습니다.', 'No items to request.')}</Notice>}
            <div><span className="label">{L('제목', 'Subject')}</span><div className="rounded-lg bg-sunken px-3 py-2 text-sm">{draft.subject}</div></div>
            <div>
              <label className="label" htmlFor="mail-body">{L('본문 (직접 수정 가능)', 'Body (editable)')}</label>
              <textarea id="mail-body" className="input min-h-[220px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <button type="button" className="btn-ghost" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? L('복사됨', 'Copied') : L('클립보드 복사', 'Copy to clipboard')}</button>
          </>
        )}
      </div>
    </Modal>
  )
}
