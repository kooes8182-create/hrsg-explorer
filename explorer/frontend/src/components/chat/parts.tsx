import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { AssistantPayload, Evidence, Message } from '../../api/rag'
import { useL } from '../../i18n'
import { fmtDateTime } from '../../lib/format'
import { useApp } from '../../store/app'
import Icon from '../Icon'
import ReliabilityBadge from '../ReliabilityBadge'
import { Notice } from '../ui'

// AI 채팅 공통 부품: 답변 말풍선·Markdown 본문·근거 카드. 플로팅 창과 /ai-assistant 화면이 함께 씁니다.

export const GEN_TEXT: Record<string, [string, string]> = {
  not_configured: ['AI 키가 없어 답변을 만들지 않았습니다. 아래 근거 문단을 확인하세요.', 'No AI key — no answer generated. See the evidence.'],
  disabled: ['외부 AI 전송이 꺼져 있어 답변을 만들지 않았습니다. 근거 문단만 제공합니다.', 'External AI is off — evidence only, no answer.'],
  no_passages: ['관련 근거 문단을 찾지 못했습니다. 근거가 부족해 답하지 않습니다.', 'No relevant passages found — not answering without evidence.'],
  refused: ['모델이 답변을 거절했습니다.', 'The model declined to answer.'],
}

const PAGE_LABEL: Record<string, { ko: string; en: string }> = {
  dashboard: { ko: '대시보드', en: 'Dashboard' }, calculator: { ko: '계산기', en: 'Calculator' }, simulation: { ko: '시뮬레이션', en: 'Simulation' },
  analysis: { ko: '심층 분석', en: 'Analysis' }, 'before-after': { ko: '세정 전후 비교', en: 'Before & after' }, checklist: { ko: '체크리스트', en: 'Checklist' },
}

export const citeOf = (e: Evidence, n: number) =>
  `[${n}] ${e.authors[0] ?? ''}${e.authors.length > 1 ? ' et al.' : ''} (${e.year ?? 'n.d.'}). ${e.title}.${e.page ? ` p.${e.page}.` : ''}${e.doi ? ` doi:${e.doi}` : ''}`

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function AnswerBubble({ m, selected, onSelect, onCite, onUpdate, inlineRefs = false }: {
  m: Message & { payload: AssistantPayload }
  selected: boolean
  onSelect: () => void
  onCite: (n: number) => void
  onUpdate: (m: Message) => void
  /** true: 근거 문헌을 답변 아래에 접어서 표시 (플로팅 창). false: 별도 근거 패널 사용 */
  inlineRefs?: boolean
}) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const p = m.payload
  const g = p.generation
  const [copied, setCopied] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [refsOpen, setRefsOpen] = useState(false)
  const [focus, setFocus] = useState<number | null>(null)
  const copy = async (what: 'answer' | 'refs') => {
    const refs = p.evidence.map((e, n) => citeOf(e, n + 1)).join('\n')
    if (await copyText(what === 'answer' ? `${m.text}\n\n${refs}` : refs)) setCopied(what)
  }
  const sendFeedback = async (r: 'up' | 'down') => {
    const updated = await api<Message>(`/messages/${m.id}/feedback/`, { method: 'POST', json: { rating: r, comment } })
    onUpdate(updated)
    setRating(null)
    setComment('')
  }
  const cite = (n: number) => {
    if (inlineRefs) {
      setRefsOpen(true)
      setFocus(n)
    }
    onCite(n)
  }
  const numWarn = g.warnings?.find((w) => w.type === 'unverified_numbers')
  return (
    <div onClick={onSelect} className={`rounded-2xl rounded-bl-md border p-3.5 text-sm transition-colors ${selected && !inlineRefs ? 'border-[rgb(var(--peach))] bg-surface shadow-card' : 'border-line bg-surface'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {g.status === 'ok' ? <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent-ink">Claude {g.model}</span> : <ReliabilityBadge kind="UNAVAILABLE" />}
        <span className="rounded-md bg-sunken px-1.5 py-0.5 text-muted">{p.mode.toUpperCase()}{p.fallback_reason && ` ← ${p.requested_mode.toUpperCase()} ${L('불가', 'unavailable')}`}</span>
        {p.snapshot && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-accent-ink">{L('스냅샷', 'Snapshot')} #{p.snapshot.id}</span>}
        {p.context && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-accent-ink">{L('화면', 'Screen')}: {p.context.label[lang]}</span>}
        <span className="ml-auto text-faint">{fmtDateTime(m.created_at, lang)}</span>
      </div>
      {p.fallback_reason && <div className="mb-2"><Notice tone="caution">{L('의미 검색을 쓸 수 없어 BM25 로 대체했습니다', 'Dense search unavailable — fell back to BM25')}: {p.fallback_reason}</Notice></div>}
      {g.status === 'ok' ? <AnswerMarkdown text={m.text} onCite={cite} /> : g.status === 'error' ? <Notice tone="danger">{g.message}</Notice> : <Notice tone="muted">{GEN_TEXT[g.status]?.[lang === 'ko' ? 0 : 1]}</Notice>}
      {numWarn && <div className="mt-2"><Notice tone="caution">{L('근거 문단·질문·계산값에서 확인되지 않은 수치', 'Numbers not found in evidence/question/calculation')}: <b>{numWarn.values?.join(', ')}</b> — {L('사실로 쓰기 전에 확인하세요.', 'verify before use.')}</Notice></div>}
      {g.warnings?.some((w) => w.type === 'no_citations') && <div className="mt-2"><Notice tone="caution">{L('답변에 인용 번호가 없습니다 — 근거와 연결되지 않은 답변일 수 있습니다.', 'No citations — the answer may not be grounded.')}</Notice></div>}
      {g.warnings?.some((w) => w.type === 'invalid_citations') && <div className="mt-2"><Notice tone="caution">{L('존재하지 않는 인용 번호를 지웠습니다.', 'Removed citation numbers that do not exist.')}</Notice></div>}
      {(p.snapshot || p.context) && g.status === 'ok' && <p className="mt-2 text-[11px] text-faint">{L('함께 쓴 계산값은 서버에 저장된 DEMO 계산값입니다 (실측 아님).', 'Attached values are server DEMO values (not measured).')}</p>}

      {inlineRefs && (
        <div className="mt-3 rounded-xl border border-line bg-canvas" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-ink" aria-expanded={refsOpen} onClick={() => setRefsOpen(!refsOpen)}>
            <Icon name="reference" size={14} className="text-accent" />{L('참고 문헌', 'References')} <span className="text-faint">{p.evidence.length}</span>
            <Icon name="chevronRight" size={14} className={`ml-auto text-faint transition-transform ${refsOpen ? 'rotate-90' : ''}`} />
          </button>
          {refsOpen && <div className="border-t border-line p-2"><EvidenceList p={p} focus={focus} compact /></div>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs" onClick={(e) => e.stopPropagation()}>
        {g.status === 'ok' && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => copy('answer')}><Icon name={copied === 'answer' ? 'check' : 'copy'} size={13} />{L('답변 복사', 'Copy answer')}</button>}
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => copy('refs')}><Icon name={copied === 'refs' ? 'check' : 'reference'} size={13} />{L('참고문헌 복사', 'Copy references')}</button>
        {!inlineRefs && (
          <>
            <Link to="/checklist" className="btn-ghost px-2 py-1 text-xs">{L('체크리스트', 'Checklist')}</Link>
            <Link to="/simulation" className="btn-ghost px-2 py-1 text-xs">{L('시뮬레이션', 'Simulation')}</Link>
            <Link to="/reference" className="btn-ghost px-2 py-1 text-xs">{L('용어집', 'Glossary')}</Link>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          {m.feedback ? <span className="text-muted">{L('검토 피드백', 'Feedback')}: {m.feedback.rating === 'up' ? '👍' : '👎'}</span> : (
            <>
              <button type="button" className="btn-icon h-7 w-7" aria-label={L('좋아요', 'Helpful')} onClick={() => setRating('up')}>👍</button>
              <button type="button" className="btn-icon h-7 w-7" aria-label={L('별로예요', 'Not helpful')} onClick={() => setRating('down')}>👎</button>
            </>
          )}
        </span>
        {rating && (
          <div className="flex w-full gap-1.5 pt-1">
            <input className="input h-8 flex-1 text-xs" placeholder={L('의견 (선택) — 평가셋 v2 후보로 저장', 'Comment (optional) — saved as eval-set v2 candidate')} value={comment} onChange={(e) => setComment(e.target.value)} />
            <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => sendFeedback(rating)}>{rating === 'up' ? '👍' : '👎'} {L('보내기', 'Send')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 사용자 질문 말풍선 (복사 버튼 포함) */
export function UserBubble({ m }: { m: Message }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [copied, setCopied] = useState(false)
  const pl = m.payload as { masking?: { type: string; count: number }[]; context?: string | null; snapshot_id?: number | null }
  return (
    <div className="group flex justify-end gap-1.5">
      <button type="button" className="btn-icon h-7 w-7 self-center opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={L('질문 복사', 'Copy question')}
        onClick={async () => setCopied(await copyText(m.text))}><Icon name={copied ? 'check' : 'copy'} size={13} /></button>
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-accent to-[rgb(var(--accent-ink))] px-4 py-2.5 text-sm text-white shadow-card">
        <p className="whitespace-pre-wrap">{m.text}</p>
        {(pl.context || pl.snapshot_id) && <div className="mt-1 text-[10px] opacity-80">{pl.context ? `${L('화면 데이터 첨부', 'Screen data attached')} · ${PAGE_LABEL[pl.context]?.[lang] ?? pl.context}` : `${L('스냅샷', 'Snapshot')} #${pl.snapshot_id}`}</div>}
        {(pl.masking?.length ?? 0) > 0 && (
          <div className="mt-1 text-[10px] opacity-80">{L('민감정보를 가린 뒤 저장·전송했습니다', 'Sensitive info masked before storage/sending')}: {pl.masking!.map((x) => `${x.type}×${x.count}`).join(', ')}</div>
        )}
        <span className="sr-only">{fmtDateTime(m.created_at, lang)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Markdown (안전한 일부 문법만, HTML 주입 없음)
// 지원: # 제목, 1.~6. 절 제목, - / * 목록, 1) 번호 목록, **굵게**, `코드`, [n] 인용 → 근거로 이동
function inline(text: string, onCite: (n: number) => void): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+(?:\s*,\s*\d+)*\])/g).map((seg, i) => {
    if (!seg) return null
    if (/^\*\*[^*]+\*\*$/.test(seg)) return <strong key={i} className="font-semibold text-ink">{seg.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(seg)) return <code key={i} className="rounded bg-sunken px-1 py-0.5 font-mono text-[12px]">{seg.slice(1, -1)}</code>
    const c = seg.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/)
    if (c) return (
      <Fragment key={i}>
        {c[1].split(/\s*,\s*/).map((n) => (
          <button key={n} type="button" onClick={(e) => { e.stopPropagation(); onCite(Number(n)) }}
            className="mx-0.5 rounded-md bg-accent-soft px-1 text-[11px] font-bold text-accent-ink hover:underline" aria-label={`근거 ${n}`}>[{n}]</button>
        ))}
      </Fragment>
    )
    return <Fragment key={i}>{seg}</Fragment>
  })
}

export function AnswerMarkdown({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const blocks = useMemo(() => {
    const out: ({ t: 'h'; s: string } | { t: 'p'; s: string } | { t: 'ul' | 'ol'; items: string[] })[] = []
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd()
      if (!line.trim()) continue
      const h = line.match(/^#{1,4}\s+(.*)$/)
      const ul = line.match(/^\s*[-*•]\s+(.*)$/)
      const ol = line.match(/^\s*\d+\)\s+(.*)$/)
      if (h) out.push({ t: 'h', s: h[1].replace(/\*\*/g, '') })
      else if (/^\s*[1-9]\.\s/.test(line) && line.length < 60) out.push({ t: 'h', s: line.trim().replace(/\*\*/g, '') })
      else if (ul || ol) {
        const kind = ul ? 'ul' : 'ol'
        const last = out[out.length - 1]
        if (last && last.t === kind) last.items.push((ul ?? ol)![1])
        else out.push({ t: kind, items: [(ul ?? ol)![1]] })
      } else out.push({ t: 'p', s: line })
    }
    return out
  }, [text])
  return (
    <div className="space-y-1.5 leading-relaxed text-slate">
      {blocks.map((b, i) =>
        b.t === 'h' ? <h4 key={i} className="pt-2 text-[13px] font-bold text-ink first:pt-0">{b.s}</h4>
          : b.t === 'p' ? <p key={i}>{inline(b.s, onCite)}</p>
            : b.t === 'ul' ? <ul key={i} className="list-disc space-y-0.5 pl-5 marker:text-soft">{b.items.map((x, j) => <li key={j}>{inline(x, onCite)}</li>)}</ul>
              : <ol key={i} className="list-decimal space-y-0.5 pl-5 marker:text-faint">{b.items.map((x, j) => <li key={j}>{inline(x, onCite)}</li>)}</ol>)}
    </div>
  )
}

// ---------------------------------------------------------------- 근거
/** 첨부한 서버 값(스냅샷·화면 맥락) + 근거 문단 목록 */
export function EvidenceList({ p, focus, compact = false }: { p: AssistantPayload; focus: number | null; compact?: boolean }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const refs = useRef<Record<number, HTMLLIElement | null>>({})
  useEffect(() => {
    if (focus) refs.current[focus]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focus])
  return (
    <div className="space-y-2">
      {!compact && <p className="text-[11px] text-muted">{p.verification.note[lang]} · {L('검색은 로컬 실행 (확정 설정: 벡터 0.7 / BM25 0.3, 참고문헌당 2개, 상위 8)', 'Search runs locally (locked: vector 0.7 / BM25 0.3, ≤2 per ref, top 8)')}</p>}
      {p.snapshot && <ServerLines title={L('첨부한 계산값 (서버, DEMO)', 'Attached calculation (server, DEMO)')} lines={p.snapshot.lines} />}
      {p.context && <ServerLines title={`${L('첨부한 화면 데이터 (서버, DEMO)', 'Attached screen data (server, DEMO)')} · ${p.context.label[lang]}`} lines={p.context.lines} />}
      <ol className="space-y-2">
        {p.evidence.map((e, n) => <EvidenceCard key={`${e.scope}-${e.i}`} e={e} n={n + 1} focused={focus === n + 1} compact={compact} liRef={(el) => (refs.current[n + 1] = el)} />)}
      </ol>
      {p.evidence.length === 0 && <Notice tone="muted">{L('근거 문단이 없습니다 — 근거 부족', 'No evidence — insufficient grounds')}</Notice>}
    </div>
  )
}

function ServerLines({ title, lines }: { title: string; lines: string[] }) {
  return (
    <details className="rounded-xl border border-[rgb(var(--peach))] bg-accent-soft p-2.5 text-xs">
      <summary className="cursor-pointer font-semibold text-accent-ink">{title}</summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted">{lines.map((x) => <li key={x}>{x}</li>)}</ul>
    </details>
  )
}

/** 근거 카드: 기본은 제목·페이지만, 누르면 원문 문단 (compact). 패널에서는 문단 앞부분을 함께 보여 줍니다. */
export function EvidenceCard({ e, n, focused, liRef, compact = false }: { e: Evidence; n: number; focused: boolean; liRef: (el: HTMLLIElement | null) => void; compact?: boolean }) {
  const L = useL()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (focused && compact) setOpen(true)
  }, [focused, compact])
  const who = e.authors.length ? `${e.authors[0]}${e.authors.length > 1 ? ' et al.' : ''}` : ''
  return (
    <li ref={liRef} className={`rounded-xl border bg-surface p-2.5 text-xs transition-shadow ${focused ? 'border-accent ring-2 ring-accent/25' : 'border-line'}`}>
      <div className="flex items-start gap-2">
        <span className="rounded-md bg-accent-soft px-1.5 font-bold text-accent-ink">[{n}]</span>
        <div className="min-w-0 flex-1">
          <button type="button" className="text-left font-semibold leading-snug text-ink hover:text-accent-ink" onClick={() => setOpen(!open)} aria-expanded={open}>{e.title}</button>
          <div className="mt-0.5 text-muted">{who} {e.year ?? ''}{e.page ? ` · p.${e.page}` : ''}{e.kind === 'note' ? ` · ${L('요약 노트', 'notes')}` : ''}
            {e.scope === 'UPLOAD' && <span className="ml-1 rounded bg-caution-soft px-1 text-[10px] font-semibold text-caution">{L('업로드 문헌 · 측정 안 됨', 'Upload · unmeasured')}</span>}</div>
          {e.doi && <a href={`https://doi.org/${e.doi}`} target="_blank" rel="noreferrer" className="break-all text-accent-ink hover:underline">doi:{e.doi}</a>}
        </div>
        {e.cited !== undefined && (e.cited
          ? <span className="shrink-0 rounded-md bg-good-soft px-1.5 py-0.5 text-[10px] font-semibold text-good">{L('인용됨', 'Cited')}</span>
          : <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[10px] text-muted">{L('미인용', 'Not cited')}</span>)}
      </div>
      {(!compact || open) && <p className={`mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink ${open ? '' : 'line-clamp-4'}`}>{e.text}</p>}
      <button type="button" className="mt-1 text-[11px] font-semibold text-accent-ink hover:underline" onClick={() => setOpen(!open)}>{open ? L('접기', 'Less') : L('원문 문단 펼치기', 'Show full passage')}</button>
      {(!compact || open) && e.bm25_rank !== undefined && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-faint">
          <span>{L('최종', 'Final')} #{e.rank}</span>
          <span>BM25 {e.bm25_rank ?? '—'}{e.bm25_score !== null && ` (${e.bm25_score})`}</span>
          <span>Dense {e.dense_rank ?? '—'}{e.cosine !== null && ` (cos ${e.cosine})`}</span>
          {e.rrf !== null && <span>RRF {e.rrf}</span>}
        </div>
      )}
    </li>
  )
}
