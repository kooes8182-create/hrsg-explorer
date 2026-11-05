import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { safeNext } from '../app/access'
import Icon, { type IconName } from '../components/Icon'
import { useL } from '../i18n'
import { useApp } from '../store/app'
import { useAuth } from '../store/auth'

// 공통 로그인: 사번·비밀번호만 받습니다. 역할은 고르지 않으며, 서버에 저장된 계정 역할로 시작 화면이 정해집니다.

export default function LoginPage() {
  const L = useL()
  const lang = useApp((s) => s.lang)
  const setLang = useApp((s) => s.setLang)
  const { status, user, check, login } = useAuth()
  const [params] = useSearchParams()
  const [emp, setEmp] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const empRef = useRef<HTMLInputElement>(null)
  const next = params.get('next')
  const expired = params.get('expired') === '1'

  useEffect(() => {
    check()
  }, [check])
  // 이미 로그인한 상태로 이 화면에 오면 자기 시작 화면(또는 허용된 원래 주소)으로
  useEffect(() => {
    if (status === 'authed' && user) window.location.replace(safeNext(user.role, next))
  }, [status, user, next])
  useEffect(() => {
    document.title = `${L('로그인', 'Sign in')} · HRSG Explorer`
    empRef.current?.focus()
  }, [L])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return // 중복 제출 방지
    if (!emp.trim() || !pw) {
      setError(L('사번과 비밀번호를 입력해 주세요.', 'Enter your employee ID and password.'))
      return
    }
    setBusy(true)
    setError(null)
    const r = await login(emp.trim(), pw)
    if (r.ok) {
      window.location.assign(safeNext(r.user.role, next)) // 새로 불러와 이전 화면 상태를 남기지 않음
      return
    }
    setError(r.message[lang])
    setPw('')
    setBusy(false)
  }

  const features: [IconName, string, string][] = [
    ['dashboard', L('운전 상태·성능 KPI 한눈에', 'Operating state and KPIs at a glance'), L('배압·스택 온도·출력 손실 (DEMO 계산)', 'Back pressure, stack temperature, output loss (DEMO)')],
    ['checklist', L('현장 데이터 점검', 'Field data checks'), L('체크리스트·실측값·현장 사진', 'Checklist, measurements, photos')],
    ['sparkles', L('논문 근거 AI 도우미', 'Literature-grounded AI'), L('공식 문헌 검색 + 출처 표시', 'Official corpus search with sources')],
  ]

  return (
    <div className="min-h-[100dvh] bg-canvas lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* 서비스 소개 (데스크톱) */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-gradient-to-br from-accent-soft via-surface to-surface px-12 py-14 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-auto max-w-md">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink">HRSG Assistant</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{L('배열회수보일러의 운전 상태, 세정 필요성, 세정 공법별 경제성을 한곳에서 검토합니다.', 'Review HRSG operation, cleaning need and cleaning economics in one place.')}</p>
          <ul className="mt-8 space-y-4">
            {features.map(([icon, title, sub]) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-accent shadow-card"><Icon name={icon} size={18} /></span>
                <span><span className="block text-[14px] font-semibold text-ink">{title}</span><span className="block text-[13px] text-muted">{sub}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-auto pt-10 text-[11px] text-faint">{L('가상 데이터 데모 — 실제 설비 운전·안전 판단에 사용하지 마세요.', 'Virtual-data demo — not for real plant operation or safety decisions.')}</p>
      </aside>

      {/* 로그인 폼 */}
      <main className="flex min-h-[100dvh] flex-col px-4 py-8 sm:px-8 lg:min-h-0">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden"><Brand compact /></span>
          <div className="flex rounded-lg bg-sunken p-0.5 text-[11px] font-bold" role="group" aria-label={L('언어', 'Language')}>
            {(['ko', 'en'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
                className={`min-h-[32px] rounded-md px-2.5 ${lang === l ? 'bg-surface text-ink shadow-card' : 'text-faint hover:text-ink'}`}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="mx-auto my-auto w-full max-w-[400px] py-8">
          <div className="lg:hidden">
            <h1 className="text-[26px] font-bold tracking-tight text-ink">HRSG Assistant</h1>
          </div>
          <div className="mt-6 rounded-[20px] border border-line bg-surface p-6 shadow-card sm:p-8 lg:mt-0">
            <h2 className="text-[20px] font-bold text-ink">{L('로그인', 'Sign in')}</h2>
            <p className="mt-1 text-[13px] text-muted">{L('사번과 비밀번호를 입력하세요. 권한은 계정에 지정된 역할로 정해집니다.', 'Enter your employee ID and password. Access follows the role set on your account.')}</p>

            {expired && !error && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-caution/30 bg-caution-soft px-3 py-2.5 text-[13px] text-caution" role="status">
                <Icon name="clock" size={15} className="mt-0.5 shrink-0" />{L('로그인이 만료되었습니다. 다시 로그인해 주세요.', 'Your session expired. Please sign in again.')}
              </p>
            )}
            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger" role="alert" data-login-error>
                <Icon name="alert" size={15} className="mt-0.5 shrink-0" />{error}
              </p>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <div>
                <label htmlFor="login-emp" className="mb-1.5 block text-[13px] font-semibold text-ink">{L('사번', 'Employee ID')}</label>
                <input id="login-emp" ref={empRef} className="input h-12 text-[15px]" value={emp} onChange={(e) => setEmp(e.target.value)}
                  autoComplete="username" inputMode="text" autoCapitalize="none" spellCheck={false} disabled={busy} aria-invalid={!!error} />
              </div>
              <div>
                <label htmlFor="login-pw" className="mb-1.5 block text-[13px] font-semibold text-ink">{L('비밀번호', 'Password')}</label>
                <div className="relative">
                  <input id="login-pw" type={show ? 'text' : 'password'} className="input h-12 pr-12 text-[15px]" value={pw} onChange={(e) => setPw(e.target.value)}
                    autoComplete="current-password" disabled={busy} aria-invalid={!!error} />
                  <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="login-pw"
                    aria-label={show ? L('비밀번호 숨기기', 'Hide password') : L('비밀번호 표시', 'Show password')}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    <EyeIcon off={show} />
                  </button>
                </div>
              </div>
              <button type="submit" className="btn-primary h-12 w-full justify-center text-[15px]" disabled={busy} aria-busy={busy}>
                {busy ? <><Icon name="refresh" size={16} className="animate-spin" />{L('확인 중…', 'Signing in…')}</> : L('로그인', 'Sign in')}
              </button>
            </form>
          </div>
          <p className="mt-4 text-center text-[12px] text-faint">{L('계정은 관리자가 발급합니다. 비밀번호를 잊었으면 관리자에게 재설정을 요청하세요.', 'Accounts are issued by an administrator. Ask them to reset a forgotten password.')}</p>
        </div>
      </main>
    </div>
  )
}

function Brand(_: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-soft to-accent text-white shadow-[0_4px_12px_-4px_rgb(234_88_12/.6)]" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 15h4l2-6 3 10 2-7 2 3h5" /></svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[16px] font-bold tracking-tight text-ink">HRSG Explorer</span>
      </span>
    </span>
  )
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  )
}
