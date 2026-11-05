import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { GlossaryPayload } from '../api/engine'
import { canAccess, type Role } from '../app/access'
import { PAGES } from '../app/routes'
import { useAuth } from '../store/auth'
import { useL, useT } from '../i18n'
import { useApp } from '../store/app'
import { useToast } from '../store/toast'
import Icon from './Icon'

/** 페이지별 주요 동작 버튼을 페이지 머리(제목 오른쪽)에 놓습니다. */
export function PageActions({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => setEl(document.getElementById('page-actions')), [])
  return el ? createPortal(children, el) : null
}

/** 토스트: 화면 오른쪽 위(헤더 아래) — 아래쪽 Floating AI 버튼과 겹치지 않게. 알림 토스트는 누르면 관련 화면으로 이동 */
export function ToastHost() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)
  const navigate = useNavigate()
  const icon = { ok: 'check', error: 'alert', info: 'info', warn: 'alert' } as const
  const cls = { ok: 'text-good', error: 'text-danger', info: 'text-accent', warn: 'text-caution' }
  const bar = { ok: 'bg-good', error: 'bg-danger', info: 'bg-accent', warn: 'bg-caution' }
  return (
    <div className="pointer-events-none fixed right-4 top-[72px] z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 sm:right-6" role="status" aria-live="polite">
      {toasts.map((t) => {
        const body = (
          <>
            <span className={`absolute inset-y-0 left-0 w-1 ${bar[t.tone]}`} aria-hidden="true" />
            <Icon name={icon[t.tone]} size={16} className={`mt-0.5 ${cls[t.tone]}`} />
            <span className="min-w-0 flex-1 text-left">
              {t.title && <span className="block font-semibold text-ink">{t.title}</span>}
              <span className={t.title ? 'line-clamp-2 text-xs text-muted' : 'text-ink'}>{t.text}</span>
            </span>
          </>
        )
        return (
          <div key={t.id} className="pointer-events-auto relative flex animate-toast-in items-start gap-2.5 overflow-hidden rounded-xl border border-line bg-surface py-3 pl-4 pr-3 text-[13px] shadow-pop" data-toast={t.key ?? ''}>
            {t.to && canAccess(useAuth.getState().user?.role, t.to) ? (
              <button type="button" className="flex min-w-0 flex-1 items-start gap-2.5" onClick={() => { navigate(t.to!); dismiss(t.id) }}>{body}</button>
            ) : <span className="flex min-w-0 flex-1 items-start gap-2.5">{body}</span>}
            <button type="button" className="text-faint hover:text-ink" onClick={() => dismiss(t.id)} aria-label="close"><Icon name="x" size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}

type Hit = { kind: 'page' | 'term' | 'item'; label: string; sub?: string; to: string }

/** 상단 검색: 메뉴·용어집·체크리스트 항목(현재 케이스)을 찾아 바로 이동 (⌘K / Ctrl+K) */
export function GlobalSearch({ role }: { role: Role }) {
  const plant = role === 'PLANT_ENGINEER'
  const t = useT()
  const L = useL()
  const lang = useApp((s) => s.lang)
  const caseId = useApp((s) => s.currentCaseId)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [terms, setTerms] = useState<GlossaryPayload['glossary']>([])
  const [items, setItems] = useState<{ id: string; name: { ko: string; en: string } }[]>([])
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        box.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // 처음 검색할 때만 불러옴
  const load = () => {
    if (!plant) return // 용어집·체크리스트 검색은 플랜트 업무 데이터 — AI 관리자는 메뉴만 검색
    if (!terms.length) api<GlossaryPayload>('/glossary/').then((g) => setTerms(g.glossary)).catch(() => undefined)
    if (caseId !== null) api<{ items: { id: string; name: { ko: string; en: string } }[] }>(`/cases/${caseId}/checklist/`).then((c) => setItems(c.items)).catch(() => undefined)
  }
  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const pages: Hit[] = PAGES.filter((p) => canAccess(role, p.path)).filter((p) => [t(`page.${p.key}.title`), t(`page.${p.key}.desc`), p.path].some((x) => x.toLowerCase().includes(s)))
      .map((p) => ({ kind: 'page', label: t(`page.${p.key}.title`), sub: t(`page.${p.key}.desc`), to: p.path }))
    const gl: Hit[] = terms.filter((g) => [g.term.ko, g.term.en, g.definition[lang]].some((x) => x.toLowerCase().includes(s)))
      .map((g) => ({ kind: 'term', label: g.term[lang], sub: L('용어집', 'Glossary'), to: `/reference?q=${encodeURIComponent(g.term.en)}` }))
    const it: Hit[] = items.filter((i) => [i.id, i.name.ko, i.name.en].some((x) => x.toLowerCase().includes(s)))
      .map((i) => ({ kind: 'item', label: `${i.id} ${i.name[lang]}`, sub: L('체크리스트 항목', 'Checklist item'), to: `/checklist?item=${i.id}` }))
    return [...pages, ...gl, ...it].slice(0, 8)
  }, [q, terms, items, t, lang, L, role])
  const go = (h: Hit) => {
    navigate(h.to)
    setQ('')
    setOpen(false)
    box.current?.blur()
  }
  const icon = { page: 'dashboard', term: 'reference', item: 'checklist' } as const

  return (
    <div className="relative w-full max-w-[320px]">
      <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={box}
        className="input h-9 rounded-xl bg-canvas pl-9 pr-12 text-[13px]"
        placeholder={L('메뉴·용어·항목 검색', 'Search menus, terms, items')}
        aria-label={L('검색', 'Search')}
        value={q}
        onFocus={() => { setOpen(true); load() }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setSel(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(hits.length - 1, x + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)) }
          else if (e.key === 'Enter' && hits[sel]) go(hits[sel])
          else if (e.key === 'Escape') { setQ(''); box.current?.blur() }
        }}
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1 text-[10px] text-faint sm:block">⌘K</kbd>
      {open && q.trim() && (
        <ul className="absolute left-0 right-0 top-11 z-50 max-h-80 animate-page-in overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop" role="listbox">
          {hits.length === 0 && <li className="px-3 py-2 text-xs text-muted">{L('찾은 결과가 없습니다', 'No results')}</li>}
          {hits.map((h, i) => (
            <li key={h.kind + h.to + h.label} role="option" aria-selected={i === sel}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${i === sel ? 'bg-accent-soft' : 'hover:bg-sunken'}`}>
                <Icon name={icon[h.kind]} size={15} className={i === sel ? 'text-accent' : 'text-faint'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{h.label}</span>
                  {h.sub && <span className="block truncate text-[11px] text-muted">{h.sub}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
