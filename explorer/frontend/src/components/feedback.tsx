import { Component, type ReactNode } from 'react'
import { useL } from '../i18n'
import Icon from './Icon'

/** 불러오는 동안 화면 모양을 미리 보여 주는 자리표시 (스크린리더에는 '불러오는 중'으로 알림) */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-sunken ${className}`} aria-hidden="true" />
}

export function PageSkeleton({ variant = 'grid' }: { variant?: 'grid' | 'table' | 'cards' }) {
  const L = useL()
  return (
    <div className="mx-auto max-w-[1400px] space-y-4" role="status" aria-busy="true">
      <span className="sr-only">{L('불러오는 중…', 'Loading…')}</span>
      {variant !== 'table' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card space-y-3 p-4"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-7 w-2/3" /><Skeleton className="h-2 w-full" /></div>)}
        </div>
      )}
      <div className={variant === 'cards' ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4 lg:grid-cols-[2fr_1fr]'}>
        <div className="card space-y-3 p-5"><Skeleton className="h-4 w-1/3" />{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        <div className="card space-y-3 p-5"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-40 w-full" /></div>
      </div>
    </div>
  )
}

/** 오류 안내 + 다시 시도 (같은 모양을 모든 화면에서 사용) */
export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const L = useL()
  return (
    <div role="alert" className="card mx-auto flex max-w-xl flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-danger"><Icon name="alert" size={22} /></span>
      <p className="text-sm">{text}</p>
      <p className="text-xs text-muted">{L('서버가 켜져 있는지(상단 연결 표시) 확인한 뒤 다시 시도하세요. 입력하던 값은 지워지지 않습니다.', 'Check the server connection (top bar), then retry. Your inputs are kept.')}</p>
      {onRetry && <button type="button" className="btn-primary" onClick={onRetry}><Icon name="refresh" size={15} />{L('다시 시도', 'Retry')}</button>}
    </div>
  )
}

/** 화면 하나에서 예기치 않은 오류가 나도 앱 전체(메뉴·케이스)는 그대로 쓰도록 막아 줍니다. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string; fallback: (reset: () => void) => ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children
  }
}
