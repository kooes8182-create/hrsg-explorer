import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { CompareResult, ConfigKey, SearchMode } from '../api/rag'
import { useL } from '../i18n'
import { useApp } from '../store/app'
import Icon from './Icon'
import { Notice } from './ui'

// 같은 질문으로 BM25 / Dense(BGE-M3) / Hybrid 결과를 나란히 비교 (지식베이스·RAG 평가 화면 공용, 같은 API)
export default function CompareSearch({ allowConfig = false }: { allowConfig?: boolean }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [q, setQ] = useState('')
  const [config, setConfig] = useState<ConfigKey>('locked')
  const [r, setR] = useState<CompareResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      setR(await api<CompareResult>('/rag/compare/', { method: 'POST', json: { question: q, config } }))
    } catch (x) {
      setErr(x instanceof ApiError ? x.text[lang] : String(x))
    } finally {
      setBusy(false)
    }
  }
  const cols: { m: SearchMode; label: string }[] = [{ m: 'bm25', label: 'BM25' }, { m: 'dense', label: 'Dense (BGE-M3)' }, { m: 'hybrid', label: 'Hybrid RRF' }]
  return (
    <div>
      <form onSubmit={run} className="flex flex-wrap gap-2">
        <input className="input min-w-[220px] flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('비교할 질문 (한국어·영어)', 'Question to compare')} aria-label={L('질문', 'Question')} />
        {allowConfig && (
          <select className="input w-auto" value={config} onChange={(e) => setConfig(e.target.value as ConfigKey)} aria-label={L('설정', 'Config')}>
            <option value="locked">{L('확정 설정', 'Locked')}</option><option value="equal40">{L('실험: 동일 가중 40/40', 'Experiment: equal 40/40')}</option>
          </select>
        )}
        <button type="submit" className="btn-primary" disabled={busy}><Icon name={busy ? 'refresh' : 'evaluation'} size={15} className={busy ? 'animate-spin' : ''} />{L('비교', 'Compare')}</button>
      </form>
      <p className="mt-1.5 text-[11px] text-faint">{L('자유 질문에는 정답 목록이 없어 Recall 을 계산하지 않습니다. 점수는 순위를 정하는 원점수이며 정답 확률이 아닙니다.', 'Free questions have no gold list, so no recall. Scores are raw ranking scores, not probabilities.')}</p>
      {err && <div className="mt-2"><Notice tone="danger">{err}</Notice></div>}
      {r && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted">
            <span>{r.settings.label[lang]}: {L('벡터', 'vector')} {r.settings.vector_weight} · BM25 {L('후보', 'cand.')} {r.settings.bm25_k} · {L('벡터 후보', 'vector cand.')} {r.settings.vector_k} · RRF k {r.settings.rrf_k}</span>
            <span>BM25 {r.timing.bm25_ms} ms{r.timing.dense_ms !== undefined && ` · Dense ${r.timing.dense_ms} ms`}</span>
            {r.terms.length > 0 && <span>{L('용어 매핑', 'Term map')}: {r.terms.map((t) => `${t.ko}→${t.en}`).join(', ')}</span>}
          </div>
          {r.fallback_reason && <Notice tone="caution">{L('의미 검색 불가', 'Dense unavailable')}: {r.fallback_reason}</Notice>}
          <div className="grid gap-3 lg:grid-cols-3">
            {cols.map(({ m, label }) => {
              const col = r.modes[m]
              return (
                <div key={m} className="rounded-xl border border-line">
                  <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-bold">{label}
                    {col && <span className="text-[11px] font-normal text-muted">{L('후보', 'cand.')} {col.candidates} · cap {col.skipped_by_cap}</span>}</div>
                  {!col ? <p className="p-3 text-xs text-muted">{L('사용 불가', 'Unavailable')}</p> : (
                    <ol className="divide-y divide-line">
                      {col.results.map((e) => (
                        <li key={e.i} className="px-3 py-2 text-xs">
                          <div className="flex gap-2"><b className="text-faint">{e.rank}</b><span className="font-semibold leading-snug">{e.title}</span></div>
                          <div className="mt-0.5 pl-4 text-[10px] text-muted">{e.year ?? ''}{e.page ? ` · p.${e.page}` : ''} · BM25 {e.bm25_rank ?? '—'}{e.bm25_score !== null && `(${e.bm25_score})`} · Dense {e.dense_rank ?? '—'}{e.cosine !== null && `(${e.cosine})`}{e.rrf !== null && ` · RRF ${e.rrf}`}</div>
                          <p className="mt-0.5 line-clamp-2 pl-4 text-[11px] text-muted">{e.text}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
