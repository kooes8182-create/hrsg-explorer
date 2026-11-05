import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { canAccess, HOME, type SessionUser } from '../app/access'
import { useL } from '../i18n'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { Switch } from './ui'
import Icon from './Icon'

// 로그인·역할 관련 공통 화면 조각: 인증 확인 중 화면, 접근 불가 안내, 시작 화면 이동, 계정 메뉴.

/** 인증 확인 중: 어떤 역할의 메뉴·데이터도 보이지 않게 로고만 */
export function BootScreen() {
  const L = useL()
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-canvas" role="status" aria-live="polite" data-boot>
      <span className="flex h-11 w-11 animate-pulse items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 15h4l2-6 3 10 2-7 2 3h5" /></svg>
      </span>
      <span className="text-[13px] text-muted">{L('로그인 상태 확인 중…', 'Checking your sign-in…')}</span>
    </div>
  )
}

/** '/'·없는 주소 → 내 역할의 시작 화면 */
export function HomeRedirect() {
  const user = useAuth((s) => s.user)
  return <Navigate to={user ? HOME[user.role] : '/login'} replace />
}

/** 역할에 맞지 않는 화면이면 내용 대신 접근 불가 안내 (서버 API 도 403 으로 막혀 있음) */
export function RoleOutlet({ user }: { user: SessionUser }) {
  const loc = useLocation()
  return canAccess(user.role, loc.pathname) ? <Outlet /> : <AccessDenied user={user} />
}

export function AccessDenied({ user }: { user: SessionUser }) {
  const L = useL()
  return (
    <div className="mx-auto mt-10 max-w-md rounded-[20px] border border-line bg-surface p-8 text-center shadow-card" role="alert" data-access-denied>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-caution-soft text-caution"><Icon name="alert" size={22} /></span>
      <h1 className="mt-4 text-[20px] font-bold text-ink">{L('접근할 수 없는 화면입니다', 'You cannot open this page')}</h1>
      <p className="mt-2 text-[14px] text-muted">{L(`이 화면은 현재 계정 역할(${user.role_label.ko})에 허용되지 않습니다.`, `This page is not available for your role (${user.role_label.en}).`)}</p>
      <Link to={HOME[user.role]} className="btn-primary mt-6 min-h-[44px] justify-center">{L('내 시작 화면으로', 'Go to my start page')}</Link>
    </div>
  )
}

/** 계정 메뉴 (두 역할 공통): 이름·사번·역할 + 로그아웃. API 키·시스템 설정은 넣지 않음 */
export function AccountMenu({ user, compact = false }: { user: SessionUser; compact?: boolean }) {
  const L = useL()
  const logout = useAuth((s) => s.logout)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const presentation = useUi((s) => s.presentation)
  const setPresentation = useUi((s) => s.setPresentation)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const initial = (user.name || user.employee_id).trim().slice(0, 1)
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" data-account
        aria-label={L(`계정: ${user.name}`, `Account: ${user.name}`)} className={`flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-sunken ${open ? 'bg-sunken' : ''}`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-soft to-accent text-[13px] font-bold text-white" aria-hidden="true">{initial}</span>
        {!compact && (
          <span className="hidden text-left leading-tight lg:block">
            <span className="block max-w-[140px] truncate text-[12.5px] font-semibold text-ink">{user.name}</span>
            <span className="block text-[11px] text-faint">{L(user.role_label.ko, user.role_label.en)}</span>
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 animate-toast-in rounded-2xl border border-line bg-surface p-2 shadow-pop">
          <div className="px-3 py-2.5">
            <div className="truncate text-[14px] font-bold text-ink">{user.name}</div>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-faint">{L('사번', 'Employee ID')}</dt><dd className="font-mono text-slate" data-account-id>{user.employee_id}</dd>
              <dt className="text-faint">{L('역할', 'Role')}</dt><dd className="font-semibold text-accent-ink" data-account-role>{L(user.role_label.ko, user.role_label.en)}</dd>
            </dl>
          </div>
          <div className="my-1 border-t border-line" />
          <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl px-3 text-[13px] text-ink hover:bg-sunken" data-present-keep>
            <span><span className="block font-semibold">{L('발표 모드', 'Presentation mode')}</span><span className="block text-[11px] text-faint">{L('DEMO·가상 표시 숨김 (맨 아래 한 줄만)', 'Hide DEMO labels (one footer note)')}</span></span>
            <Switch checked={presentation} onChange={setPresentation} label={L('발표 모드', 'Presentation mode')} />
          </label>
          <button type="button" role="menuitem" disabled={busy} onClick={async () => { setBusy(true); await logout() }}
            className="flex min-h-[40px] w-full items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold text-ink hover:bg-sunken" data-logout>
            <Icon name="chevronLeft" size={15} className="text-faint" />{busy ? L('로그아웃 중…', 'Signing out…') : L('로그아웃', 'Sign out')}
          </button>
        </div>
      )}
    </div>
  )
}
