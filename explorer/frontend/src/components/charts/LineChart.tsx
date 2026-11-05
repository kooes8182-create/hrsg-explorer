import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'

// SVG 선 그래프: 2px 선, 8px 표식, 흐린 격자, 십자선 + 툴팁, 표 보기 전환. 축은 하나만 씁니다.
export interface Series {
  id: string
  label: string
  color: 's1' | 's2' | 's3' | 's4' | 'muted'
  points: { x: number; y: number | null }[]
  dashed?: boolean
  markers?: boolean
  /** 선 아래 그라데이션 영역 (주 계열 하나에만 쓰는 것을 권장) */
  area?: boolean
}

interface Props {
  series: Series[]
  xLabel: string
  yLabel: string
  fmtX?: (x: number) => string
  fmtY?: (y: number) => string
  height?: number
  refLines?: { y: number; label: string }[]
  bands?: { y0: number; y1: number; label: string }[]
  vLines?: { x: number; label: string }[]
  markX?: { x: number; label: string }[]
  ariaLabel: string
  empty?: ReactNode
}

const COLOR: Record<Series['color'], string> = { s1: 'rgb(var(--series-1))', s2: 'rgb(var(--series-2))', s3: 'rgb(var(--series-3))', s4: 'rgb(var(--series-4))', muted: 'rgb(var(--faint))' }
const PAD = { l: 56, r: 16, t: 14, b: 40 }

function niceTicks(min: number, max: number, n = 5) {
  if (min === max) {
    min -= 1
    max += 1
  }
  const step0 = (max - min) / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return { lo, hi, ticks }
}

export default function LineChart({ series, xLabel, yLabel, fmtX = String, fmtY = (y) => y.toLocaleString(), height = 260, refLines = [], bands = [], vLines = [], markX = [], ariaLabel, empty }: Props) {
  const t = useT()
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const uid = useId().replace(/:/g, '')
  const box = useRef<SVGSVGElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  // 실제 표시 폭으로 그려서 글자 크기가 화면 폭에 따라 커지거나 작아지지 않게 합니다.
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])

  const shown = series.filter((s) => !hidden.has(s.id))
  const all = shown.flatMap((s) => s.points.filter((p) => p.y !== null) as { x: number; y: number }[])
  const xs = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b), [series])
  if (!series.some((s) => s.points.some((p) => p.y !== null))) return <div className="flex h-40 items-center justify-center rounded-lg bg-sunken text-sm text-muted">{empty ?? '—'}</div>
  if (!all.length) all.push({ x: xs[0] ?? 0, y: 0 }, { x: xs[xs.length - 1] ?? 1, y: 1 })

  const yVals = [...all.map((p) => p.y), ...refLines.map((r) => r.y), ...bands.flatMap((b) => [b.y0, b.y1])]
  const yr = niceTicks(Math.min(0, ...yVals), Math.max(...yVals))
  const xmin = Math.min(...xs), xmax = Math.max(...xs)
  const sx = (x: number) => PAD.l + ((x - xmin) / (xmax - xmin || 1)) * (W - PAD.l - PAD.r)
  const sy = (y: number) => PAD.t + (1 - (y - yr.lo) / (yr.hi - yr.lo || 1)) * (height - PAD.t - PAD.b)
  const xTicks = niceTicks(xmin, xmax, 6).ticks.filter((x) => x >= xmin && x <= xmax)

  // 끊긴 구간(null)마다 나눠서, 값 사이를 넘치지 않는 단조 곡선으로 그립니다 (공학 값 왜곡 방지).
  const runs = (pts: { x: number; y: number | null }[]) => {
    const out: { x: number; y: number }[][] = []
    let cur: { x: number; y: number }[] = []
    for (const p of pts) {
      if (p.y === null) {
        if (cur.length) out.push(cur)
        cur = []
      } else cur.push({ x: sx(p.x), y: sy(p.y) })
    }
    if (cur.length) out.push(cur)
    return out
  }
  const smooth = (q: { x: number; y: number }[]) => {
    if (q.length < 3) return q.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
    const n = q.length, dx = [], m = [], t: number[] = []
    for (let i = 0; i < n - 1; i++) { dx.push(q[i + 1].x - q[i].x); m.push((q[i + 1].y - q[i].y) / (dx[i] || 1)) }
    t[0] = m[0]; t[n - 1] = m[n - 2]
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i])
    let d = `M${q[0].x.toFixed(1)},${q[0].y.toFixed(1)}`
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3
      d += `C${(q[i].x + h).toFixed(1)},${(q[i].y + t[i] * h).toFixed(1)} ${(q[i + 1].x - h).toFixed(1)},${(q[i + 1].y - t[i + 1] * h).toFixed(1)} ${q[i + 1].x.toFixed(1)},${q[i + 1].y.toFixed(1)}`
    }
    return d
  }
  const path = (pts: { x: number; y: number | null }[]) => runs(pts).map(smooth).join('')
  const areaPath = (pts: { x: number; y: number | null }[]) => {
    const base = sy(Math.max(yr.lo, Math.min(0, yr.hi)))
    return runs(pts).map((q) => `${smooth(q)}L${q[q.length - 1].x.toFixed(1)},${base}L${q[0].x.toFixed(1)},${base}Z`).join('')
  }

  const onMove = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let best = xs[0]
    for (const x of xs) if (Math.abs(sx(x) - px) < Math.abs(sx(best) - px)) best = x
    setHover(best)
  }
  const at = (s: Series, x: number) => s.points.find((p) => p.x === x)?.y ?? null

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {series.length > 1 &&
          series.map((s) => (
            <button key={s.id} type="button" aria-pressed={!hidden.has(s.id)} title={t('chart.toggle')}
              onClick={() => { const n = new Set(hidden); n.has(s.id) ? n.delete(s.id) : n.add(s.id); if (n.size < series.length) setHidden(n) }}
              className={`inline-flex items-center gap-1.5 rounded px-1 hover:bg-sunken ${hidden.has(s.id) ? 'line-through opacity-50' : ''}`}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="18" y2="4" stroke={COLOR[s.color]} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
              </svg>
              {s.label}
            </button>
          ))}
        <button type="button" className="ml-auto underline-offset-2 hover:underline" onClick={() => setTable(!table)}>
          {table ? t('chart.showChart') : t('chart.showTable')}
        </button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-sunken text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left">{xLabel}</th>
                {series.map((s) => <th key={s.id} className="px-2 py-1.5 text-right">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {xs.map((x) => (
                <tr key={x} className="border-t border-line">
                  <td className="px-2 py-1">{fmtX(x)}</td>
                  {series.map((s) => {
                    const y = at(s, x)
                    return <td key={s.id} className="px-2 py-1 text-right tabular-nums">{y === null ? '—' : fmtY(y)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative">
          <svg ref={box} viewBox={`0 0 ${W} ${height}`} className="w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" role="img"
            aria-label={`${ariaLabel} — ${t('chart.keys')}`} tabIndex={0} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
            onFocus={() => hover === null && setHover(xs[0])} onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              const i = hover === null ? -1 : xs.indexOf(hover)
              if (e.key === 'ArrowRight') { e.preventDefault(); setHover(xs[Math.min(xs.length - 1, i + 1)]) }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); setHover(xs[Math.max(0, i - 1)]) }
              else if (e.key === 'Escape') setHover(null)
            }}>
            <defs>
              {shown.filter((s) => s.area).map((s) => (
                <linearGradient key={s.id} id={`area-${uid}-${s.id}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={COLOR[s.color]} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={COLOR[s.color]} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {yr.ticks.map((y) => (
              <g key={y}>
                <line x1={PAD.l} x2={W - PAD.r} y1={sy(y)} y2={sy(y)} stroke="rgb(var(--grid))" strokeWidth="1" strokeDasharray={y === yr.lo ? undefined : '3 4'} />
                <text x={PAD.l - 8} y={sy(y)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="rgb(var(--muted))">{fmtY(y)}</text>
              </g>
            ))}
            {xTicks.map((x) => (
              <text key={x} x={sx(x)} y={height - PAD.b + 16} textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">{fmtX(x)}</text>
            ))}
            <text x={(PAD.l + W - PAD.r) / 2} y={height - 4} textAnchor="middle" fontSize="11" fill="rgb(var(--faint))">{xLabel}</text>
            <text x={12} y={PAD.t + (height - PAD.t - PAD.b) / 2} textAnchor="middle" fontSize="11" fill="rgb(var(--faint))" transform={`rotate(-90 12 ${PAD.t + (height - PAD.t - PAD.b) / 2})`}>{yLabel}</text>
            {bands.map((b) => (
              <g key={b.label}>
                <rect x={PAD.l} width={W - PAD.l - PAD.r} y={sy(b.y1)} height={Math.max(1, sy(b.y0) - sy(b.y1))} fill="rgb(var(--caution) / 0.10)" />
                <text x={W - PAD.r - 4} y={sy(b.y1) + 12} textAnchor="end" fontSize="10" fill="rgb(var(--caution))">{b.label}</text>
              </g>
            ))}
            {refLines.map((r) => (
              <g key={r.label}>
                <line x1={PAD.l} x2={W - PAD.r} y1={sy(r.y)} y2={sy(r.y)} stroke="rgb(var(--muted))" strokeDasharray="2 3" />
                <text x={PAD.l + 4} y={sy(r.y) - 4} fontSize="10" fill="rgb(var(--muted))">{r.label}</text>
              </g>
            ))}
            {vLines.map((v) => (
              <g key={v.label}>
                <line x1={sx(v.x)} x2={sx(v.x)} y1={PAD.t} y2={height - PAD.b} stroke="rgb(var(--ink) / 0.5)" strokeDasharray="3 3" />
                <text x={sx(v.x) + 4} y={PAD.t + 10} fontSize="10" fill="rgb(var(--ink))">{v.label}</text>
              </g>
            ))}
            {shown.map((s) => (
              <g key={s.id}>
                {s.area && <path d={areaPath(s.points)} fill={`url(#area-${uid}-${s.id})`} stroke="none" />}
                <path d={path(s.points)} fill="none" stroke={COLOR[s.color]} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dashed ? '6 5' : undefined} />
                {s.markers &&
                  s.points.filter((p) => p.y !== null).map((p) => (
                    <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={hover === p.x ? 5 : 3.5} fill={COLOR[s.color]} stroke="rgb(var(--surface))" strokeWidth="2" />
                  ))}
              </g>
            ))}
            {markX.map((m) => {
              const y = series[0] ? at(series[0], m.x) : null
              return y === null ? null : (
                <g key={m.label}>
                  <circle cx={sx(m.x)} cy={sy(y)} r="6" fill="rgb(var(--surface))" stroke="rgb(var(--ink))" strokeWidth="2" />
                  <text x={sx(m.x)} y={sy(y) - 10} textAnchor="middle" fontSize="10" fontWeight="600" fill="rgb(var(--ink))">{m.label}</text>
                </g>
              )
            })}
            {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={height - PAD.b} stroke="rgb(var(--ink) / 0.35)" />}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-xl border border-line bg-surface px-3 py-2.5 text-xs shadow-pop"
              style={{ left: `clamp(0px, calc(${(sx(hover) / W) * 100}% + 12px), calc(100% - 160px))` }}
            >
              <div className="mb-1 font-semibold">{xLabel}: {fmtX(hover)}</div>
              {shown.map((s) => {
                const y = at(s, hover)
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: COLOR[s.color] }} />
                      {s.label}
                    </span>
                    <span className="font-semibold tabular-nums">{y === null ? '—' : fmtY(y)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}
