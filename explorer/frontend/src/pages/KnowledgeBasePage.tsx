import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Evidence, PapersPayload } from '../api/rag'
import CompareSearch from '../components/CompareSearch'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Notice } from '../components/ui'
import UploadedDocs from '../components/UploadedDocs'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum } from '../lib/format'
import { useApp } from '../store/app'
import { ErrorState, PageSkeleton } from '../components/feedback'

// RAG 지식베이스: 공식 corpus 조회(읽기 전용) + 업로드 문헌(별도 범위) 관리.
export default function KnowledgeBasePage() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [data, setData] = useState<PapersPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [chunks, setChunks] = useState<Record<string, Evidence[]>>({})
  useEffect(() => {
    api<PapersPayload>('/knowledge/papers/').then(setData).catch(() => setFailed(true))
  }, [])
  const papers = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.papers ?? []).filter((p) => !s || [p.title, p.ref, p.doi ?? '', ...p.authors, String(p.year ?? '')].some((x) => x.toLowerCase().includes(s)))
  }, [data, q])
  const toggle = async (ref: string) => {
    setOpen(open === ref ? null : ref)
    if (!chunks[ref]) {
      const list = await api<Evidence[]>(`/knowledge/chunks/?ref=${encodeURIComponent(ref)}`).catch(() => [])
      setChunks((c) => ({ ...c, [ref]: list }))
    }
  }
  if (failed) return <ErrorState text={L('지식베이스를 불러오지 못했습니다.', 'Could not load the knowledge base.')} onRetry={() => location.reload()} />
  if (!data) return <PageSkeleton variant="table" />
  const ix = data.index
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          [L('문헌', 'Documents'), fmtNum(ix.documents, lang)],
          [L('청크(문단)', 'Chunks'), fmtNum(ix.chunks, lang)],
          [L('임베딩 벡터', 'Vectors'), ix.vectors ? `${fmtNum(ix.vectors[0], lang)} × ${ix.vectors[1]}` : '—'],
          [L('임베딩 모델', 'Model'), `${ix.model ?? '—'} · ${ix.revision}`],
          [L('마지막 갱신', 'Last update'), fmtDateTime(ix.embedding_created_at, lang)],
        ].map(([k, v]) => (
          <div key={k} className="card card-hover p-5"><div className="text-xs font-semibold text-muted">{k}</div><div data-kpi className="mt-1.5 truncate text-[22px] font-bold tracking-tight text-ink" title={v}>{v}</div></div>
        ))}
      </div>
      <Notice tone="info">{data.note[lang]} {L('corpus 해시', 'corpus hash')} <code>{ix.corpus_sha256}</code> · {L('의미 검색 상태', 'Dense status')}: <b>{{ ready: L('사용 중', 'ready'), not_loaded: L('첫 질문 때 불러옴', 'loads on first query'), unavailable: L('사용 불가', 'unavailable') }[ix.vector_status as 'ready'] ?? ix.vector_status}</b>{ix.vector_reason && ` — ${ix.vector_reason}`}</Notice>

      <UploadedDocs />

      <Card title={L(`문헌 목록 (${papers.length}/${data.papers.length})`, `Documents (${papers.length}/${data.papers.length})`)} icon="knowledge" bodyClass="p-0"
        aside={<input className="input h-8 w-56 text-xs" placeholder={L('제목·저자·DOI 검색', 'Search title/author/DOI')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('문헌 검색', 'Search documents')} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>{[L('제목', 'Title'), L('저자', 'Authors'), L('연도', 'Year'), 'DOI', L('청크', 'Chunks'), L('임베딩', 'Embedding'), L('버전', 'Version')].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {papers.map((p) => (
                <Fragment key={p.ref}>
                  <tr className="border-t border-line align-top">
                    <td className="max-w-[420px] px-4 py-2">
                      <button type="button" className="text-left font-semibold hover:text-accent-ink" onClick={() => toggle(p.ref)} aria-expanded={open === p.ref}>{p.title}</button>
                      <div className="text-[11px] text-faint">{p.ref}{p.venue && ` · ${p.venue}`}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">{p.authors.slice(0, 2).join(', ')}{p.authors.length > 2 && ' et al.'}</td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">{p.year ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{p.doi ? <a className="text-accent-ink hover:underline" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}</a> : '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{p.chunks}</td>
                    <td className="px-4 py-2">{p.embedding === 'EMBEDDED' ? <ReliabilityBadge kind="VERIFIED" title={L('공식 벡터 파일과 해시 대조 완료', 'Matched to the official vector file')} /> : <ReliabilityBadge kind="UNAVAILABLE" />}</td>
                    <td className="px-4 py-2 text-xs text-muted">{p.version}</td>
                  </tr>
                  {open === p.ref && (
                    <tr className="bg-sunken"><td colSpan={7} className="px-4 py-3">
                      {!chunks[p.ref] ? <p className="text-xs text-muted">{L('불러오는 중…', 'Loading…')}</p> : (
                        <ol className="max-h-80 space-y-2 overflow-y-auto">
                          {chunks[p.ref].map((c) => (
                            <li key={c.i} className="rounded-lg border border-line bg-surface p-2.5 text-xs">
                              <div className="text-[10px] text-faint">#{c.i} · {c.kind === 'note' ? L('요약 노트', 'notes') : L('본문', 'text')}{c.page ? ` · p.${c.page}` : ''}</div>
                              <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{c.text}</p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={L('검색 방식 비교', 'Search mode comparison')} icon="evaluation">
        <CompareSearch />
        <p className="mt-3 text-xs text-muted">{L('상세 평가 기록은 RAG 검색 성능 평가 화면에서 봅니다.', 'Detailed evaluation records are on the RAG evaluation page.')}</p>
      </Card>
    </div>
  )
}
