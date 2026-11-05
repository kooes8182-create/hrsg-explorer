// 반원 게이지: 얇은 호, 피치색 바탕, 오렌지 현재값, 가운데 큰 수치.
// band(참고 구간)는 '판정 기준'이 아니라 참고 범위 — 앰버 점선 표시로 브랜드 오렌지와 구분합니다.
// tone 은 운전 상태(주의·위험)일 때만 상태 색으로 바꿉니다 (브랜드 오렌지 ≠ 위험).
export default function Gauge({ value, max, band, label, valueText, bandLabel, tone = 'neutral', unit }: {
  value: number | null
  max: number
  band?: [number, number]
  label: string
  valueText: string
  bandLabel?: string
  tone?: 'neutral' | 'caution' | 'danger' | 'unknown'
  unit?: string
}) {
  const R = 84, CX = 100, CY = 100
  const ang = (v: number) => Math.PI * (1 - Math.min(1, Math.max(0, v / max)))
  const pt = (v: number, r = R) => [CX + r * Math.cos(ang(v)), CY - r * Math.sin(ang(v))]
  const arc = (a: number, b: number, r = R) => {
    const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r)
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`
  }
  const color = { neutral: 'rgb(var(--accent))', caution: 'rgb(var(--caution))', danger: 'rgb(var(--danger))', unknown: 'rgb(var(--faint))' }[tone]
  return (
    <svg viewBox="0 0 200 132" className="w-full max-w-[260px]" role="img" aria-label={`${label}: ${valueText}`}>
      <path d={arc(0, max)} fill="none" stroke="rgb(var(--peach) / .45)" strokeWidth="12" strokeLinecap="round" />
      {band && <path d={arc(band[0], band[1], R + 10)} fill="none" stroke="rgb(var(--caution))" strokeWidth="2" strokeDasharray="3 3" />}
      {value !== null && value > 0 && <path d={arc(0, Math.min(value, max))} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />}
      {value !== null && (() => {
        const [x, y] = pt(Math.min(value, max), R)
        return <circle cx={x} cy={y} r="7" fill="rgb(var(--surface))" stroke={color} strokeWidth="3" />
      })()}
      <text x={CX} y={CY - 14} textAnchor="middle" fontSize="30" fontWeight="700" fill="rgb(var(--ink))">{valueText}</text>
      {unit && <text x={CX} y={CY + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="rgb(var(--muted))">{unit}</text>}
      <text x={CX} y={CY + (unit ? 18 : 6)} textAnchor="middle" fontSize="10" fill="rgb(var(--muted))">{label}</text>
      <text x={CX - R} y={CY + 18} textAnchor="middle" fontSize="9" fill="rgb(var(--faint))">0</text>
      <text x={CX + R} y={CY + 18} textAnchor="middle" fontSize="9" fill="rgb(var(--faint))">{max}</text>
      {band && bandLabel && <text x={CX} y={CY + 30} textAnchor="middle" fontSize="9" fill="rgb(var(--caution))">┄ {bandLabel}</text>}
    </svg>
  )
}
