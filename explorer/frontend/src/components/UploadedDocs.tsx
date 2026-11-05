import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { Evidence } from '../api/rag'
import type { Bilingual } from '../api/types'
import { useL } from '../i18n'
import { fmtDateTime } from '../lib/format'
import { useApp } from '../store/app'
import Icon from './Icon'
import ReliabilityBadge from './ReliabilityBadge'

// AI 관리자는 조회 전용 — 업로드·메타데이터 수정·재처리·재임베딩·삭제·재색인은 서버 권한표에서 BLOCKED (accounts/policy.py)
const READ_ONLY = true
import { Card, Notice } from './ui'

interface Step { key: string; status: 'RUNNING' | 'DONE' | 'FAILED'; detail: Record<string, unknown> | null; at: string }
interface Job { id: number; paper: number | null; kind: string; status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'; steps: Step[]; result: Record<string, unknown>; created_at: string; finished_at: string | null }
interface Upload {
  id: number; title: string; authors: string[]; year: number | null; doi: string; file_name: string; file_size: number; pages: number; chunks: number
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED'; embedding_status: string; version: number; error: string; created_at: string; last_job: Job | null
}

const STEP_LABEL: Record<string, [string, string]> = {
  extract: ['텍스트 추출', 'Extract'], chunk: ['청킹', 'Chunk'], embed: ['임베딩', 'Embed'], index: ['인덱스 갱신', 'Index'], dev_eval: ['Dev 평가', 'Dev eval'], compare: ['이전 결과 비교', 'Compare'],
}
const ORDER = ['extract', 'chunk', 'embed', 'index', 'dev_eval', 'compare']

function Steps({ job }: { job: Job }) {
  const lang = useApp((s) => s.lang)
  const by = Object.fromEntries(job.steps.map((s) => [s.key, s]))
  const keys = job.kind === 'PROCESS' ? ORDER : ORDER.filter((k) => k !== 'extract' && k !== 'chunk')
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]">
      {keys.map((k, i) => {
        const s = by[k]
        const cls = !s ? 'border-line text-faint' : s.status === 'DONE' ? 'border-good/40 bg-good-soft text-good' : s.status === 'FAILED' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-info/40 bg-info-soft text-info'
        return (
          <li key={k} className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${cls}`} title={s?.detail ? JSON.stringify(s.detail) : undefined}>
              {s?.status === 'RUNNING' && <Icon name="refresh" size={10} className="animate-spin" />}
              {s?.status === 'DONE' && <Icon name="check" size={10} />}
              {STEP_LABEL[k][lang === 'ko' ? 0 : 1]}
            </span>
            {i < keys.length - 1 && <span className="text-faint">›</span>}
          </li>
        )
      })}
    </ol>
  )
}

export default function UploadedDocs() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [list, setList] = useState<Upload[]>([])
  const [index, setIndex] = useState<{ papers: number; chunks: number; embedded: number } | null>(null)
  const [form, setForm] = useState({ title: '', authors: '', year: '', doi: '' })
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<{ tone: 'danger' | 'muted'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<Upload | null>(null)
  const [chunks, setChunks] = useState<{ id: number; rows: { idx: number; page: number; text: string; embedded: boolean }[] } | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Evidence[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await api<{ papers: Upload[]; index: typeof index }>('/knowledge/uploads/').catch(() => null)
    if (r) {
      setList(r.papers)
      setIndex(r.index)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  // 처리 중인 작업이 있으면 2초마다 상태를 다시 읽음
  const running = list.some((p) => p.last_job && ['QUEUED', 'RUNNING'].includes(p.last_job.status))
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [running, load])

  const err = (e: unknown) => setMsg({ tone: 'danger', text: e instanceof ApiError ? e.text[lang] : String(e) })
  const upload = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return setMsg({ tone: 'danger', text: L('PDF 파일을 고르세요.', 'Choose a PDF.') })
    setBusy(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    Object.entries(form).forEach(([k, v]) => v && fd.append(k, v))
    try {
      await api('/knowledge/uploads/', { method: 'POST', body: fd })
      setFile(null)
      setForm({ title: '', authors: '', year: '', doi: '' })
      if (fileRef.current) fileRef.current.value = ''
      setMsg({ tone: 'muted', text: L('올렸습니다. 처리 단계가 아래에 표시됩니다 (임베딩·dev 평가 포함 1~3분).', 'Uploaded. Processing steps appear below (1–3 min incl. embedding and dev eval).') })
      load()
    } catch (x) {
      err(x)
    } finally {
      setBusy(false)
    }
  }
  const act = async (path: string, method = 'POST', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    try {
      await api(path, { method })
      load()
    } catch (x) {
      err(x)
    }
  }
  const saveEdit = async () => {
    if (!edit) return
    try {
      await api(`/knowledge/uploads/${edit.id}/`, { method: 'PATCH', json: { title: edit.title, authors: edit.authors, year: edit.year ?? '', doi: edit.doi } })
      setEdit(null)
      load()
    } catch (x) {
      err(x)
    }
  }
  const showChunks = async (id: number) => {
    if (chunks?.id === id) return setChunks(null)
    setChunks({ id, rows: await api(`/knowledge/uploads/${id}/chunks/`) })
  }
  const search = async (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    setHits((await api<{ results: Evidence[] }>('/knowledge/upload-search/', { method: 'POST', json: { question: q } })).results)
  }
  const statusBadge = (p: Upload) => p.status === 'READY' ? <ReliabilityBadge kind="VERIFIED" title={L('처리 완료', 'Ready')} /> : p.status === 'FAILED' ? <ReliabilityBadge kind="UNAVAILABLE" /> : <ReliabilityBadge kind="NEEDS_VERIFICATION" title={L('처리 중', 'Processing')} />

  return (
    <div className="space-y-5">
      <Card title={L('문헌 업로드 (별도 범위 · 측정되지 않음)', 'Upload documents (separate, unmeasured scope)')} icon="folder"
        aside={index && <span className="text-[11px] text-muted">{L('업로드 범위', 'Upload scope')}: {index.papers}{L('편', ' docs')} · {index.chunks}{L('청크', ' chunks')} · {L('임베딩', 'embedded')} {index.embedded}</span>}>
        {READ_ONLY ? <Notice tone="muted">{L('AI 관리자는 조회 전용입니다. 업로드·삭제·재처리·재임베딩·새 평가 실행·정답 수정은 이번 권한에서 막혀 있습니다 (서버에서도 거부).', 'AI administrators have read-only access. Upload, delete, reprocess, re-embed, new runs and label edits are blocked (also refused by the server).')}</Notice> : <form onSubmit={upload} className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="label" htmlFor="up-file">PDF ({L('30 MB 이하', '≤ 30 MB')}) *</label>
            <input id="up-file" ref={fileRef} type="file" accept="application/pdf,.pdf" className="input h-10 py-1.5" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="md:col-span-2"><label className="label" htmlFor="up-title">{L('제목 (비우면 PDF 정보·파일명)', 'Title (PDF info/filename if empty)')}</label><input id="up-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="up-auth">{L('저자 (; 로 구분)', 'Authors (; separated)')}</label><input id="up-auth" className="input" value={form.authors} onChange={(e) => setForm({ ...form, authors: e.target.value })} /></div>
          <div><label className="label" htmlFor="up-year">{L('연도', 'Year')}</label><input id="up-year" className="input" inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
          <div className="md:col-span-3"><label className="label" htmlFor="up-doi">DOI</label><input id="up-doi" className="input" value={form.doi} onChange={(e) => setForm({ ...form, doi: e.target.value })} /></div>
          <div className="flex items-end md:col-span-2">
            <button type="submit" className="btn-primary h-10 w-full" disabled={busy || running}><Icon name="plus" size={15} />{running ? L('처리 중 — 끝난 뒤 올리기', 'Processing — wait') : L('올리고 처리', 'Upload & process')}</button>
          </div>
        </form>}
        <ul className="mt-3 space-y-1 text-[11px] text-muted">
          <li>{L('처리: 텍스트 추출 → 청킹(기존 앱과 같은 규칙) → BGE-M3 임베딩(공식과 같은 모델) → 인덱스 갱신 → 공식 dev 재채점 → 이전 결과 비교', 'Pipeline: extract → chunk (same rules) → BGE-M3 (same model) → reindex → official dev re-score → compare')}</li>
          <li>{L('업로드 문헌은 공식 corpus 와 섞지 않습니다. 정답 라벨이 없어 이 범위의 recall 은 측정되지 않았습니다. 이미지뿐인 PDF 는 OCR 하지 않습니다. 원본 PDF 는 다시 내려받을 수 없습니다.', 'Uploads never mix with the official corpus; their recall is unmeasured (no gold labels). No OCR for image-only PDFs. Original PDFs cannot be downloaded back.')}</li>
          <li>{L('저작권·공개 범위를 확인한 문헌만 올리세요. 실제 고객사·발전소 이름이 든 문서는 비식별 처리 후 올리세요.', 'Upload only documents you may use; de-identify customer/plant names first.')}</li>
        </ul>
        {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      </Card>

      <Card title={L(`업로드 문헌 (${list.length})`, `Uploaded documents (${list.length})`)} icon="knowledge" bodyClass="p-0"
        aside={!READ_ONLY && <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={running || !list.some((p) => p.status === 'READY')} onClick={() => act('/knowledge/reindex/', 'POST', L('업로드 문헌 전체를 다시 임베딩하고 dev 평가를 실행합니다. 계속할까요?', 'Re-embed all uploads and run the dev check?'))}><Icon name="refresh" size={13} />{L('전체 재색인', 'Reindex all')}</button>}>
        {list.length === 0 ? <p className="p-5 text-sm text-muted">{L('올린 문헌이 없습니다.', 'No uploads yet.')}</p> : (
          <ul className="divide-y divide-line">
            {list.map((p) => (
              <li key={p.id} className="space-y-2 p-4">
                {edit?.id === p.id ? (
                  <div className="grid gap-2 md:grid-cols-6">
                    <input className="input md:col-span-3" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label={L('제목', 'Title')} />
                    <input className="input md:col-span-2" value={edit.authors.join('; ')} onChange={(e) => setEdit({ ...edit, authors: e.target.value.split(';').map((a) => a.trim()) })} aria-label={L('저자', 'Authors')} />
                    <input className="input" value={edit.year ?? ''} onChange={(e) => setEdit({ ...edit, year: e.target.value ? Number(e.target.value) || (e.target.value as unknown as number) : null })} aria-label={L('연도', 'Year')} />
                    <input className="input md:col-span-4" value={edit.doi} onChange={(e) => setEdit({ ...edit, doi: e.target.value })} placeholder="DOI" aria-label="DOI" />
                    <div className="flex gap-2 md:col-span-2"><button type="button" className="btn-primary" onClick={saveEdit}>{L('저장', 'Save')}</button><button type="button" className="btn-ghost" onClick={() => setEdit(null)}>{L('취소', 'Cancel')}</button></div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><b className="text-sm">{p.title}</b>{statusBadge(p)}<span className="rounded bg-sunken px-1.5 text-[10px] text-muted">{L('업로드 범위', 'UPLOAD')}</span></div>
                      <div className="text-xs text-muted">{p.authors.join(', ') || L('저자 미입력', 'no authors')} · {p.year ?? '—'} · {p.doi || 'DOI —'} · {p.file_name} · {(p.file_size / 1024).toFixed(0)} KB · {p.pages}{L('쪽', 'p')} · {p.chunks}{L('청크', ' chunks')} · v{p.version} · {fmtDateTime(p.created_at, lang)}</div>
                      {p.error && <div className="text-xs text-danger">{p.error}</div>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => showChunks(p.id)}>{L('청크', 'Chunks')}</button>
                      {!READ_ONLY && <>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(p)}>{L('메타데이터', 'Metadata')}</button>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={running} onClick={() => act(`/knowledge/uploads/${p.id}/reprocess/`)}>{L('재처리', 'Reprocess')}</button>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={running || !p.chunks} onClick={() => act(`/knowledge/uploads/${p.id}/reembed/`)}>{L('재임베딩', 'Re-embed')}</button>
                      <button type="button" className="btn-icon hover:text-danger" disabled={running} aria-label={L('삭제', 'Delete')}
                        onClick={() => act(`/knowledge/uploads/${p.id}/`, 'DELETE', L(`"${p.title}" 문헌과 청크·임베딩을 삭제합니다. 되돌릴 수 없습니다.`, `Delete "${p.title}" with its chunks and embeddings? This cannot be undone.`))}><Icon name="trash" size={15} /></button>
                      </>}
                    </div>
                  </div>
                )}
                {p.last_job && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Steps job={p.last_job} />
                    {p.last_job.status === 'FAILED' && <span className="text-xs text-danger">{String((p.last_job.result as { error?: string }).error ?? '')}</span>}
                  </div>
                )}
                {p.last_job?.steps.find((s) => s.key === 'compare')?.detail && <CompareNote d={p.last_job.steps.find((s) => s.key === 'compare')!.detail!} />}
                {chunks?.id === p.id && (
                  <ol className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg bg-sunken p-2">
                    {chunks.rows.map((c) => <li key={c.idx} className="rounded border border-line bg-surface p-2 text-xs"><span className="text-[10px] text-faint">#{c.idx} · p.{c.page} · {c.embedded ? L('임베딩됨', 'embedded') : L('임베딩 없음', 'no vector')}</span><p className="line-clamp-3">{c.text}</p></li>)}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={L('업로드 문헌 검색', 'Search uploads')} icon="evaluation" aside={<ReliabilityBadge kind="UNCONFIRMED" title={L('측정되지 않은 범위', 'Unmeasured scope')} />}>
        <form onSubmit={search} className="flex gap-2">
          <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('업로드 문헌에서 찾기 (공식 corpus 제외)', 'Search uploads (official corpus excluded)')} aria-label={L('검색어', 'Query')} />
          <button type="submit" className="btn-primary">{L('검색', 'Search')}</button>
        </form>
        {hits && (hits.length === 0 ? <p className="mt-2 text-sm text-muted">{L('결과 없음', 'No results')}</p> : (
          <ol className="mt-3 space-y-2">
            {hits.map((h) => <li key={h.i} className="rounded-lg border border-line p-2.5 text-xs"><b>{h.rank}. {h.title}</b> <span className="text-muted">p.{h.page} · BM25 {h.bm25_rank ?? '—'} · Dense {h.dense_rank ?? '—'}</span><p className="mt-1 line-clamp-3">{h.text}</p></li>)}
          </ol>
        ))}
      </Card>
    </div>
  )
}

function CompareNote({ d }: { d: Record<string, unknown> }) {
  const L = useL()
  const now = d.now as { all: number; ko: number } | undefined
  const rec = d.official_dev_record as { all: number; ko: number } | undefined
  if (!now || !rec) return null
  const ok = d.official_scope_unchanged as boolean
  const note: Bilingual = {
    ko: `공식 dev 재채점: 전체 ${now.all} · 한국어 ${now.ko} (저장 기록 ${rec.all} · ${rec.ko}) → ${ok ? '공식 범위 변화 없음' : '차이 발생 — 확인 필요'}. 업로드 범위 recall: 측정 안 됨 (정답 라벨 없음)`,
    en: `Official dev re-score: all ${now.all} · KO ${now.ko} (record ${rec.all} · ${rec.ko}) → ${ok ? 'official scope unchanged' : 'differs — check'}. Upload-scope recall: not measured (no gold labels)`,
  }
  return <Notice tone={ok ? 'muted' : 'danger'}>{L(note.ko, note.en)}</Notice>
}
