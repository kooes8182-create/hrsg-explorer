import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { isChecklist, type Attachment, type ChecklistItem, type ChecklistPayload, type ChecklistState, type RequestText, type Supply, type Verify } from '../api/engine'
import { Skeleton } from '../components/feedback'
import Icon from '../components/Icon'
import { Switch } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, unitLabel } from '../lib/format'
import { useApp } from '../store/app'
import { toast } from '../store/toast'
import { BottomSheet, MCard, Progress } from './ui'

// 모바일 현장 점검: PC 의 넓은 표 대신 카드. 같은 체크리스트 API·데이터(케이스별 40개 항목)를 씁니다.
// 저장은 [저장] 버튼으로 한 번에 — 화면이 불러온 시각(updated_at)을 함께 보내 다른 기기가 먼저 바꿨으면 덮어쓰지 않습니다.

const SUPPLY: Supply[] = ['NOT_ENTERED', 'REQUEST_NEEDED', 'NEEDS_CHECK', 'RECEIVED']
const VERIFY: Verify[] = ['UNVERIFIED', 'IN_PROGRESS', 'VERIFIED', 'FAILED']
const SUPPLY_CLS: Record<Supply, string> = { NOT_ENTERED: 'bg-sunken text-muted', REQUEST_NEEDED: 'bg-caution-soft text-caution', NEEDS_CHECK: 'bg-info-soft text-info', RECEIVED: 'bg-good-soft text-good', NA: 'bg-sunken text-faint' }
type Filter = 'all' | Supply

export default function MobileChecklist() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const [data, setData] = useState<ChecklistPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [cat, setCat] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [reqOnly, setReqOnly] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [mail, setMail] = useState(false)
  const [params, setParams] = useSearchParams()

  const load = useCallback(async () => {
    if (caseId === null) return
    try {
      setData(await api(`/cases/${caseId}/checklist/`, {}, isChecklist))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [caseId])
  useEffect(() => {
    setData(null)
    load()
  }, [load])
  // 알림·홈에서 항목 ID 로 들어오면 그 항목을 바로 엽니다
  useEffect(() => {
    const item = params.get('item')
    const c = params.get('cat'), sp = params.get('supply')
    if (!data || (!item && !c && !sp)) return
    if (item) setOpen(item)
    if (c) setCat(c)
    if (sp) setFilter(sp as Filter)
    setParams({}, { replace: true })
  }, [data, params, setParams])

  const items = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.items.filter((i) => (!cat || i.category === cat) && (filter === 'all' || i.state.supply_status === filter) && (!reqOnly || i.required) &&
      (!s || [i.id, i.name.ko, i.name.en].some((x) => x.toLowerCase().includes(s))))
  }, [data, cat, filter, reqOnly, q])

  if (!data) return failed ? (
    <MCard className="text-center"><p className="text-sm text-muted">{L('체크리스트를 불러오지 못했습니다.', 'Could not load the checklist.')}</p><button type="button" className="btn-primary mt-3 min-h-[44px]" onClick={load}>{L('다시 시도', 'Retry')}</button></MCard>
  ) : <div className="space-y-3"><Skeleton className="h-40 rounded-2xl" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
  const sm = data.summary
  const current = data.items.find((i) => i.id === open) ?? null

  return (
    <div className="space-y-3" data-mobile-checklist>
      <div className="flex items-end justify-between gap-2">
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{L('현장 점검', 'Field check')}</h1>
        <button type="button" className="btn-ghost min-h-[40px] px-3 text-xs" onClick={() => setMail(true)}><Icon name="copy" size={14} />{L(`자료 요청 (${sm.bySupply.REQUEST_NEEDED})`, `Request (${sm.bySupply.REQUEST_NEEDED})`)}</button>
      </div>

      <MCard>
        <div className="grid grid-cols-1 gap-3">
          <Progress label={L('전체 수령률', 'Received')} value={sm.readinessRate} sub={`${sm.receivedCount}/${sm.totalCount}`} />
          <Progress label={L('검토 진행률', 'Reviewed')} value={sm.reviewRate} sub={`${sm.reviewedCount}/${sm.totalCount}`} />
          <Progress label={L('필수 항목 충족률', 'Required met')} value={sm.requiredMetRate} sub={`${sm.requiredMetCount}/${sm.requiredCount}`} />
        </div>
        <p className={`mt-3 rounded-xl px-3 py-2 text-[13px] font-semibold ${sm.missingRequiredCount ? 'bg-caution-soft text-caution' : 'bg-good-soft text-good'}`}>
          {sm.missingRequiredCount ? L(`필수 미수신 ${sm.missingRequiredCount}개 · 받기 전에는 DEMO 값으로 계산`, `${sm.missingRequiredCount} required not received · DEMO values used`) : L('필수 항목 모두 수령', 'All required received')}
        </p>
      </MCard>

      <div className="space-y-2">
        <input className="input min-h-[44px] text-[15px]" placeholder={L('항목 검색 (ID·이름)', 'Search items')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('항목 검색', 'Search items')} />
        <Chips label={L('범주', 'Category')} value={cat} onChange={setCat}
          options={[['', L('전체 범주', 'All')], ...data.categories.map((c) => [c.code, `${c.code}. ${c.label[lang]}`] as [string, string])]} />
        <Chips label={L('상태', 'Status')} value={filter} onChange={(v) => setFilter(v as Filter)}
          options={[['all', L('전체', 'All')], ['NOT_ENTERED', L('미수신', 'Not received')], ['REQUEST_NEEDED', L('요청 필요', 'Request')], ['NEEDS_CHECK', L('검증 필요', 'Check')], ['RECEIVED', L('완료', 'Done')]]} />
        <label className="flex min-h-[44px] items-center justify-between rounded-xl border border-line bg-surface px-3 text-[13px]">
          <span>{L('필수 항목만', 'Required only')}</span><Switch checked={reqOnly} onChange={setReqOnly} label={L('필수 항목만', 'Required only')} />
        </label>
        <p className="text-xs text-muted">{L(`${items.length}개 표시 / 전체 ${data.items.length}개`, `${items.length} of ${data.items.length}`)}</p>
      </div>

      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => setOpen(i.id)} data-item={i.id} className="flex w-full flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card active:bg-accent-soft">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-faint">{i.id}</span>
                {i.required && <span className="rounded bg-danger-soft px-1 text-[10px] font-bold text-danger">{L('필수', 'Req')}</span>}
                <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${SUPPLY_CLS[i.state.supply_status]}`}>{data.labels.supply[i.state.supply_status][lang]}</span>
                {i.state.reviewed && <span className="text-[10.5px] font-semibold text-good">✓ {L('검토', 'Reviewed')}</span>}
                {(i.photos ?? 0) > 0 && <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted"><Icon name="folder" size={11} />{i.photos}</span>}
              </span>
              <span className="text-[14.5px] font-semibold leading-snug text-ink">{i.name[lang]}</span>
              <span className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="truncate text-slate">{i.data_type === 'document' ? (i.state.document_confirmed ? L('✓ 문서 확인', '✓ Document confirmed') : L('문서 미확인', 'Document not confirmed'))
                  : i.state.value ? <><b className="tabular-nums text-ink">{i.state.value}</b> {unitLabel(i.state.unit || i.unit || '')}</> : <span className="text-faint">{L('측정값 없음', 'No value')}</span>}</span>
                <span className="shrink-0 text-[11px] text-faint">{fmtDateTime(i.updated_at, lang)}</span>
              </span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="rounded-2xl border border-line bg-surface px-4 py-8 text-center text-sm text-muted">{L('조건에 맞는 항목이 없습니다.', 'No matching items.')}</li>}
      </ul>

      {current && <ItemSheet key={current.id + current.updated_at} caseId={caseId!} item={current} labels={data.labels} onClose={() => setOpen(null)} onSaved={setData} onReload={load} />}
      <MailSheet open={mail} caseId={caseId!} onClose={() => setMail(false)} />
    </div>
  )
}

function Chips({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={label}>
      <div className="flex w-max gap-1.5">
        {options.map(([v, text]) => (
          <button key={v || 'all'} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`min-h-[38px] whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-semibold ${value === v ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-muted'}`}>{text}</button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 항목 상세 입력
const toLocal = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function ItemSheet({ caseId, item, labels, onClose, onSaved, onReload }: {
  caseId: number; item: ChecklistItem; labels: ChecklistPayload['labels']; onClose: () => void; onSaved: (d: ChecklistPayload) => void; onReload: () => Promise<void>
}) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [f, setF] = useState<ChecklistState>({ ...item.state, unit: item.state.unit || item.unit || '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ChecklistState>(k: K, v: ChecklistState[K]) => setF((x) => ({ ...x, [k]: v }))
  const doc = item.data_type === 'document'

  const save = async () => {
    setBusy(true)
    setErrors({})
    useApp.setState({ saveState: 'pending' })
    try {
      const body = await api(`/cases/${caseId}/checklist/`, {
        method: 'PATCH',
        json: { updates: [{ id: item.id, expected_updated_at: item.updated_at, value: f.value ?? '', unit: f.unit, location: f.location, condition: f.condition,
          measured_at: f.measured_at, supply_status: f.supply_status, verify_status: f.verify_status, memo: f.memo, reviewed: f.reviewed, document_confirmed: f.document_confirmed }] },
      }, isChecklist)
      useApp.setState({ saveState: 'saved' })
      toast('ok', L('저장했습니다. PC 화면에도 같은 값이 보입니다.', 'Saved — the desktop view shows the same values.'))
      onSaved(body)
      onClose()
    } catch (e) {
      useApp.setState({ saveState: 'failed' })
      if (e instanceof ApiError && e.code === 'CONFLICT') setConflict(true)
      else if (e instanceof ApiError) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(e.fields)) out[k.split('.').pop()!] = Array.isArray(v) ? v[0] : v[lang]
        setErrors(Object.keys(out).length ? out : { _: e.text[lang] })
      } else setErrors({ _: String(e) })
      toast('error', L('저장하지 못했습니다.', 'Not saved.'))
    } finally {
      setBusy(false)
    }
  }

  const field = 'input min-h-[44px] text-[15px]'
  return (
    <BottomSheet open onClose={onClose} label={item.name[lang]}
      title={<span className="block"><span className="font-mono text-[11px] text-faint">{item.id}</span> {item.required && <span className="rounded bg-danger-soft px-1 text-[10px] font-bold text-danger">{L('필수', 'Required')}</span>}<span className="mt-0.5 block text-[16px] leading-snug">{item.name[lang]}</span></span>}
      footer={<button type="button" className="btn-primary min-h-[48px] w-full justify-center text-[15px]" disabled={busy} onClick={save} data-save>{busy ? L('저장 중…', 'Saving…') : L('저장', 'Save')}</button>}>
      <div className="space-y-3" data-item-sheet>
        <p className="text-xs text-muted">{item.reason[lang]}</p>
        {conflict && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger" role="alert">
            {L('다른 화면·기기에서 이 항목을 먼저 수정했습니다. 내 입력은 저장하지 않았습니다.', 'This item was changed elsewhere first. Your input was not saved.')}
            <button type="button" className="mt-2 block min-h-[40px] font-semibold underline" onClick={async () => { await onReload(); onClose() }}>{L('최신 값 다시 불러오기', 'Reload the latest values')}</button>
          </div>
        )}
        {errors._ && <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">{errors._}</p>}

        {doc ? (
          <label className="flex min-h-[52px] items-center justify-between rounded-xl border border-line px-3"><span className="text-[14px]">{L('문서 확인함', 'Document confirmed')}</span><Switch checked={f.document_confirmed} onChange={(v) => set('document_confirmed', v)} label={L('문서 확인함', 'Document confirmed')} /></label>
        ) : (
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Field label={L('측정값', 'Value')} error={errors.value}>
              <input id={`m-${item.id}-value`} className={field} inputMode={item.data_type === 'number' ? 'decimal' : 'text'} value={f.value ?? ''} onChange={(e) => set('value', e.target.value)} />
            </Field>
            <Field label={L('단위', 'Unit')}><input className={field} value={f.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
          </div>
        )}
        <Field label={L('측정 위치', 'Location')}><input className={field} value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label={L('측정 조건', 'Condition')}><input className={field} value={f.condition} placeholder={L('예: 부하 100%, 외기 15 °C', 'e.g. 100% load, 15 °C ambient')} onChange={(e) => set('condition', e.target.value)} /></Field>
        <Field label={L('측정 시각', 'Measured at')} error={errors.measured_at}>
          <input type="datetime-local" className={field} value={toLocal(f.measured_at)} onChange={(e) => set('measured_at', e.target.value ? new Date(e.target.value).toISOString() : null)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={L('수급 상태', 'Supply')} error={errors.supply_status}>
            <select className={field} value={f.supply_status} onChange={(e) => set('supply_status', e.target.value as Supply)}>{SUPPLY.map((s) => <option key={s} value={s}>{labels.supply[s][lang]}</option>)}</select>
          </Field>
          <Field label={L('검증 상태', 'Verification')} error={errors.verify_status}>
            <select className={field} value={f.verify_status} onChange={(e) => set('verify_status', e.target.value as Verify)}>{VERIFY.map((s) => <option key={s} value={s}>{labels.verify[s][lang]}</option>)}</select>
          </Field>
        </div>
        <Field label={L('메모', 'Memo')}><textarea className="input min-h-[80px] text-[15px]" value={f.memo} onChange={(e) => set('memo', e.target.value)} /></Field>
        <label className="flex min-h-[52px] items-center justify-between rounded-xl border border-line px-3"><span className="text-[14px]">{L('검토 완료', 'Reviewed')}</span><Switch checked={f.reviewed} onChange={(v) => set('reviewed', v)} label={L('검토 완료', 'Reviewed')} /></label>
        <Photos caseId={caseId} itemId={item.id} />
        <p className="text-[11px] text-faint">{L('마지막 수정', 'Last updated')} {fmtDateTime(item.updated_at, lang)}</p>
      </div>
    </BottomSheet>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-danger">{error}</span>}
    </label>
  )
}

// ---------------------------------------------------------------- 현장 사진 (서버 폴더에만 저장, AI 로 보내지 않음)
function Photos({ caseId, itemId }: { caseId: number; itemId: string }) {
  const L = useL()
  const [list, setList] = useState<Attachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const lang = useApp((s) => s.lang)
  const load = useCallback(() => api<Attachment[]>(`/cases/${caseId}/checklist/${itemId}/attachments/`).then(setList).catch(() => setList([])), [caseId, itemId])
  useEffect(() => {
    load()
  }, [load])
  const upload = async (file: File) => {
    setBusy(true)
    setErr(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api(`/cases/${caseId}/checklist/${itemId}/attachments/`, { method: 'POST', body: fd })
      toast('ok', L('사진을 올렸습니다.', 'Photo uploaded.'))
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.text[lang] : String(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const remove = async (a: Attachment) => {
    if (!window.confirm(L('이 사진을 삭제할까요?', 'Delete this photo?'))) return
    await api(`/attachments/${a.id}/`, { method: 'DELETE' }).catch(() => null)
    load()
  }
  return (
    <section className="rounded-xl border border-line p-3" aria-label={L('현장 사진', 'Field photos')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{L('현장 사진', 'Field photos')} {list && <span className="text-faint">{list.length}</span>}</span>
        <button type="button" className="btn-ghost min-h-[40px] px-3 text-xs" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" size={14} />{busy ? L('올리는 중…', 'Uploading…') : L('사진 찍기·선택', 'Take / pick photo')}</button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="hidden" data-photo-input
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      {list && list.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {list.map((a) => (
            <li key={a.id} className="relative">
              <img src={a.url} alt={a.original_name} className="aspect-square w-full rounded-lg border border-line bg-sunken object-cover" loading="lazy" />
              <button type="button" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--ink)/.6)] text-white" onClick={() => remove(a)} aria-label={L('사진 삭제', 'Delete photo')}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-faint">{L('JPEG·PNG·WEBP·HEIC, 10 MB 이하. 이 컴퓨터의 서버에만 저장하며 AI·외부로 보내지 않습니다. 사진의 위치 정보(EXIF)는 지우지 않으므로 필요하면 촬영 설정에서 끄세요.', 'JPEG/PNG/WEBP/HEIC up to 10 MB. Stored only on this computer’s server, never sent to AI. EXIF location is kept — turn it off in camera settings if needed.')}</p>
    </section>
  )
}

// ---------------------------------------------------------------- 자료 요청 초안 (복사·공유만, 발송하지 않음)
function MailSheet({ open, caseId, onClose }: { open: boolean; caseId: number; onClose: () => void }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [draft, setDraft] = useState<RequestText | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setDraft(null)
    api<RequestText>(`/cases/${caseId}/checklist/request-text/`, { method: 'POST', json: { lang, format: 'markdown' } }).then(setDraft).catch((e) => setErr(e instanceof ApiError ? e.text[lang] : String(e)))
  }, [open, caseId, lang])
  const text = draft ? `${draft.subject}\n\n${draft.body}` : ''
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: draft?.subject, text })
      else {
        await navigator.clipboard.writeText(text)
        toast('ok', L('복사했습니다.', 'Copied.'))
      }
    } catch {
      /* 공유를 취소한 경우 */
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title={L('자료 요청 메일 초안', 'Data request draft')}
      footer={draft && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost min-h-[48px] justify-center" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => null); toast('ok', L('복사했습니다.', 'Copied.')) }}><Icon name="copy" size={15} />{L('복사', 'Copy')}</button>
          <button type="button" className="btn-primary min-h-[48px] justify-center" onClick={share}>{L('공유', 'Share')}</button>
        </div>
      )}>
      <p className="mb-2 text-xs text-muted">{L("'요청 필요' 항목으로 만든 초안입니다. 이 앱은 메일을 보내지 않습니다 — 복사·공유 후 직접 보내세요.", "Drafted from 'request needed' items. The app never sends mail — copy or share it yourself.")}</p>
      {err && <p className="text-[13px] text-danger">{err}</p>}
      {!draft && !err && <Skeleton className="h-40 rounded-xl" />}
      {draft && (draft.items.length === 0 ? <p className="rounded-xl bg-canvas px-3 py-4 text-center text-[13px] text-muted">{L("'요청 필요' 항목이 없습니다. 항목 상세에서 수급 상태를 '요청 필요'로 바꾸세요.", "No 'request needed' items yet.")}</p>
        : <pre className="whitespace-pre-wrap rounded-xl bg-canvas p-3 font-sans text-[13px] leading-relaxed text-ink">{text}</pre>)}
    </BottomSheet>
  )
}
