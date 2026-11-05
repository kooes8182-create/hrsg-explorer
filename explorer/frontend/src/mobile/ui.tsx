import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useL } from '../i18n'
import { fmtDateTime } from '../lib/format'
import { useApp } from '../store/app'
import Icon, { type IconName } from '../components/Icon'

// 모바일 공통 부품: 카드·섹션 제목·진행 막대·아래에서 올라오는 시트(Bottom Sheet)·기준 시각 표시.
// 좌우 여백 16px, 카드 간격 12px, 카드 둥글기 16px, 터치 영역 최소 44px.

export function MCard({ children, className = '', as = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'li' }) {
  const Tag = as
  return <Tag className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`}>{children}</Tag>
}

export function MTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="mb-3 flex min-h-[28px] items-center gap-2">
      {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon name={icon} size={15} /></span>}
      <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{children}</h2>
      {action}
    </div>
  )
}

export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex min-h-[44px] items-center gap-0.5 px-1 text-[13px] font-semibold text-accent-ink">{children}<Icon name="chevronRight" size={14} /></Link>
}

export function Progress({ value, label, sub }: { value: number | null; label: string; sub?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums"><b className="text-ink">{value === null ? '—' : `${Math.round(v)}%`}</b>{sub && <span className="ml-1 text-[11px] text-faint">{sub}</span>}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-gradient-to-r from-soft to-accent transition-[width]" style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}

/** 데이터 기준 시각 (실시간이 아님을 분명히) */
export function AsOf({ at, label }: { at: string | null | undefined; label?: string }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-faint">
      <Icon name="clock" size={12} />{label ?? L('기준', 'As of')} {at ? fmtDateTime(at, lang) : L('없음', 'none')}
    </span>
  )
}

/** 아래에서 올라오는 시트. 배경을 누르거나 Esc·닫기 버튼으로 닫습니다. 높이는 화면의 90% 까지, 안쪽 스크롤. */
export function BottomSheet({ open, onClose, title, children, footer, label }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; label?: string
}) {
  const L = useL()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden' // 시트가 열린 동안 뒤 화면이 같이 스크롤되지 않게
    box.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <div className="absolute inset-0 bg-[rgb(var(--ink)/.4)]" onClick={onClose} aria-hidden="true" />
      <div ref={box} tabIndex={-1} data-sheet
        className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] animate-sheet-in flex-col rounded-t-[20px] bg-surface shadow-pop outline-none">
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-line" aria-hidden="true" />
        <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-2">
          <div className="min-w-0 flex-1 text-[16px] font-bold text-ink">{title}</div>
          <button type="button" className="btn-icon h-11 w-11" onClick={onClose} aria-label={L('닫기', 'Close')}><Icon name="x" size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">{footer}</div>}
        {!footer && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </div>
    </div>,
    document.body,
  )
}

/** 상태 칩: 정상/주의/위험/미확인 — 색 + 아이콘 + 글자 */
export function StateChip({ code, large = false }: { code: string; large?: boolean }) {
  const L = useL()
  const m: Record<string, [string, string, string, IconName]> = {
    NORMAL: ['정상', 'Normal', 'bg-good-soft text-good', 'check'],
    ALARM: ['주의', 'Caution', 'bg-caution-soft text-caution', 'alert'],
    TRIP: ['위험', 'Danger', 'bg-danger-soft text-danger', 'alert'],
  }
  const [ko, en, cls, icon] = m[code] ?? ['미확인', 'Unknown', 'bg-sunken text-muted', 'info']
  return <span className={`inline-flex items-center gap-1.5 rounded-lg font-bold ${cls} ${large ? 'px-3 py-1.5 text-[17px]' : 'px-2 py-0.5 text-xs'}`}><Icon name={icon} size={large ? 18 : 13} />{L(ko, en)}</span>
}

/** 조회 실패 시 마지막으로 받은 값을 보여 줄 때의 안내 */
export function StaleNotice({ at }: { at: Date | null }) {
  const L = useL()
  const lang = useApp((s) => s.lang)
  return (
    <div className="flex items-start gap-2 rounded-xl border border-caution/30 bg-caution-soft px-3 py-2.5 text-xs text-caution" role="status">
      <Icon name="alert" size={14} className="mt-px" />
      <span>{L('새로 불러오지 못해 마지막으로 받은 값을 보여 줍니다 (오래된 값일 수 있음).', 'Could not refresh — showing the last values received (may be outdated).')}
        {at && <b className="ml-1">{L('마지막 조회', 'Last fetched')} {at.toLocaleTimeString(lang === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</b>}</span>
    </div>
  )
}
