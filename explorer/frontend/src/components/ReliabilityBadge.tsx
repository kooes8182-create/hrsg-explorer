import { useT } from '../i18n'
import Icon, { type IconName } from './Icon'

// 모든 KPI·결과·표에서 같은 배지를 씁니다. 서버의 reliability 값과 1:1 로 대응합니다.
export type Reliability =
  | 'DEMO'
  | 'EXAMPLE'
  | 'USER_INPUT'
  | 'MEASURED'
  | 'PUBLIC_REF'
  | 'NEEDS_VERIFICATION'
  | 'VERIFIED'
  | 'UNCONFIRMED'
  | 'MODEL_NOT_CONNECTED'
  | 'UNAVAILABLE'
  | 'REEVALUATION_REQUIRED'

// 예시·가상 값은 실제값처럼 보이지 않도록 점선 테두리를 씁니다.
const STYLE: Record<Reliability, { cls: string; icon: IconName }> = {
  DEMO: { cls: 'border-dashed border-accent/60 bg-accent-soft text-accent-ink', icon: 'flame' },
  EXAMPLE: { cls: 'border-dashed border-line bg-sunken text-muted', icon: 'info' },
  USER_INPUT: { cls: 'border-info/40 bg-info-soft text-info', icon: 'edit' },
  MEASURED: { cls: 'border-good/40 bg-good-soft text-good', icon: 'check' },
  PUBLIC_REF: { cls: 'border-info/40 bg-info-soft text-info', icon: 'reference' },
  NEEDS_VERIFICATION: { cls: 'border-caution/50 bg-caution-soft text-caution', icon: 'alert' },
  VERIFIED: { cls: 'border-good/40 bg-good-soft text-good', icon: 'check' },
  UNCONFIRMED: { cls: 'border-line bg-sunken text-muted', icon: 'info' },
  MODEL_NOT_CONNECTED: { cls: 'border-line bg-sunken text-muted', icon: 'x' },
  UNAVAILABLE: { cls: 'border-line bg-sunken text-muted', icon: 'x' },
  REEVALUATION_REQUIRED: { cls: 'border-caution/50 bg-caution-soft text-caution', icon: 'refresh' },
}

export default function ReliabilityBadge({ kind, title }: { kind: Reliability; title?: string }) {
  const t = useT()
  const s = STYLE[kind]
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none ${s.cls}`}
      data-demo={kind === 'DEMO' ? '' : undefined}
    >
      <Icon name={s.icon} size={12} />
      {t(`rel.${kind}`)}
    </span>
  )
}
