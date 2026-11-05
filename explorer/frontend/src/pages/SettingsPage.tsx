import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { AppSettings } from '../api/rag'
import type { Case } from '../api/types'
import { CaseFormDialog, DeleteCaseDialog } from '../components/CaseDialogs'
import Icon, { type IconName } from '../components/Icon'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Switch } from '../components/ui'
import { useL, useT } from '../i18n'
import { fmtNum, unitLabel } from '../lib/format'
import { useApp, type PressureUnit, type TempUnit } from '../store/app'
import { toast } from '../store/toast'
import { useCaseData } from '../store/caseData'

function Section({ title, desc, icon, children, aside }: { title: string; desc?: string; icon: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center gap-3 px-5 pb-1 pt-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name={icon} size={17} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-ink">{title}</h2>
          {desc && <p className="text-xs text-muted">{desc}</p>}
        </div>
        {aside}
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-1 rounded-xl bg-sunken p-1 text-sm" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
            className={`rounded-lg px-3 py-1.5 font-semibold transition-all ${value === o.v ? 'bg-surface text-accent-ink shadow-card' : 'text-muted hover:text-ink'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

type Row = { label: string; state: 'ok' | 'off' | 'error' | 'checking'; text: string; detail?: string }

function StatusRow({ row }: { row: Row }) {
  const dot = { ok: 'bg-good', off: 'bg-faint', error: 'bg-danger', checking: 'bg-faint animate-pulse' }[row.state]
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 font-medium">{row.label}</span>
      <span className="min-w-0 text-right">
        <span className="inline-flex items-center gap-2 text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          {row.text}
        </span>
        {row.detail && <span className="block text-xs text-faint">{row.detail}</span>}
      </span>
    </div>
  )
}

function CaseTable() {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const cases = useApp((s) => s.cases)
  const status = useApp((s) => s.casesStatus)
  const currentId = useApp((s) => s.currentCaseId)
  const switchCase = useApp((s) => s.switchCase)
  const cloneCase = useApp((s) => s.cloneCase)
  const loadCases = useApp((s) => s.loadCases)
  const [editing, setEditing] = useState<Case | null>(null)
  const [deleting, setDeleting] = useState<Case | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const last = cases.length <= 1

  const clone = async (c: Case) => {
    try {
      const n = await cloneCase(c.id)
      setNotice({ ok: true, text: t('case.cloned', { name: n.name }) })
      toast('ok', t('case.cloned', { name: n.name }))
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.text[lang] : String(e) })
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US')

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{t('case.clonePolicy')}</p>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          {t('case.new')}
        </button>
      </div>
      {notice && (
        <p role="status" className={`mb-3 rounded-lg px-3 py-2 text-sm ${notice.ok ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger'}`}>
          {notice.text}
        </p>
      )}
      {status === 'error' && (
        <button type="button" className="btn-ghost text-danger" onClick={loadCases}>
          {t('case.loadFailed')} · {t('common.retry')}
        </button>
      )}
      {status === 'loading' && cases.length === 0 && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {status === 'ready' && cases.length === 0 && <p className="text-sm text-muted">{t('case.empty')}</p>}
      {cases.length > 0 && (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-sunken text-left text-xs text-muted">
                <th className="px-5 py-2 font-semibold">{t('case.name')}</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">{t('case.created')}</th>
                <th className="px-5 py-2 text-right font-semibold"><span className="sr-only">actions</span></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const isCur = c.id === currentId
                return (
                  <tr key={c.id} className={`border-b border-line last:border-0 ${isCur ? 'bg-accent-soft/40' : ''}`}>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.name}</span>
                        <ReliabilityBadge kind={c.is_demo ? 'DEMO' : 'USER_INPUT'} />
                        {isCur && <span className="text-[11px] font-semibold text-accent-ink">● {t('case.current')}</span>}
                      </div>
                      {c.memo && <div className="mt-0.5 line-clamp-1 text-xs text-muted">{c.memo}</div>}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-muted sm:table-cell">{fmt(c.created_at)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        {!isCur && (
                          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => switchCase(c.id)}>
                            {t('case.switch')}
                          </button>
                        )}
                        <button type="button" className="btn-icon" title={t('case.rename')} aria-label={`${t('case.rename')}: ${c.name}`} onClick={() => setEditing(c)}>
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" className="btn-icon" title={t('case.clone')} aria-label={`${t('case.clone')}: ${c.name}`} onClick={() => clone(c)}>
                          <Icon name="copy" size={16} />
                        </button>
                        <button type="button" className="btn-icon hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted"
                          disabled={last} title={last ? t('case.lastCaseBlocked') : t('case.delete')} aria-label={`${t('case.delete')}: ${c.name}`}
                          onClick={() => setDeleting(c)}>
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {last && cases.length === 1 && <p className="mt-3 text-xs text-muted">{t('case.lastCaseBlocked')}</p>}
      {creating && <CaseFormDialog onClose={() => setCreating(false)} />}
      {editing && <CaseFormDialog edit={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteCaseDialog target={deleting} onClose={() => setDeleting(null)} />}
    </>
  )
}

function CalcSettings() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const schema = useCaseData((s) => s.schema)
  const values = useCaseData((s) => s.inputs?.values)
  const mode = useCaseData((s) => s.inputs?.mode)
  const rows: [string, React.ReactNode][] = [
    [L('계산 엔진', 'Engine'), <span className="inline-flex items-center gap-2"><ReliabilityBadge kind="DEMO" />{schema?.engine_version ?? '—'}</span>],
    [L('실제 성능 모델', 'Real performance model'), <ReliabilityBadge kind="MODEL_NOT_CONNECTED" />],
    [L('현재 케이스 평가 모드', 'Current case mode'), mode ?? '—'],
    [L('세정 전후 허용 편차', 'Before/after tolerance'), L('부하율 5%p · 외기 5 °C (DEMO 가드레일)', 'Load 5 pp · ambient 5 °C (DEMO guardrail)')],
    [L('기준 배압', 'Baseline BP'), values ? `${fmtNum(values.baselineBP as number, lang)} mmH₂O` : '—'],
    [L('기준 스택 온도', 'Baseline stack temp'), values?.baselineStackTempC != null ? `${values.baselineStackTempC} °C` : L('미입력 (세정 필요도 지수 보류)', 'Not set (index withheld)')],
    [L('단위 체계', 'Unit system'), L('SI 기준 + 표시 단위 전환', 'SI base + display conversion')],
  ]
  return (
    <div className="divide-y divide-line">
      {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>)}
      <p className="pt-2 text-xs text-muted">{L('기준값은 계산기 입력에서 바꿉니다. 계수·허용 편차는 DEMO 값으로 고정되어 있으며 승인된 값이 생기면 서버에서 교체합니다.', 'Change baselines in the calculator. Coefficients and tolerances are fixed DEMO values, replaced on the server when approved values exist.')}</p>
    </div>
  )
}

function RagSettings() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const checkHealth = useApp((s) => s.checkHealth)
  const [s, setS] = useState<AppSettings | null>(null)
  const [terms, setTerms] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    api<AppSettings>('/settings/').then((x) => { setS(x); setTerms(x.sensitive_terms.join('\n')) }).catch(() => setS(null))
  }, [])
  const save = async (patch: Record<string, unknown>) => {
    const x = await api<AppSettings>('/settings/', { method: 'PATCH', json: patch })
    setS(x)
    setTerms(x.sensitive_terms.join('\n'))
    setMsg(L('저장했습니다.', 'Saved.'))
    toast('ok', L('설정을 저장했습니다.', 'Settings saved.'))
    checkHealth()
  }
  if (!s) return <p className="text-sm text-muted">{L('불러오는 중…', 'Loading…')}</p>
  const c = s.search.configs.locked
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-start gap-3">
          <Switch checked={s.ai.external_enabled} disabled={!s.ai.key_configured} onChange={(v) => save({ ai_external_enabled: v })} label={L('외부 AI(Claude) 전송 허용', 'Allow sending to external AI (Claude)')} />
          <span>
            <b>{L('외부 AI(Claude) 전송 허용', 'Allow sending to external AI (Claude)')}</b>
            <span className="block text-xs text-muted">{L('켜면 마스킹한 질문과 검색된 문단(최대 8개), 첨부한 계산값만 Anthropic Claude API 로 보냅니다. corpus 전체·체크리스트·케이스 정보는 보내지 않습니다. 끄면 근거 검색만 합니다.', 'When on, only the masked question, up to 8 retrieved passages and an attached calculation are sent to the Anthropic Claude API. Off = evidence search only.')}</span>
            <span className="block text-xs text-muted">{L('API 키', 'API key')}: {s.ai.key_configured ? L('설정됨', 'set') : L('없음', 'missing')} · {L('모델', 'Model')}: {s.ai.model}</span>
          </span>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="sens">{L('민감 식별정보 목록 (발전소명·고객사명·이름 등, 한 줄에 하나)', 'Sensitive identifiers (plant, customer, names — one per line)')}</label>
        <textarea id="sens" className="input min-h-[80px] font-mono text-xs" value={terms} onChange={(e) => setTerms(e.target.value)} />
        <button type="button" className="btn-ghost mt-2 px-2 py-1 text-xs" onClick={() => save({ sensitive_terms: terms.split('\n') })}>{L('목록 저장', 'Save list')}</button>
        <p className="mt-1 text-[11px] text-faint">{L('전화번호·이메일·주민번호 형식은 항상 가립니다. 가린 문장만 저장합니다.', 'Phones, e-mails and ID numbers are always masked; only masked text is stored.')}</p>
      </div>
      <div className="rounded-xl bg-canvas p-4 text-xs">
        <div className="font-semibold">{L('검색 설정 (운영)', 'Search config (production)')}: {c.label[lang]} <ReliabilityBadge kind="VERIFIED" /></div>
        <div className="mt-1 text-muted">BM25 + BGE-M3 · {L('벡터', 'vector')} {c.vector_weight} / BM25 {(1 - c.vector_weight).toFixed(1)} · {L('후보', 'cand.')} {c.bm25_k}/{c.vector_k} · RRF k {c.rrf_k} · Top-k {c.final_k} · {L('참고문헌당', 'per ref')} {c.per_ref_cap}</div>
        <div className="mt-1 text-muted">{L('확정 설정은 test 결과를 본 뒤 바꾸지 않습니다. 다른 가중치는 RAG 평가 화면에서 dev 실험으로만 비교합니다.', 'The locked config is never changed after test; other weights are compared on dev only.')}</div>
        <div className="mt-1 text-muted">Cloudflare Workers AI / Vectorize: {L('미연결 (기본 로컬 실행)', 'not connected (local by default)')}</div>
      </div>
      {msg && <p className="text-xs text-good">{msg}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const theme = useApp((s) => s.theme)
  const setLang = useApp((s) => s.setLang)
  const setTheme = useApp((s) => s.setTheme)
  const setUnits = useApp((s) => s.setUnits)
  const pressureUnit = useApp((s) => s.pressureUnit)
  const tempUnit = useApp((s) => s.tempUnit)
  const L = useL()
  const health = useApp((s) => s.health)
  const checkHealth = useApp((s) => s.checkHealth)
  const [checking, setChecking] = useState(false)

  const d = health.data
  const reachable = health.state === 'ok' || health.state === 'db_error'
  const pending = health.state === 'checking'
  const reason = (r?: { ko: string; en: string } | null) => (r ? r[lang] : '—')
  const rows: Row[] = [
    { label: t('health.server'), state: pending ? 'checking' : reachable ? 'ok' : 'error', text: pending ? t('health.checking') : reachable ? 'OK · 127.0.0.1:8002' : t('health.unreachable') },
    { label: t('health.database'), state: pending ? 'checking' : d?.database === 'ok' ? 'ok' : 'error', text: pending ? t('health.checking') : d?.database === 'ok' ? 'OK · hrsg_explorer' : t('health.dbError') },
    { label: t('health.search'), state: d?.search.status === 'ready' ? 'ok' : 'error', text: d ? (d.search.status === 'ready' ? L('사용 가능 · 공식 corpus', 'Ready · official corpus') : L('사용 불가', 'Unavailable')) : '—' },
    { label: t('health.embedding'), state: d?.search.vector === 'ready' ? 'ok' : d?.search.vector === 'unavailable' ? 'error' : 'off',
      text: d ? ({ ready: L('불러옴', 'Loaded'), not_loaded: L('대기 (첫 질문 때 불러옴)', 'Idle (loads on first query)'), unavailable: L('사용 불가 → BM25 대체', 'Unavailable → BM25') }[d.search.vector]) : '—', detail: d?.search.reason ? reason(d.search.reason) : undefined },
    { label: t('health.ai'), state: d?.ai.status === 'ready' ? 'ok' : 'off', text: d ? (d.ai.key_configured ? t('health.keySet') : t('health.keyMissing')) : '—', detail: d ? reason(d.ai.reason) : undefined },
  ]

  const recheck = async () => {
    setChecking(true)
    await checkHealth()
    setChecking(false)
  }

  return (
    // 격자 칸은 min-w-0 이어야 안쪽 표가 칸을 넓히지 않고 자체 가로 스크롤을 씁니다.
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      <div className="lg:col-span-2">
        <Section title={t('settings.cases')} desc={t('settings.casesDesc')} icon="folder">
          <CaseTable />
        </Section>
      </div>

      <Section title={t('settings.env')} desc={t('settings.envDesc')} icon="settings">
        <Segmented label={t('lang.label')} value={lang} onChange={setLang} options={[{ v: 'ko', label: t('lang.ko') }, { v: 'en', label: t('lang.en') }]} />
        <Segmented label={t('theme.label')} value={theme} onChange={setTheme} options={[{ v: 'light', label: t('theme.light') }, { v: 'dark', label: t('theme.dark') }]} />
        <Segmented label={L('압력 표시 단위', 'Pressure display unit')} value={pressureUnit} onChange={(v) => setUnits({ pressureUnit: v })}
          options={(['mmH2O', 'kPa', 'inH2O', 'mbar'] as PressureUnit[]).map((u) => ({ v: u, label: unitLabel(u) }))} />
        <Segmented label={L('온도 표시 단위', 'Temperature display unit')} value={tempUnit} onChange={(v) => setUnits({ tempUnit: v })}
          options={(['°C', '°F'] as TempUnit[]).map((u) => ({ v: u, label: u }))} />
        <p className="mt-1 text-xs text-muted">{L('결과 표시에만 적용됩니다. 입력·저장·계산은 기준 단위(배압 mmH₂O, 차압 kPa, 드럼 bar, °C)로 하므로 물리량은 바뀌지 않습니다. 숫자는 언어 설정의 천 단위 구분을 씁니다.', 'Applies to result display only. Inputs, storage and calculation use base units, so physical values never change. Numbers use the language’s grouping.')}</p>
      </Section>

      <Section
        title={t('settings.system')}
        icon="server"
        aside={
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={recheck} disabled={checking}>
            <Icon name="refresh" size={14} className={checking ? 'animate-spin' : ''} />
            {t('health.checkNow')}
          </button>
        }
      >
        <div className="divide-y divide-line">
          {rows.map((r) => <StatusRow key={r.label} row={r} />)}
        </div>
        <p className="mt-2 text-xs text-faint">
          {t('health.lastChecked')}: {health.checkedAt ? health.checkedAt.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US') : '—'}
        </p>
      </Section>

      <Section title={t('settings.calc')} icon="calculator">
        <CalcSettings />
      </Section>

      <Section title={t('settings.rag')} icon="knowledge">
        <RagSettings />
      </Section>
    </div>
  )
}
