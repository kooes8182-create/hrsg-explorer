import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { GlossaryPayload } from '../api/engine'
import Icon from '../components/Icon'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { Card, Tabs } from '../components/ui'
import { useL, useT } from '../i18n'
import { useApp } from '../store/app'
import { canAccess } from '../app/access'
import { useAuth } from '../store/auth'
import { ErrorState, PageSkeleton } from '../components/feedback'

const PAGE_KEY: Record<string, string> = {
  '/dashboard': 'dashboard', '/simulation': 'simulation', '/calculator': 'calculator', '/analysis': 'analysis', '/before-after': 'beforeAfter',
}

export default function ReferencePage() {
  const role = useAuth((st) => st.user?.role)
  const L = useL()
  const t = useT()
  const lang = useApp((s) => s.lang)
  const [data, setData] = useState<GlossaryPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'glossary' | 'sources'>('glossary')
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  useEffect(() => {
    api<GlossaryPayload>('/glossary/').then(setData).catch(() => setFailed(true))
  }, [])

  const terms = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.glossary ?? []).filter((g) => !s || [g.term.ko, g.term.en, g.definition.ko, g.definition.en].some((x) => x.toLowerCase().includes(s)))
  }, [data, q])
  const titleOf = (key: string) => {
    const src = data?.categories[0].items.find((s) => s.key === key)
    return src ? (typeof src.title === 'string' ? src.title : src.title[lang]) : key
  }

  if (failed) return <ErrorState text={L('자료를 불러오지 못했습니다.', 'Could not load references.')} onRetry={() => location.reload()} />
  if (!data) return <PageSkeleton variant="cards" />

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="card p-5">
        <Tabs tabs={[{ id: 'glossary' as const, label: L(`용어집 (${data.glossary.length})`, `Glossary (${data.glossary.length})`) }, { id: 'sources' as const, label: L('참고 문헌·자료 분류', 'Sources & classification') }]} value={tab} onChange={setTab} />
      </div>

      {tab === 'glossary' ? (
        <>
          <input className="input max-w-sm" placeholder={L('용어 검색', 'Search terms')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L('용어 검색', 'Search terms')} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {terms.map((g) => (
              <article key={g.key} className="card p-5">
                <h3 className="font-bold">{g.term[lang]}</h3>
                <p className="mt-1 text-sm text-muted">{g.definition[lang]}</p>
                {g.formula && <code className="mt-2 block rounded-md bg-sunken px-2 py-1 font-mono text-xs">{g.formula}</code>}
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  {g.pages.filter((p) => canAccess(role, p)).map((p) => (
                    <Link key={p} to={p} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent-ink hover:underline">
                      <Icon name="chevronRight" size={11} />{t(`page.${PAGE_KEY[p] ?? 'dashboard'}.title`)}
                    </Link>
                  ))}
                  {g.sources.map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-muted"><Icon name="reference" size={11} />{titleOf(s)}</span>)}
                </div>
              </article>
            ))}
          </div>
          {terms.length === 0 && <p className="text-sm text-muted">{L('일치하는 용어가 없습니다.', 'No matching terms.')}</p>}
        </>
      ) : (
        <div className="space-y-4">
          {data.categories.map((c) => (
            <Card key={c.key} title={`${c.label[lang]} (${c.items.length})`} icon={c.key === 'PUBLIC' ? 'reference' : c.key === 'DEMO' ? 'flame' : c.key === 'UNVERIFIED' ? 'alert' : 'folder'}>
              {c.items.length === 0 ? <p className="text-sm text-muted">{c.empty?.[lang]}</p> : (
                <ul className="space-y-3">
                  {c.items.map((s) => (
                    <li key={s.key} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <b className="text-sm">{typeof s.title === 'string' ? s.title : s.title[lang]}</b>
                        {s.author && <span className="text-xs text-muted">{s.author}{s.year ? `, ${s.year}` : ''}</span>}
                        <ReliabilityBadge kind={c.key === 'PUBLIC' ? 'PUBLIC_REF' : c.key === 'DEMO' ? 'DEMO' : 'UNCONFIRMED'} />
                      </div>
                      {s.where && <div className="mt-1 text-xs text-muted">{s.where}</div>}
                      {s.quote && <blockquote className="mt-2 border-l-2 border-line pl-3 text-xs italic text-muted">“{s.quote}”</blockquote>}
                      <div className="mt-2 text-xs"><b>{L('범위·적용 한계', 'Scope & limits')}:</b> {s.scope[lang]}{s.limit && ` · ${s.limit[lang]}`}</div>
                      {s.checked_on && <div className="mt-1 text-[11px] text-faint">{L('원문 확인일', 'Checked on')} {s.checked_on}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          <p className="text-xs text-muted">{L('원문 PDF·웹 페이지 자체는 앱에서 제공하지 않습니다.', 'Original PDFs/pages are not served by the app.')}</p>
        </div>
      )}
    </div>
  )
}
