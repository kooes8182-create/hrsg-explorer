import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, useLocation } from 'react-router-dom'
import CaseSwitcher from '../components/CaseSwitcher'
import { ErrorBoundary, ErrorState } from '../components/feedback'
import Icon from '../components/Icon'
import Copilot from '../components/chat/Copilot'
import { GlobalSearch, ToastHost } from '../components/shell'
import { HealthIndicator, SaveIndicator } from '../components/StatusIndicators'
import { useT } from '../i18n'
import { fmtDateTime } from '../lib/format'
import { currentCase, useApp } from '../store/app'
import { useCaseData } from '../store/caseData'
import { useCopilot } from '../store/copilot'
import NotificationCenter from '../components/notifications/NotificationCenter'
import { startNotifications } from '../store/notifications'
import { PAGES } from './routes'
import { HOME, menuFor, type Role, type SessionUser } from './access'
import { AccountMenu, BootScreen, RoleOutlet } from '../components/account'
import { useAuth } from '../store/auth'
import MobileLayout from '../mobile/MobileLayout'
import { MOBILE_SERVER, useMedia, useMobileUI } from '../lib/media'
import { useUi } from '../store/ui'

const HEALTH_INTERVAL_MS = 30_000


/** 흰 사이드바: 그룹 레이블(영문), 선 아이콘, 선택 메뉴는 크림 배경 + 오렌지 아이콘 */
function Sidebar({ collapsed, onNavigate, user }: { collapsed: boolean; onNavigate?: () => void; user: SessionUser }) {
  const t = useT()
  const cur = useApp(currentCase)
  const plant = user.role === 'PLANT_ENGINEER'
  return (
    <div className="flex h-full flex-col border-r border-line bg-side text-side-ink">
      <Link to={HOME[user.role]} onClick={onNavigate} className={`flex items-center gap-2.5 px-5 pb-3 pt-5 ${collapsed ? 'justify-center px-2' : ''}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white shadow-[0_4px_12px_-4px_rgb(234_88_12/.6)]" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 15h4l2-6 3 10 2-7 2 3h5" />
          </svg>
        </span>
        {!collapsed && (
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-tight text-ink">{t('app.title')}</span>
            <span className="block text-[11px] text-side-muted">{t('app.subtitle')}</span>
          </span>
        )}
      </Link>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
        {menuFor(user.role).map((g) => (
          <div key={g.key} className="mt-5 first:mt-2">
            {!collapsed ? <div className="px-3 pb-2 text-[10px] font-bold tracking-[0.14em] text-side-muted">{t(`group.${g.key}`)}</div>
              : <div className="mx-2 mb-2 border-t border-line" aria-hidden="true" />}
            {g.pages.map((p) => {
              const title = t(`page.${p.key}.title`)
              return (
                <NavLink key={p.path} to={p.path} onClick={onNavigate} title={collapsed ? title : undefined}
                  className={({ isActive }) =>
                    `group mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors ${collapsed ? 'justify-center px-0' : ''} ${
                      isActive ? 'bg-accent-soft font-semibold text-ink' : 'text-muted hover:bg-side-hover hover:text-ink'}`}>
                  {({ isActive }) => (
                    <>
                      <Icon name={p.icon} size={18} className={isActive ? 'text-accent' : 'text-faint group-hover:text-slate'} />
                      {!collapsed ? <span className="flex-1 truncate">{title}</span> : <span className="sr-only">{title}</span>}
                      {!collapsed && isActive && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className={`m-3 rounded-xl border border-line bg-canvas p-3 ${collapsed ? 'm-2 p-2 text-center' : ''}`}>
        {!collapsed && (
          <>
            <div className="text-[10px] font-bold tracking-[0.12em] text-side-muted">{plant ? t('shell.currentCase') : (user.role_label as Record<string, string>)[document.documentElement.lang === 'en' ? 'en' : 'ko']}</div>
            <div className="mt-0.5 truncate text-[13px] font-semibold text-ink" title={plant ? cur?.name : user.name}>{plant ? (cur?.name ?? t('shell.noCase')) : user.name}</div>
          </>
        )}
        <div className={collapsed ? '' : 'mt-1.5'}><HealthIndicator compact={collapsed} /></div>
      </div>
    </div>
  )
}

function lastCheckText(d: Date | null, lang: string) {
  return d ? d.toLocaleTimeString(lang === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
}

/** PC·모바일 화면이 함께 쓰는 시작 작업: 언어, 30초 연결 점검, 케이스·입력값 불러오기, 알림 센터 */
function useAppBoot(role: Role) {
  const plant = role === 'PLANT_ENGINEER'
  const lang = useApp((s) => s.lang)
  const checkHealth = useApp((s) => s.checkHealth)
  const loadCases = useApp((s) => s.loadCases)
  const healthState = useApp((s) => s.health.state)
  const casesStatus = useApp((s) => s.casesStatus)
  const currentCaseId = useApp((s) => s.currentCaseId)
  const loadCaseData = useCaseData((s) => s.load)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  useEffect(() => {
    checkHealth()
    if (plant) loadCases() // 케이스·체크리스트·알림은 플랜트 업무 데이터 — AI 관리자는 불러오지 않음
    const timer = setInterval(checkHealth, HEALTH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [checkHealth, loadCases, plant])
  // 케이스가 바뀌면 그 케이스의 입력값·결과를 불러옵니다 (모든 화면이 같은 데이터를 봄).
  useEffect(() => {
    if (plant && currentCaseId !== null) loadCaseData(currentCaseId)
  }, [plant, currentCaseId, loadCaseData])
  // 서버가 다시 연결되면 케이스 목록을 다시 불러옵니다.
  useEffect(() => {
    if (plant && healthState === 'ok' && casesStatus === 'error') loadCases()
  }, [plant, healthState, casesStatus, loadCases])
  useEffect(() => {
    if (plant) startNotifications()
  }, [plant])
}

/** 로그인 확인 → (로그인 안 됨) 로그인 화면 / (확인 중) 빈 로딩 화면 / (로그인됨) 역할별 화면.
 *  같은 주소에서 화면 폭에 따라 PC 화면(사이드바) 또는 모바일 화면(하단 메뉴)을 보여 줍니다. */
export default function Layout() {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const check = useAuth((s) => s.check)
  const loc = useLocation()
  useEffect(() => {
    check() // 새로고침해도 서버 세션으로 로그인 상태 복원
  }, [check])
  if (status === 'checking') return <BootScreen />
  if (status === 'anon' || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <AuthedLayout user={user} />
}

function AuthedLayout({ user }: { user: SessionUser }) {
  useAppBoot(user.role)
  return useMobileUI() ? <MobileLayout user={user} /> : <DesktopLayout user={user} />
}

function DesktopLayout({ user }: { user: SessionUser }) {
  const plant = user.role === 'PLANT_ENGINEER'
  const t = useT()
  const loc = useLocation()
  const lang = useApp((s) => s.lang)
  const theme = useApp((s) => s.theme)
  const savedCollapsed = useApp((s) => s.sidebarCollapsed)
  // AI 사이드 패널: 화면이 1600px 이상이면 본문을 패널 너비만큼 줄여 가리지 않게 하고(메뉴는 잠시 아이콘만),
  // 그보다 좁으면 본문 위에 겹쳐 띄웁니다. 메뉴 접힘 설정 자체는 바꾸지 않습니다.
  const chatPanel = useCopilot((s) => s.isChatOpen && s.chatMode === 'panel')
  const roomy = useMedia('(min-width: 1600px)')
  const pushChat = chatPanel && roomy && loc.pathname !== '/ai-assistant'
  const collapsed = savedCollapsed || pushChat
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const setLang = useApp((s) => s.setLang)
  const setTheme = useApp((s) => s.setTheme)
  const checkHealth = useApp((s) => s.checkHealth)
  const healthState = useApp((s) => s.health.state)
  const checkedAt = useApp((s) => s.health.checkedAt)
  const lastCalc = useCaseData((s) => s.results?.last_calculated_at ?? null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const uiPref = useUi((s) => s.pref)
  const setUiPref = useUi((s) => s.setPref)
  const narrow = useMedia('(max-width: 767px)')

  const page = PAGES.find((p) => loc.pathname === p.path || loc.pathname.startsWith(p.path + '/'))
  const group = page && menuFor(user.role).find((g) => g.pages.includes(page))

  useEffect(() => {
    document.title = page ? `${t(`page.${page.key}.title`)} · HRSG Explorer` : 'HRSG Explorer'
  }, [page, t])
  useEffect(() => setMobileOpen(false), [loc.pathname])

  const wide = collapsed ? 76 : 260
  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">{t('shell.skip')}</a>

      {/* 데스크톱: 고정 사이드바 (접기 가능) · 태블릿: 아이콘 사이드바 */}
      <style>{`:root{--side-w:76px} @media (min-width:1024px){:root{--side-w:${wide}px}}`}</style>
      <aside className="relative hidden shrink-0 transition-[width] duration-200 md:block" style={{ width: 'var(--side-w)' }}>
        <div className="fixed inset-y-0 left-0 z-20 transition-[width] duration-200" style={{ width: 'var(--side-w)' }}>
          <div className="h-full lg:hidden"><Sidebar collapsed user={user} /></div>
          <div className="hidden h-full lg:block"><Sidebar collapsed={collapsed} user={user} /></div>
          <button type="button" onClick={toggleSidebar} aria-label={collapsed ? t('shell.expand') : t('shell.collapse')}
            className="absolute -right-3 top-8 hidden h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card hover:text-accent lg:flex">
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={14} />
          </button>
        </div>
      </aside>

      {/* 휴대폰: 햄버거 메뉴 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('shell.openMenu')}>
          <div className="absolute inset-0 bg-[rgb(var(--ink)/.4)]" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[272px] animate-page-in shadow-pop">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} user={user} />
            <button type="button" className="btn-icon absolute right-2 top-4" onClick={() => setMobileOpen(false)} aria-label={t('shell.closeMenu')}><Icon name="x" /></button>
          </div>
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${pushChat ? 'pr-[520px]' : ''}`}>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:px-8">
            <button type="button" className="btn-icon md:hidden" onClick={() => setMobileOpen(true)} aria-label={t('shell.openMenu')}><Icon name="menu" size={20} /></button>
            <div className="hidden min-w-0 flex-1 sm:block"><GlobalSearch role={user.role} /></div>
            {plant && <div className="order-last w-full sm:order-none sm:w-auto"><CaseSwitcher /></div>}
            {plant && <div className="hidden items-center gap-3 border-l border-line pl-3 xl:flex">
              <SaveIndicator />
              <span className="inline-flex items-center gap-1 text-xs text-muted" title={t('header.lastCalc')}>
                <Icon name="clock" size={14} />{lastCalc ? `${t('header.lastCalc')} ${fmtDateTime(lastCalc, lang)}` : t('header.noCalc')}
              </span>
            </div>}
            <div className="ml-auto flex items-center gap-1 sm:ml-0 sm:border-l sm:border-line sm:pl-3">
              <span className="hidden px-1 sm:inline-flex" title={`${t('health.lastChecked')} ${lastCheckText(checkedAt, lang)}`}><HealthIndicator compact /></span>
              <div className="flex rounded-lg bg-sunken p-0.5 text-[11px] font-bold" role="group" aria-label={t('lang.label')}>
                {(['ko', 'en'] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
                    className={`rounded-md px-2 py-1 transition-colors ${lang === l ? 'bg-surface text-ink shadow-card' : 'text-faint hover:text-ink'}`}>{l.toUpperCase()}</button>
                ))}
              </div>
              {plant && <NotificationCenter />}
              <button type="button" className="btn-icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('theme.toggle')} title={t('theme.toggle')}>
                <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
              </button>
              <span className="ml-1 border-l border-line pl-2"><AccountMenu user={user} /></span>
            </div>
          </div>
          {(healthState === 'unreachable' || healthState === 'db_error') && (
            <div role="alert" className="flex items-center gap-2 border-t border-danger/30 bg-danger-soft px-4 py-1.5 text-xs font-medium text-danger lg:px-8">
              <Icon name="alert" size={14} />
              {healthState === 'unreachable' ? t('health.unreachable') : t('health.dbError')}
              <button type="button" className="ml-auto underline" onClick={checkHealth}>{t('health.checkNow')}</button>
            </div>
          )}
        </header>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-7">
          {/* 휴대폰 접속용 서버에서 'PC 화면으로 보기'를 고른 경우에만: 모바일 화면으로 돌아가기 */}
          {MOBILE_SERVER && uiPref === 'desktop' && narrow && (
            <button type="button" className="btn-ghost mb-4 min-h-[44px] w-full justify-center" onClick={() => setUiPref('auto')}><Icon name="dashboard" size={16} />{lang === 'ko' ? '모바일 화면으로 보기' : 'Use mobile layout'}</button>
          )}
          {/* 페이지 머리: 그룹 · 제목 · 한 줄 설명 · 주요 동작(페이지가 PageActions 로 넣음) */}
          {page && (
            <div className="mx-auto mb-6 flex max-w-[1500px] flex-wrap items-end gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1">
                {group && <div className="eyebrow mb-1.5 text-accent">{t(`group.${group.key}`)}</div>}
                <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink sm:text-[28px]">{t(`page.${page.key}.title`)}</h1>
                <p className="mt-1 text-sm text-muted">{t(`page.${page.key}.desc`)}</p>
              </div>
              <div id="page-actions" className="flex flex-wrap items-center gap-2 empty:hidden" />
            </div>
          )}
          {/* 화면이 바뀔 때 짧게 나타나기 + 화면 하나의 오류가 앱 전체를 멈추지 않게 */}
          <div key={loc.pathname} className="animate-page-in motion-reduce:animate-none">
            <ErrorBoundary resetKey={loc.pathname} fallback={(reset) => <ErrorState text={t('shell.screenError')} onRetry={reset} />}>
              <RoleOutlet user={user} />
            </ErrorBoundary>
          </div>
        </main>
        <footer className="px-4 pb-24 text-[11px] text-faint lg:px-8">{t('shell.demoNotice')}</footer>
      </div>
      {plant && <Copilot />}
      <ToastHost />
    </div>
  )
}
