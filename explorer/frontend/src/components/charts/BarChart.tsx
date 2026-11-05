import { useState } from 'react'
import { useT } from '../../i18n'

// 가로 막대: 카테고리(공법)별 한 값. 값이 없으면 막대 대신 '산출 불가 + 이유'. 0 기준선에서 시작, 음수 허용.
export interface Bar {
  id: string
  label: string
  value: number | null
  reason?: string
  color: 's1' | 's2' | 's3' | 's4'
  highlight?: boolean
}

const COLOR = { s1: 'rgb(var(--series-1))', s2: 'rgb(var(--series-2))', s3: 'rgb(var(--series-3))', s4: 'rgb(var(--series-4))' }

export default function BarChart({ bars, fmt, ariaLabel, unavailable }: { bars: Bar[]; fmt: (v: number) => string; ariaLabel: string; unavailable: string }) {
  const t = useT()
  const [hover, setHover] = useState<string | null>(null)
  const vals = bars.map((b) => b.value).filter((v): v is number => v !== null)
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals)
  const span = max - min || 1
  const zero = (-min / span) * 100

  return (
    <div role="img" aria-label={ariaLabel} className="space-y-2.5">
      {bars.map((b) => (
        <div key={b.id} className="grid grid-cols-[minmax(84px,30%)_1fr] items-center gap-3 text-sm" onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}>
          <span className={`truncate text-[13px] ${b.highlight ? 'font-semibold text-ink' : 'text-muted'}`} title={b.label}>{b.label}</span>
          {b.value === null ? (
            <span className="truncate rounded-lg border border-dashed border-line bg-canvas px-2.5 py-1.5 text-xs text-muted" title={b.reason}>
              {unavailable}{b.reason ? ` — ${b.reason}` : ''}
            </span>
          ) : (
            <div className="relative h-8 rounded-lg bg-canvas">
              <div className="absolute inset-y-0 w-px bg-line" style={{ left: `${zero}%` }} />
              <div
                className="absolute inset-y-1.5 rounded-md transition-all duration-300"
                style={{
                  background: COLOR[b.color],
                  left: `${b.value >= 0 ? zero : zero - (Math.abs(b.value) / span) * 100}%`,
                  width: `max(2px, ${(Math.abs(b.value) / span) * 100}%)`,
                  opacity: hover && hover !== b.id ? 0.45 : 1,
                }}
              />
              <span
                className="absolute inset-y-0 flex items-center whitespace-nowrap text-xs font-semibold tabular-nums"
                style={b.value >= 0 && (b.value / span) * 100 + zero < 70 ? { left: `calc(${zero + (b.value / span) * 100}% + 6px)` } : { right: '4px' }}
              >
                {fmt(b.value)}
              </span>
            </div>
          )}
        </div>
      ))}
      <p className="sr-only">{t('chart.barNote')}</p>
    </div>
  )
}
