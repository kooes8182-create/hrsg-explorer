import { useState } from 'react'

// 단계형 히트맵: 밝은 피치 → 진한 오렌지 (한 색상의 명도 단계 = 크기). 칸마다 숫자를 함께 적어 색만으로 읽지 않게 합니다.
// 실제 집계 값만 넣습니다 (예: 범주 × 수급 상태 항목 수).
const STEPS = ['rgb(var(--sunken))', 'rgb(var(--peach) / .55)', 'rgb(var(--peach))', 'rgb(var(--soft))', 'rgb(var(--accent))']

export default function Heatmap({ rows, cols, values, ariaLabel, onCell }: {
  rows: { key: string; label: string }[]
  cols: { key: string; label: string }[]
  values: Record<string, Record<string, number>>
  ariaLabel: string
  onCell?: (row: string, col: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => values[r.key]?.[c.key] ?? 0)))
  const step = (v: number) => (v === 0 ? 0 : Math.min(4, 1 + Math.floor(((v - 1) / max) * 4)))
  return (
    <div role="table" aria-label={ariaLabel} className="overflow-x-auto">
      <div className="grid min-w-[300px] gap-1" style={{ gridTemplateColumns: `minmax(90px,1.2fr) repeat(${cols.length}, minmax(44px,1fr))` }}>
        <div role="columnheader" />
        {cols.map((c) => <div key={c.key} role="columnheader" className="truncate pb-1 text-center text-[10.5px] font-semibold text-muted" title={c.label}>{c.label}</div>)}
        {rows.map((r) => (
          <div key={r.key} role="row" className="contents">
            <div role="rowheader" className="truncate pr-2 text-[12px] font-medium text-slate" title={r.label}>{r.label}</div>
            {cols.map((c) => {
              const v = values[r.key]?.[c.key] ?? 0, s = step(v), id = `${r.key}:${c.key}`
              return (
                <button key={id} role="cell" type="button" disabled={!onCell || v === 0} onClick={() => onCell?.(r.key, c.key)}
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} aria-label={`${r.label} · ${c.label}: ${v}`}
                  className={`h-9 rounded-md text-[12px] font-bold tabular-nums transition-transform enabled:hover:scale-[1.04] ${s >= 3 ? 'text-white' : v ? 'text-ink' : 'text-faint'} ${hover === id ? 'ring-2 ring-[rgb(var(--ink)/.15)]' : ''}`}
                  style={{ background: STEPS[s] }}>
                  {v}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
