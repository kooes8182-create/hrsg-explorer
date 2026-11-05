import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { canAccess, HOME, menuFor, type Role, type SessionUser } from '../app/access'
import { PAGES } from '../app/routes'
import { AccessDenied } from '../components/account'
import { useAuth } from '../store/auth'
import Copilot from '../components/chat/Copilot'
import { ErrorBoundary, ErrorState } from '../components/feedback'
import Icon, { type IconName } from '../components/Icon'
import { ToastHost } from '../components/shell'
import { useL, useT } from '../i18n'
import { useKeyboardOpen, useOnline } from '../lib/media'
import { currentCase, useApp } from '../store/app'
import { useCaseData } from '../store/caseData'
import { useCopilot } from '../store/copilot'
import { useNotifications } from '../store/notifications'
import { useUi } from '../store/ui'
import MobileAI from './MobileAI'
import MobileAlerts from './MobileAlerts'
import MobileChecklist from './MobileChecklist'
import MobileHome from './MobileHome'
import { Switch } from '../components/ui'
import { BottomSheet } from './ui'

// 모바일 화면 틀: 위 헤더(로고·케이스·DEMO·알림·전체 메뉴) + 본문 + 아래 고정 메뉴 4개(홈·알림·점검·AI).
// 나머지 7개 화면은 '전체 메뉴'에서 열고, 기존 화면(반응형)을 그대로 씁니다. 데이터·API 는 PC 화면과 같습니다.

type Tab = { to: string; icon: IconName; ko: string; en: string }
// 역할별 하단 메뉴 (서버가 정한 역할 기준). 플랜트: 홈·알림·점검·AI / AI 관리자: RAG 두 화면
const TABS: Record<Role, Tab[]> = {
  PLANT_ENGINEER: [
    { to: '/dashboard', icon: 'dashboard', ko: '홈', en: 'Home' },
    { to: '/notifications', icon: 'bell', ko: '알림', en: 'Alerts' },
    { to: '/checklist', icon: 'checklist', ko: '점검', en: 'Check' },
    { to: '/ai-assistant', icon: 'sparkles', ko: 'AI', en: 'AI' },
  ],
  AI_ADMIN: [
    { to: '/rag-evaluation', icon: 'evaluation', ko: 'RAG 평가', en: 'RAG eval' },
    { to: '/knowledge-base', icon: 'knowledge', ko: '지식베이스', en: 'Knowledge' },
  ],
}
const MOBILE_PAGES: Record<string, () => JSX.Element> = {
  '/dashboard': MobileHome,
  '/notifications': MobileAlerts,
  '/checklist': MobileChecklist,
  '/ai-assistant': MobileAI,
}

export default function MobileLayout({ user }: { user: SessionUser }) {
  const plant = user.role === 'PLANT_ENGINEER'
  const L = useL()
  const t = useT()
  const loc = useLocation()
  const keyboard = useKeyboardOpen()
  const online = useOnline()
  const health = useApp((s) => s.health)
  const chatOpen = useCopilot((s) => s.isChatOpen)
  const setOrigin = useCopilot((s) => s.setOrigin)
  const [menu, setMenu] = useState(false)
  const last = useRef('/dashboard')

  // AI 탭을 열기 직전 화면을 기억 → AI 화면에서 그 화면에 맞춘 추천 질문
  useEffect(() => {
    if (loc.pathname === '/ai-assistant') setOrigin(last.current)
    else last.current = loc.pathname
    setMenu(false)
    window.scrollTo(0, 0)
  }, [loc.pathname, setOrigin])

  const allowed = canAccess(user.role, loc.pathname)
  const Page = allowed ? MOBILE_PAGES[loc.pathname] : undefined
  const page = PAGES.find((p) => loc.pathname === p.path || loc.pathname.startsWith(p.path + '/'))
  useEffect(() => {
    document.title = page ? `${t(`page.${page.key}.title`)} · HRSG Explorer` : 'HRSG Explorer'
  }, [page, t])
  const offline = !online || health.state === 'unreachable' || health.state === 'db_error'
  const navHidden = keyboard || chatOpen

  return (
    <div className="min-h-[100dvh] bg-canvas" data-mobile-ui>
      <MobileHeader onMenu={() => setMenu(true)} user={user} />
      {offline && (
        <div role="alert" className="sticky top-[calc(56px+env(safe-area-inset-top))] z-20 flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-xs font-medium text-danger">
          <Icon name="alert" size={14} />
          {!online ? L('네트워크 연결 없음 — 화면의 값은 마지막으로 받은 값입니다.', 'Offline — values shown are the last received.')
            : health.state === 'db_error' ? L('데이터베이스 연결 실패 — 저장할 수 없습니다.', 'Database unavailable — cannot save.')
              : L('서버 연결 불가 — 저장할 수 없습니다.', 'Server unreachable — cannot save.')}
          <button type="button" className="ml-auto min-h-[32px] font-semibold underline" onClick={() => useApp.getState().checkHealth()}>{L('다시 확인', 'Retry')}</button>
        </div>
      )}

      <main id="main" tabIndex={-1} className={`px-4 pt-4 ${navHidden ? 'pb-6' : 'pb-[calc(88px+env(safe-area-inset-bottom))]'}`}>
        {!Page && page && <h1 className="mb-3 text-[22px] font-bold tracking-tight text-ink">{t(`page.${page.key}.title`)}</h1>}
        <div key={loc.pathname} className="animate-page-in motion-reduce:animate-none">
          <ErrorBoundary resetKey={loc.pathname} fallback={(reset) => <ErrorState text={t('shell.screenError')} onRetry={reset} />}>
            {!allowed ? <AccessDenied user={user} /> : Page ? <Page /> : <Outlet />}
          </ErrorBoundary>
        </div>
        <p className="mt-6 text-center text-[11px] text-faint">{t('shell.demoNotice')}</p>
      </main>

      {!navHidden && <BottomNav tabs={TABS[user.role]} />}
      <MenuSheet open={menu} onClose={() => setMenu(false)} user={user} />
      {/* 화면의 'AI에게 질문하기'·알림 'AI 설명 요청'은 같은 AI 대화를 전체 화면으로 엽니다 (모바일은 떠 있는 버튼 대신 아래 AI 탭) */}
      {plant && <Copilot hideFab />}
      <ToastHost />
    </div>
  )
}

function MobileHeader({ onMenu, user }: { onMenu: () => void; user: SessionUser }) {
  const L = useL()
  const plant = user.role === 'PLANT_ENGINEER'
  const cur = useApp(currentCase)
  const mode = useCaseData((s) => s.inputs?.mode)
  const unread = useNotifications((s) => s.unread)
  const [cases, setCases] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-3">
        <Link to={HOME[user.role]} className="flex h-11 w-11 shrink-0 items-center justify-center" aria-label="HRSG Explorer">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 15h4l2-6 3 10 2-7 2 3h5" /></svg>
          </span>
        </Link>
        {!plant && (
          <span className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center px-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-faint">{L('RAG 관리', 'RAG management')}</span>
            <span className="truncate text-[14px] font-bold text-ink">{L(user.role_label.ko, user.role_label.en)}</span>
          </span>
        )}
        {plant && <button type="button" onClick={() => setCases(true)} className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-xl px-2 text-left active:bg-sunken" aria-label={L('평가 케이스 바꾸기', 'Change case')} data-case-chip>
          <span className="text-[10px] font-bold uppercase tracking-wide text-faint">{L('평가 케이스', 'Case')}</span>
          <span className="flex items-center gap-1 text-[14px] font-bold text-ink"><span className="truncate">{cur?.name ?? '—'}</span><Icon name="chevronDown" size={14} className="shrink-0 text-faint" /></span>
        </button>}
        {plant && mode && (
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${mode === 'DEMO' ? 'border border-dashed border-accent/60 text-accent-ink' : 'bg-info-soft text-info'}`} title={mode === 'DEMO' ? L('DEMO 값 (실측 아님)', 'DEMO values (not measured)') : L('사용자 입력값', 'User inputs')}>
            {mode === 'DEMO' ? 'DEMO' : L('입력값', 'USER')}
          </span>
        )}
        {plant && <Link to="/notifications" className="btn-icon relative h-11 w-11" aria-label={L(`알림 ${unread}개 읽지 않음`, `${unread} unread notifications`)}>
          <Icon name="bell" size={20} />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white ring-2 ring-surface">{unread > 99 ? '99+' : unread}</span>}
        </Link>}
        <button type="button" className="btn-icon h-11 w-11" onClick={onMenu} aria-label={L('전체 메뉴', 'All menus')}><Icon name="menu" size={20} /></button>
      </div>
      {plant && <CaseSheet open={cases} onClose={() => setCases(false)} />}
    </header>
  )
}

function BottomNav({ tabs }: { tabs: Tab[] }) {
  const L = useL()
  const unread = useNotifications((s) => s.unread)
  return (
    <nav aria-label={L('주요 메뉴', 'Main')} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md" data-bottom-nav>
      <ul className={`mx-auto grid h-16 max-w-md ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink to={tab.to} className={({ isActive }) => `relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${isActive ? 'text-accent-ink' : 'text-muted'}`}>
              {({ isActive }) => (
                <>
                  <span className={`absolute top-0 h-0.5 w-8 rounded-full ${isActive ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
                  <span className={`relative flex h-8 w-12 items-center justify-center rounded-full ${isActive ? 'bg-accent-soft text-accent' : ''}`}>
                    <Icon name={tab.icon} size={20} />
                    {tab.to === '/notifications' && unread > 0 && <span className="absolute right-1.5 top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" aria-hidden="true" />}
                  </span>
                  {L(tab.ko, tab.en)}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function CaseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const L = useL()
  const cases = useApp((s) => s.cases)
  const currentId = useApp((s) => s.currentCaseId)
  const switchCase = useApp((s) => s.switchCase)
  return (
    <BottomSheet open={open} onClose={onClose} title={L('평가 케이스', 'Evaluation case')}>
      <ul className="space-y-2" role="radiogroup" aria-label={L('평가 케이스 선택', 'Choose case')}>
        {cases.map((c) => (
          <li key={c.id}>
            <button type="button" role="radio" aria-checked={c.id === currentId} onClick={() => { switchCase(c.id); onClose() }}
              className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${c.id === currentId ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${c.id === currentId ? 'border-accent' : 'border-line'}`}>{c.id === currentId && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[14px] font-semibold text-ink">{c.name}</span>
                {c.memo && <span className="block truncate text-xs text-muted">{c.memo}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  )
}

function MenuSheet({ open, onClose, user }: { open: boolean; onClose: () => void; user: SessionUser }) {
  const logout = useAuth((s) => s.logout)
  const presentation = useUi((s) => s.presentation)
  const setPresentation = useUi((s) => s.setPresentation)
  const L = useL()
  const t = useT()
  const navigate = useNavigate()
  const lang = useApp((s) => s.lang)
  const theme = useApp((s) => s.theme)
  const setLang = useApp((s) => s.setLang)
  const setTheme = useApp((s) => s.setTheme)
  const setPref = useUi((s) => s.setPref)
  const tabPaths = new Set(TABS[user.role].map((x) => x.to))
  const others = menuFor(user.role).flatMap((g) => g.pages).filter((p) => !tabPaths.has(p.path))
  return (
    <BottomSheet open={open} onClose={onClose} title={L('전체 메뉴', 'All menus')}>
      <div className="mb-4 rounded-2xl border border-line bg-canvas p-3.5" data-account>
        <div className="truncate text-[15px] font-bold text-ink">{user.name}</div>
        <div className="mt-0.5 text-[12px] text-muted"><span className="font-mono">{user.employee_id}</span> · <b className="text-accent-ink" data-account-role>{L(user.role_label.ko, user.role_label.en)}</b></div>
        <label className="mt-3 flex min-h-[44px] items-center justify-between gap-3 text-[13px] text-ink" data-present-keep>
          <span><span className="block font-semibold">{L('발표 모드', 'Presentation mode')}</span><span className="block text-[11px] text-faint">{L('DEMO·가상 표시 숨김', 'Hide DEMO labels')}</span></span>
          <Switch checked={presentation} onChange={setPresentation} label={L('발표 모드', 'Presentation mode')} />
        </label>
        <button type="button" className="btn-ghost mt-3 min-h-[44px] w-full justify-center" onClick={() => logout()} data-logout>{L('로그아웃', 'Sign out')}</button>
      </div>
      {others.length > 0 && <ul className="grid grid-cols-2 gap-2">
        {others.map((p) => (
          <li key={p.key}>
            <button type="button" onClick={() => { navigate(p.path); onClose() }}
              className="flex min-h-[56px] w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[13px] font-semibold text-ink active:bg-accent-soft">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-slate"><Icon name={p.icon} size={16} /></span>
              <span className="min-w-0 flex-1 leading-snug">{t(`page.${p.key}.title`)}</span>
            </button>
          </li>
        ))}
      </ul>}
      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted">{L('언어', 'Language')}</span>
          <div className="flex rounded-lg bg-sunken p-0.5 text-xs font-bold" role="group" aria-label={L('언어', 'Language')}>
            {(['ko', 'en'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`min-h-[36px] rounded-md px-3 ${lang === l ? 'bg-surface text-ink shadow-card' : 'text-faint'}`}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <button type="button" className="flex min-h-[44px] w-full items-center justify-between text-[13px] text-muted" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {L('화면 테마', 'Theme')}<span className="flex items-center gap-1.5 font-semibold text-ink"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />{theme === 'dark' ? L('다크', 'Dark') : L('라이트', 'Light')}</span>
        </button>
        <button type="button" className="flex min-h-[44px] w-full items-center justify-between text-[13px] text-muted" onClick={() => { setPref('desktop'); onClose() }}>
          {L('PC 화면으로 보기', 'Use desktop layout')}<Icon name="chevronRight" size={16} className="text-faint" />
        </button>
      </div>
    </BottomSheet>
  )
}
