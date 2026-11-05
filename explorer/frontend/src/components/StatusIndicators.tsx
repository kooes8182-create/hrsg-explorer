import { useT } from '../i18n'
import { useApp, type HealthState, type SaveState } from '../store/app'
import Icon from './Icon'

// 연결·저장 상태. 색만으로 구분하지 않고 항상 글자와 함께 보여 줍니다.

const HEALTH: Record<HealthState, { key: string; dot: string }> = {
  checking: { key: 'health.checking', dot: 'bg-faint animate-pulse' },
  ok: { key: 'health.ok', dot: 'bg-good' },
  unreachable: { key: 'health.unreachable', dot: 'bg-danger' },
  db_error: { key: 'health.dbError', dot: 'bg-danger' },
}

export function HealthIndicator({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  const t = useT()
  const health = useApp((s) => s.health)
  const h = HEALTH[health.state]
  const searchOff = health.data?.search.status !== 'ready'
  const aiOff = health.data?.ai.status !== 'ready'
  const label = t(h.key)
  const detail = health.state === 'ok' ? [searchOff && t('health.searchInactive'), aiOff && t('health.aiNotConnected')].filter(Boolean) : []
  return (
    <span
      role="status"
      title={[label, ...detail].join(' · ')}
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${onDark ? 'text-side-ink' : 'text-muted'}`}
    >
      <span className={`h-2 w-2 rounded-full ${h.dot}`} aria-hidden="true" />
      {!compact && <span>{label}</span>}
      {compact && <span className="sr-only">{label}</span>}
    </span>
  )
}

const SAVE: Record<SaveState, { key: string; cls: string; icon: 'check' | 'refresh' | 'alert' }> = {
  saved: { key: 'save.saved', cls: 'text-muted', icon: 'check' },
  pending: { key: 'save.pending', cls: 'text-muted', icon: 'refresh' },
  failed: { key: 'save.failed', cls: 'text-danger', icon: 'alert' },
  quota: { key: 'save.quota', cls: 'text-caution', icon: 'alert' },
}

export function SaveIndicator() {
  const t = useT()
  const saveState = useApp((s) => s.saveState)
  const prefsWarning = useApp((s) => s.prefsWarning)
  const state: SaveState = saveState === 'saved' && prefsWarning ? 'quota' : saveState
  const s = SAVE[state]
  return (
    <span
      role="status"
      title={state === 'quota' ? t('save.quotaHelp') : undefined}
      className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}
    >
      <Icon name={s.icon} size={14} className={state === 'pending' ? 'animate-spin' : ''} />
      {t(s.key)}
    </span>
  )
}
