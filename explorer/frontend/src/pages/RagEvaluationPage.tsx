import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { ConfigKey, Experiments, Label } from '../api/rag'
import LineChart from '../components/charts/LineChart'
import CompareSearch from '../components/CompareSearch'
import Icon from '../components/Icon'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Notice, Tabs } from '../components/ui'
import { useL } from '../i18n'
import { fmtDateTime, fmtNum } from '../lib/format'

// AI 관리자는 조회 전용 — 새 평가 실행·정답 라벨 추가/수정/삭제는 서버 권한표에서 BLOCKED (accounts/policy.py)
const READ_ONLY = true
import { useApp } from '../store/app'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1))

export default function RagEvaluationPage() {
  const L = useL()
  const [tab, setTab] = useState<'records' | 'compare' | 'labels'>('records')
  const [x, setX] = useState<Experiments | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => api<Experiments>('/rag/experiments/').then(setX).catch(() => setFailed(true)), [])
  useEffect(() => {
    load()
  }, [load])
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="card px-4 pt-2">
        <Tabs tabs={[{ id: 'records' as const, label: L('실험 기록 · 재현 확인', 'Records · reproduction') }, { id: 'compare' as const, label: L('질문별 검색 비교', 'Per-question comparison') }, { id: 'labels' as const, label: L('정답 라벨 · 피드백', 'Labels · feedback') }]} value={tab} onChange={setTab} />
      </div>
      {failed && <Notice tone="danger">{L('기록을 불러오지 못했습니다.', 'Could not load records.')}</Notice>}
      {tab === 'records' && x && <Records x={x} reload={load} />}
      {tab === 'compare' && <Card title={L('BM25 / BGE-M3 / Hybrid 비교', 'BM25 / BGE-M3 / Hybrid')} icon="evaluation"><CompareSearch allowConfig /></Card>}
      {tab === 'labels' && <Labels />}
    </div>
  )
}

function Records({ x, reload }: { x: Experiments; reload: () => void }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [running, setRunning] = useState<ConfigKey | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const runDev = async (c: ConfigKey) => {
    setRunning(c)
    setErr(null)
    try {
      await api(`/rag/experiments/run-dev/`, { method: 'POST', json: { config: c } })
      reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.text[lang] : String(e))
    } finally {
      setRunning(null)
    }
  }
  const t = (g: string) => x.test_locked.find((r) => r.group === g)
  const v = x.verify
  const stage1 = x.dev_experiments.filter((r) => r.stage === 'stage1')
  const models = [...new Set(stage1.map((r) => r.model))]
  const baseline = x.dev_experiments.find((r) => r.stage === 'baseline')
  const stage2 = x.dev_experiments.filter((r) => r.stage === 'stage2')
  const locked = x.configs.locked
  return (
    <div className="space-y-4">
      {/* test 확정 결과 */}
      <Card title={L('확정 설정의 test 결과 (공식 평가셋 v1)', 'Locked config — test results (official eval set v1)')} icon="evaluation" aside={<ReliabilityBadge kind="VERIFIED" title={L('저장된 공식 기록', 'Stored official record')} />}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [L('전체 Recall@8 (test)', 'All Recall@8 (test)'), t('test 전체')],
            [L('한국어 Recall@8 (test)', 'Korean Recall@8 (test)'), t('test 한국어')],
            [L('영어 Recall@8 (test)', 'English Recall@8 (test)'), t('test 영어')],
            [L('전체 Recall@8 (dev+test)', 'All Recall@8 (dev+test)'), t('전체 (dev+test)')],
          ].map(([label, r]) => r && typeof r !== 'string' ? (
            <div key={label as string} className="rounded-xl border border-line p-4">
              <div className="text-xs font-semibold text-muted">{label as string} · n={r.n}</div>
              <div data-kpi className="mt-1 text-[28px] font-bold tracking-tight text-ink">{pct(r.locked_recall)}<span className="ml-0.5 text-base text-muted">%</span></div>
              <div className="text-xs text-muted">{L('BM25 기준선', 'BM25 baseline')} {pct(r.base_recall)}% → <b className="text-good">+{fmtNum(r.recall_delta_pp, lang, 1)}%p</b> · MRR {r.locked_mrr.toFixed(3)}</div>
            </div>
          ) : null)}
        </div>
        <p className="mt-3 text-xs text-muted">
          {L('확정 설정', 'Locked')}: BGE-M3 · {L('벡터', 'vector')} {locked.vector_weight} / BM25 {(1 - locked.vector_weight).toFixed(1)} · {L('후보', 'cand.')} BM25 {locked.bm25_k} / {L('벡터', 'vector')} {locked.vector_k} · RRF k {locked.rrf_k} · {L('상위', 'top')} {locked.final_k} · {L('참고문헌당', 'per ref')} {locked.per_ref_cap}.{' '}
          {L(`test 는 설정을 확정한 뒤 한 번만 계산했고(${x.split_note.scored_test}문항, 한 문항 ≈ 3.3%p), 이 화면은 다시 채점하지 않습니다.`, `Test was scored once after locking (${x.split_note.scored_test} questions, one ≈ 3.3 pp); this page never re-scores it.`)}
        </p>
      </Card>

      {/* 재현 확인 */}
      <Card title={L('이 앱 검색의 재현 확인', 'Reproduction check of this app’s search')} icon="check">
        {v ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[[L('BM25 순위 일치', 'BM25 ranking match'), v.bm25_match], [L('결합(Hybrid) 순위 일치', 'Hybrid ranking match'), v.hybrid_match], [L('최종 상위 8개 일치', 'Final top-8 match'), v.top8_match]].map(([k, n]) => (
              <div key={k as string} className={`rounded-xl border p-4 ${n === v.questions ? 'border-good/40 bg-good-soft/40' : 'border-danger/40 bg-danger-soft/40'}`}>
                <div className="text-xs font-semibold text-muted">{k}</div>
                <div data-kpi className="mt-1 text-[28px] font-bold tracking-tight text-ink">{n}/{v.questions}</div>
              </div>
            ))}
            <p className="text-xs text-muted sm:col-span-3">{v.note} · {L('확인', 'Checked')} {fmtDateTime(v.checked_at, lang)} · {v.device} · {L('질의 중앙값', 'median query')} {v.query_ms_median} ms · {L('다시 확인', 'Re-run')}: <code>manage.py rag_verify</code></p>
          </div>
        ) : <Notice tone="muted">{L('재현 확인 기록이 없습니다. backend 에서 manage.py rag_verify 를 실행하세요.', 'No reproduction record. Run manage.py rag_verify.')}</Notice>}
      </Card>

      {/* dev 실험 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={L('1단계: 벡터 가중치별 dev 성능 (한국어 Recall@8)', 'Stage 1: dev Korean Recall@8 by vector weight')} icon="analysis">
          <LineChart
            ariaLabel={L('벡터 가중치별 한국어 Recall', 'Korean recall by vector weight')}
            series={models.map((m, i) => ({ id: m, label: m, color: (['s1', 's2', 's3'] as const)[i % 3], markers: true,
              points: stage1.filter((r) => r.model === m).map((r) => ({ x: (r.vector_weight ?? 0) * 100, y: r.ko_recall8 !== null ? r.ko_recall8 * 100 : null })).sort((a, b) => a.x - b.x) }))}
            xLabel={L('벡터(임베딩) 가중치 % — 나머지 BM25', 'Vector weight % — rest BM25')} yLabel="Recall@8 %"
            fmtY={(y) => fmtNum(y, lang, 1)} refLines={baseline?.ko_recall8 ? [{ y: baseline.ko_recall8 * 100, label: L('공식 BM25 기준선', 'Official BM25 baseline') }] : []}
          />
          <p className="mt-2 text-xs text-muted">{L(`dev ${x.split_note.scored_dev}문항 (한국어 32) 기준. 설정 조정은 dev 에서만 했습니다.`, `Dev ${x.split_note.scored_dev} questions (32 Korean). Tuning used dev only.`)}</p>
        </Card>
        <Card title={L('2단계: 후보 수·RRF k (dev)', 'Stage 2: candidates & RRF k (dev)')} icon="evaluation" bodyClass="p-0">
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-sunken text-muted"><tr>{[L('벡터', 'Vec'), 'BM25 k', L('벡터 k', 'Vec k'), 'RRF k', L('한국어 R@8', 'KO R@8'), L('전체 R@8', 'All R@8'), 'MRR'].map((h) => <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>)}</tr></thead>
              <tbody>
                {stage2.map((r, i) => {
                  const isLocked = r.vector_weight === locked.vector_weight && r.bm25_k === locked.bm25_k && r.vector_k === locked.vector_k && r.rrf_k === locked.rrf_k
                  return (
                    <tr key={i} className={`border-t border-line ${isLocked ? 'bg-accent-soft/50 font-bold' : ''}`}>
                      <td className="px-3 py-1">{r.vector_weight}{isLocked && ` ● ${L('확정', 'locked')}`}</td><td className="px-3 py-1 text-right">{r.bm25_k}</td><td className="px-3 py-1 text-right">{r.vector_k}</td><td className="px-3 py-1 text-right">{r.rrf_k}</td>
                      <td className="px-3 py-1 text-right">{pct(r.ko_recall8)}</td><td className="px-3 py-1 text-right">{pct(r.all_recall8)}</td><td className="px-3 py-1 text-right">{r.all_mrr?.toFixed(3)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 설정 비교 실행 (dev 만) */}
      <Card title={L('설정 비교 — dev 재실행 (공식 채점 복사본)', 'Config comparison — dev re-run (official scorer copy)')} icon="refresh">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr>{[L('설정', 'Config'), L('검증 여부', 'Validated'), L('전체 R@8', 'All R@8'), L('한국어 R@8', 'KO R@8'), L('영어 R@8', 'EN R@8'), 'MRR', L('실행', 'Run'), ''].map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>
              {(['locked', 'equal40'] as ConfigKey[]).map((c) => {
                const run = x.dev_runs[c]
                return (
                  <tr key={c} className="border-t border-line">
                    <td className="py-2 pr-3 font-semibold">{x.configs[c].label[lang]}</td>
                    <td className="py-2 pr-3">{x.configs[c].validated ? <ReliabilityBadge kind="VERIFIED" /> : <ReliabilityBadge kind="UNCONFIRMED" />}</td>
                    <td className="py-2 pr-3 tabular-nums">{pct(run?.summary.all?.recall)}</td>
                    <td className="py-2 pr-3 tabular-nums">{pct(run?.summary.ko?.recall)}</td>
                    <td className="py-2 pr-3 tabular-nums">{pct(run?.summary.en?.recall)}</td>
                    <td className="py-2 pr-3 tabular-nums">{run?.summary.all?.mrr.toFixed(3) ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs text-muted">{run ? fmtDateTime(run.ran_at, lang) : '—'}</td>
                    <td className="py-2">{READ_ONLY ? <span className="text-[11px] text-faint">{L('저장된 결과', 'Saved result')}</span> : <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={running !== null} onClick={() => runDev(c)}>
                      <Icon name="refresh" size={13} className={running === c ? 'animate-spin' : ''} />{L('dev 실행', 'Run dev')}</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {err && <div className="mt-2"><Notice tone="danger">{err}</Notice></div>}
        <p className="mt-2 text-xs text-muted">{L('dev 문항(64개 채점)만 씁니다. test 는 다시 계산하지 않습니다. 실험 설정(동일 가중 40/40)은 운영 기본값으로 쓰지 않습니다 — AI 도우미는 항상 확정 설정을 씁니다.', 'Uses dev only (64 scored). Test is never re-run. The experiment config is not used in production — the assistant always uses the locked config.')}</p>
        {x.dev_runs.locked && x.locked_meta && <p className="mt-1 text-xs text-muted">{L('확정 설정의 dev 재실행 값이 저장된 dev 기록(전체 0.935 · 한국어 0.907)과 같은지로 이 앱의 검색 재현도 함께 확인할 수 있습니다.', 'The locked dev re-run should equal the stored dev record (all 0.935 · KO 0.907), a second reproduction check.')}</p>}
      </Card>

      <Card title={L('확인되지 않은 수치 (프롬프트 기재)', 'Unverified figures (from the prompt)')} icon="alert">
        <ul className="space-y-1 text-sm">
          {x.unverified_claims.map((c) => <li key={c.claim} className="flex flex-wrap gap-2"><b>{c.claim}</b><span className="text-muted">— {c.status}</span></li>)}
        </ul>
        <p className="mt-2 text-xs text-muted">{L('서로 다른 데이터 분할에서 얻은 점수는 직접 비교하지 않습니다.', 'Scores from different splits are not compared directly.')} {x.source}</p>
      </Card>
    </div>
  )
}

function Labels() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const [rows, setRows] = useState<Label[]>([])
  const [form, setForm] = useState({ question: '', expected_refs: '', reviewer: '', memo: '' })
  const [err, setErr] = useState<string | null>(null)
  const load = () => api<Label[]>('/rag/labels/').then(setRows).catch(() => setRows([]))
  useEffect(() => {
    load()
  }, [])
  const add = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      await api('/rag/labels/', { method: 'POST', json: { ...form, lang: /[가-힣]/.test(form.question) ? 'ko' : 'en', expected_refs: form.expected_refs.split(',').map((s) => s.trim()).filter(Boolean) } })
      setForm({ question: '', expected_refs: '', reviewer: '', memo: '' })
      load()
    } catch (x) {
      setErr(x instanceof ApiError ? x.text[lang] : String(x))
    }
  }
  const setStatus = async (id: number, status: Label['status']) => {
    await api(`/rag/labels/${id}/`, { method: 'PATCH', json: { status } })
    load()
  }
  const del = async (id: number) => {
    if (!window.confirm(L('이 라벨을 삭제할까요?', 'Delete this label?'))) return
    await api(`/rag/labels/${id}/`, { method: 'DELETE' })
    load()
  }
  const exportFeedback = async () => {
    const data = await api('/rag/feedback/export/')
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'hrsg-eval-v2-candidates.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card title={L('정답 라벨 추가 (평가셋 v2 준비)', 'Add gold label (eval set v2)')} icon="edit">
        {READ_ONLY ? <div className="space-y-3"><Notice tone="muted">{L('AI 관리자는 조회 전용입니다. 업로드·삭제·재처리·재임베딩·새 평가 실행·정답 수정은 이번 권한에서 막혀 있습니다 (서버에서도 거부).', 'AI administrators have read-only access. Upload, delete, reprocess, re-embed, new runs and label edits are blocked (also refused by the server).')}</Notice><p className="text-[11px] text-faint">{L('공식 평가셋 v1 파일은 수정하지 않으며, 라벨은 이 앱 DB 에만 저장됩니다.', 'Official v1 files are never modified; labels live only in this app’s DB.')}</p></div> : <form onSubmit={add} className="space-y-3">
          <div><label className="label" htmlFor="lb-q">{L('질문', 'Question')}</label><textarea id="lb-q" className="input min-h-[70px]" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} /></div>
          <div><label className="label" htmlFor="lb-r">{L('정답 문헌 ref (쉼표로 구분, 지식베이스의 파일명)', 'Gold refs (comma-separated)')}</label><input id="lb-r" className="input" value={form.expected_refs} onChange={(e) => setForm({ ...form, expected_refs: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="lb-w">{L('검토자', 'Reviewer')}</label><input id="lb-w" className="input" value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} /></div>
            <div><label className="label" htmlFor="lb-m">{L('메모', 'Memo')}</label><input id="lb-m" className="input" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></div>
          </div>
          {err && <Notice tone="danger">{err}</Notice>}
          <button type="submit" className="btn-primary"><Icon name="plus" size={15} />{L('추가', 'Add')}</button>
          <p className="text-[11px] text-faint">{L('공식 평가셋 v1 파일은 수정하지 않고, 이 앱 DB 에만 저장합니다.', 'Saved only in this app’s DB; official v1 files are never modified.')}</p>
        </form>}
        <div className="mt-4 border-t border-line pt-3">
          <button type="button" className="btn-ghost" onClick={exportFeedback}><Icon name="copy" size={15} />{L('사용자 피드백 → 평가셋 v2 후보 내보내기 (JSON)', 'Export feedback → eval v2 candidates (JSON)')}</button>
        </div>
      </Card>
      <Card title={L(`라벨 (${rows.length})`, `Labels (${rows.length})`)} icon="checklist" bodyClass="p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">{L('라벨이 없습니다.', 'No labels yet.')}</p> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="p-4 text-sm">
                <div className="flex items-start gap-2">
                  <p className="flex-1 font-medium">{r.question}</p>
                  {READ_ONLY ? <span className="rounded-md bg-sunken px-2 py-0.5 text-xs text-muted">{{ DRAFT: L('초안', 'Draft'), REVIEWED: L('검토됨', 'Reviewed'), APPROVED: L('승인', 'Approved') }[r.status]}</span> : <>
                  <select className="input h-8 w-auto py-0 text-xs" value={r.status} onChange={(e) => setStatus(r.id, e.target.value as Label['status'])} aria-label={L('검증 상태', 'Status')}>
                    <option value="DRAFT">{L('초안', 'Draft')}</option><option value="REVIEWED">{L('검토됨', 'Reviewed')}</option><option value="APPROVED">{L('승인', 'Approved')}</option>
                  </select>
                  <button type="button" className="btn-icon hover:text-danger" aria-label={L('삭제', 'Delete')} onClick={() => del(r.id)}><Icon name="trash" size={15} /></button></>}
                </div>
                <div className="mt-1 text-xs text-muted">{r.expected_refs.join(', ') || '—'} · {r.reviewer || L('검토자 없음', 'no reviewer')} · {fmtDateTime(r.updated_at, lang)}{r.memo && ` · ${r.memo}`}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
