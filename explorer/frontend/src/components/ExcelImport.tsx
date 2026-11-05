import { useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useL } from '../i18n'
import { useApp } from '../store/app'
import Icon from './Icon'
import Modal from './Modal'
import { toast } from '../store/toast'
import { Notice } from './ui'

interface Row {
  line: number
  id: string
  name: string | null
  changes: Record<string, [unknown, unknown]>
  issues: { level: 'error' | 'warning' | 'info'; message: string }[]
}
interface Preview {
  rows: Row[]
  counts: { error: number; warning: number; info: number; rows: number; changed: number }
  applied: boolean
}

const FIELD: Record<string, [string, string]> = {
  value: ['측정값', 'Value'], location: ['측정 위치', 'Location'], condition: ['측정 조건', 'Conditions'], data_source: ['출처', 'Source'],
  memo: ['메모', 'Memo'], document_confirmed: ['문서 확인', 'Doc confirmed'], reviewed: ['검토', 'Reviewed'],
  supply_status: ['수급 상태', 'Supply'], verify_status: ['검증 상태', 'Verification'], measured_at: ['측정 일시', 'Measured at'],
}

/** 체크리스트 Excel: 내보내기·표준 양식·가져오기(미리보기 → 반영) */
export default function ExcelTools({ caseId, onApplied }: { caseId: number; onApplied: () => void }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'issues' | 'changes' | 'all'>('issues')

  const send = async (f: File, apply: boolean) => {
    const fd = new FormData()
    fd.append('file', f)
    return api<Preview>(`/cases/${caseId}/checklist/import/${apply ? '?apply=1' : ''}`, { method: 'POST', body: fd })
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    setFile(f)
    setErr(null)
    setBusy(true)
    try {
      setPreview(await send(f, false))
    } catch (e) {
      setErr(e instanceof ApiError ? e.text[lang] : String(e))
      setPreview(null)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const apply = async () => {
    if (!file) return
    setBusy(true)
    try {
      await send(file, true)
      setPreview(null)
      setFile(null)
      toast('ok', L('엑셀 값을 체크리스트에 반영했습니다.', 'Excel values applied to the checklist.'))
      onApplied()
    } catch (e) {
      setErr(e instanceof ApiError ? e.text[lang] : String(e))
    } finally {
      setBusy(false)
    }
  }
  const rows = preview?.rows.filter((r) => filter === 'all' || (filter === 'issues' ? r.issues.length > 0 : Object.keys(r.changes).length > 0)) ?? []
  const cls = { error: 'text-danger', warning: 'text-caution', info: 'text-info' }

  return (
    <>
      <a className="btn-ghost px-2.5 py-1.5 text-xs" href={`/api/cases/${caseId}/checklist/export/`} download><Icon name="copy" size={14} />{L('Excel 내보내기', 'Export Excel')}</a>
      <a className="btn-ghost px-2.5 py-1.5 text-xs" href="/api/checklist/template/" download><Icon name="checklist" size={14} />{L('표준 양식', 'Template')}</a>
      <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => input.current?.click()} disabled={busy}>
        <Icon name={busy ? 'refresh' : 'folder'} size={14} className={busy ? 'animate-spin' : ''} />{L('회신 Excel 가져오기', 'Import reply')}
      </button>
      <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={L('Excel 파일', 'Excel file')} />
      {err && !preview && <span className="text-xs text-danger">{err}</span>}
      {preview && (
        <Modal wide title={L('Excel 가져오기 미리보기', 'Import preview')} onClose={() => setPreview(null)}>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1 text-sm">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-sunken px-2 py-1">{file?.name}</span>
              <span className="rounded-md bg-sunken px-2 py-1">{L('행', 'Rows')} {preview.counts.rows} · {L('변경', 'Changed')} {preview.counts.changed}</span>
              <span className="rounded-md bg-danger-soft px-2 py-1 text-danger">{L('오류', 'Errors')} {preview.counts.error}</span>
              <span className="rounded-md bg-caution-soft px-2 py-1 text-caution">{L('경고', 'Warnings')} {preview.counts.warning}</span>
              <span className="rounded-md bg-info-soft px-2 py-1 text-info">{L('알림', 'Info')} {preview.counts.info}</span>
            </div>
            {preview.counts.error > 0
              ? <Notice tone="danger">{L('오류가 있어 반영할 수 없습니다. Excel 을 고친 뒤 다시 가져오세요.', 'Errors found — fix the workbook and import again.')}</Notice>
              : <Notice tone="muted">{L('반영하면 변경된 칸만 저장합니다. 경고는 확인용이며 반영을 막지 않습니다.', 'Applying saves only changed cells. Warnings do not block.')}</Notice>}
            {err && <Notice tone="danger">{err}</Notice>}
            <div className="flex gap-1 text-xs" role="group">
              {(['issues', 'changes', 'all'] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-md border px-2 py-0.5 ${filter === f ? 'border-ink bg-ink text-surface' : 'border-line'}`}>
                  {{ issues: L('확인할 행 (오류·경고·알림)', 'To check (errors, warnings, notes)'), changes: L('바뀌는 행', 'Changed'), all: L('전체', 'All') }[f]}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {rows.map((r) => (
                <li key={`${r.line}-${r.id}`} className="p-2.5">
                  <div className="text-xs"><b className="font-mono">{r.id}</b> {r.name} <span className="text-faint">· {L('행', 'row')} {r.line}</span></div>
                  {Object.entries(r.changes).map(([k, [a, b]]) => (
                    <div key={k} className="text-xs text-muted">{FIELD[k]?.[lang === 'ko' ? 0 : 1] ?? k}: <s>{String(a ?? '') || '—'}</s> → <b className="text-ink">{String(b ?? '') || '—'}</b></div>
                  ))}
                  {r.issues.map((i, n) => <div key={n} className={`text-xs ${cls[i.level]}`}>● {i.message}</div>)}
                </li>
              ))}
              {rows.length === 0 && <li className="p-3 text-xs text-muted">{L('해당하는 행이 없습니다.', 'No rows.')}</li>}
            </ul>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>{L('취소', 'Cancel')}</button>
            <button type="button" className="btn-primary" disabled={busy || preview.counts.error > 0 || preview.counts.changed === 0} onClick={apply}>{L('반영', 'Apply')}</button>
          </div>
        </Modal>
      )}
    </>
  )
}
