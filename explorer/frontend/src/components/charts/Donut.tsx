// 얇은 도넛: 조각은 2px 간격, 가운데 핵심 수치. 조각 이름은 범례(글자)로 함께 보여 색만으로 구분하지 않습니다.
export interface Slice {
  label: string
  value: number
  color: string // CSS 색 (토큰 변수)
}

export default function Donut({ slices, center, sub, size = 132, ariaLabel }: { slices: Slice[]; center: string; sub?: string; size?: number; ariaLabel: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = 44, c = 2 * Math.PI * r, gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0
  let acc = 0
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--peach) / .35)" strokeWidth="12" />
        {total > 0 && slices.map((s) => {
          const len = (s.value / total) * c
          const el = s.value > 0 ? (
            <circle key={s.label} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="12" strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />
          ) : null
          acc += len
          return el
        })}
        <text x="60" y={sub ? 60 : 65} textAnchor="middle" fontSize="20" fontWeight="700" fill="rgb(var(--ink))">{center}</text>
        {sub && <text x="60" y="76" textAnchor="middle" fontSize="9" fill="rgb(var(--muted))">{sub}</text>}
      </svg>
      <ul className="min-w-[120px] flex-1 space-y-1.5 text-[13px]">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            <span className="flex-1 text-muted">{s.label}</span>
            <b className="tabular-nums text-ink">{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
