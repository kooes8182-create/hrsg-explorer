import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { fmtNum, unitLabel, useDisplay } from '../lib/format'
import { useApp } from '../store/app'

// HRSG 공정 흐름도: 가스터빈 → HRSG(과열기·증발기·절탄기) → 굴뚝, 급수·증기 → 스팀터빈.
// 수치는 받은 값만 표시합니다 (없으면 —). 오염 표시는 운전 상태가 주의/위험일 때만, '가상 시나리오'라는 점을 함께 적습니다.

type Part = 'GT' | 'SH' | 'EVA' | 'ECO' | 'STACK' | 'ST' | 'DRUM'
const LINK: Record<Part, string> = { GT: '/simulation', SH: '/analysis', EVA: '/analysis?tab=pinch', ECO: '/analysis?tab=pinch', STACK: '/calculator', ST: '/analysis', DRUM: '/analysis?tab=pinch' }

export interface DiagramValues {
  currentBP?: number | null
  hrsgDpKpa?: number | null
  stackTempC?: number | null
  drumPressureBar?: number | null
  evaGasTempC?: number | null
  ecoWaterTempC?: number | null
  status?: 'NORMAL' | 'ALARM' | 'TRIP' | 'UNKNOWN'
}

/** overlays: 도식 위에 올리는 주요 수치 (예: 초과 배압, 스택 온도 상승) — 받은 값만 표시 */
export default function HrsgDiagram({ values, note, overlays = [] }: { values: DiagramValues; note?: string; overlays?: { label: string; value: string; tone?: 'caution' | 'neutral' }[] }) {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const display = useDisplay()
  const [sel, setSel] = useState<Part | null>(null)
  const [hov, setHov] = useState<Part | null>(null)
  const fouled = values.status === 'ALARM' || values.status === 'TRIP'
  const heavy = values.status === 'TRIP'
  const show = (v: number | null | undefined, unit: string, digits = 1) => {
    const d = display(v, unit)
    return d.value === null ? '—' : `${fmtNum(d.value, lang, digits)} ${unitLabel(d.unit)}`
  }

  const part = (id: Part) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': t(`diagram.${id}.name`),
    onClick: () => setSel(sel === id ? null : id),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && setSel(sel === id ? null : id),
    onMouseEnter: () => setHov(id),
    onMouseLeave: () => setHov(null),
    className: 'cursor-pointer outline-none [&:focus-visible_path]:stroke-[rgb(var(--accent))] [&:focus-visible_rect]:stroke-[rgb(var(--accent))]',
    style: { opacity: (hov ?? sel) && (hov ?? sel) !== id ? 0.55 : 1, transition: 'opacity .15s' },
  })
  const stroke = 'rgb(var(--ink) / 0.55)'
  const box = 'rgb(var(--surface))'
  const gas = 'rgb(var(--series-2))'
  const water = 'rgb(var(--series-1))'
  const focus = hov ?? sel
  const flow = 'animate-flow motion-reduce:animate-none'
  const casing = values.status === 'TRIP' ? 'rgb(var(--danger))' : values.status === 'ALARM' ? 'rgb(var(--caution))' : stroke

  return (
    <div>
      {overlays.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {overlays.map((o) => (
            <span key={o.label} className={`inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${o.tone === 'caution' ? 'border-caution/40 bg-caution-soft text-caution' : 'border-line bg-sunken text-muted'}`}>
              {o.label}<b className="text-sm tabular-nums text-ink">{o.value}</b>
            </span>
          ))}
        </div>
      )}
      <svg viewBox="0 0 720 300" className="w-full" role="group" aria-label={t('diagram.title')}>
        <defs>
          <marker id="arrG" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill={gas} /></marker>
          <marker id="arrW" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill={water} /></marker>
          <pattern id="foul" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(var(--caution))" strokeWidth={heavy ? 3 : 2} />
          </pattern>
        </defs>

        {/* 가스 흐름 */}
        <path d="M150,200 H210" stroke={gas} strokeWidth="3" markerEnd="url(#arrG)" strokeDasharray="6 4" className={flow} />
        <path d="M560,200 H600" stroke={gas} strokeWidth="3" markerEnd="url(#arrG)" strokeDasharray="6 4" className={flow} />
        <text x="180" y="190" textAnchor="middle" fontSize="10" fill={gas}>{t('diagram.gas')}</text>

        {/* 가스터빈 */}
        <g {...part('GT')}>
          <path d="M30,165 L150,180 L150,220 L30,235 Z" fill={box} stroke={focus === 'GT' ? 'rgb(var(--accent))' : stroke} strokeWidth="2" />
          <text x="88" y="204" textAnchor="middle" fontSize="12" fontWeight="700" fill="rgb(var(--ink))">{t('diagram.GT.short')}</text>
          <rect x="34" y="244" width="116" height="38" rx="6" fill="rgb(var(--sunken))" />
          <text x="92" y="259" textAnchor="middle" fontSize="10" fill="rgb(var(--muted))">{t('diagram.bp')}</text>
          <text x="92" y="275" textAnchor="middle" fontSize="12" fontWeight="700" fill="rgb(var(--ink))">{show(values.currentBP, 'mmH2O')}</text>
        </g>

        {/* HRSG 케이싱 */}
        <rect x="214" y="140" width="346" height="120" rx="6" fill="none" stroke={casing} strokeWidth={fouled ? 2.5 : 2} />
        <text x="290" y="134" fontSize="11" fontWeight="700" fill="rgb(var(--muted))">HRSG · ΔP {show(values.hrsgDpKpa, 'kPa', 2)}</text>
        {(['SH', 'EVA', 'ECO'] as const).map((id, i) => {
          const x = 226 + i * 112
          const dirty = fouled && id !== 'SH'
          return (
            <g key={id} {...part(id)}>
              <rect x={x} y="152" width="98" height="96" rx="4" fill={dirty ? 'url(#foul)' : box} stroke={focus === id ? 'rgb(var(--accent))' : stroke} strokeWidth="1.5" />
              {[0, 1, 2, 3, 4].map((k) => <line key={k} x1={x + 14 + k * 17} x2={x + 14 + k * 17} y1="162" y2="238" stroke={stroke} strokeWidth="1" opacity="0.45" />)}
              <rect x={x + 8} y="188" width="82" height="24" rx="4" fill={box} opacity="0.92" />
              <text x={x + 49} y="204" textAnchor="middle" fontSize="11" fontWeight="700" fill="rgb(var(--ink))">{t(`diagram.${id}.short`)}</text>
            </g>
          )
        })}

        {/* 드럼 */}
        <g {...part('DRUM')}>
          <rect x="355" y="78" width="88" height="30" rx="15" fill={box} stroke={focus === 'DRUM' ? 'rgb(var(--accent))' : stroke} strokeWidth="2" />
          <text x="399" y="97" textAnchor="middle" fontSize="10" fontWeight="700" fill="rgb(var(--ink))">{t('diagram.DRUM.short')} {show(values.drumPressureBar, 'bar', 0)}</text>
        </g>

        {/* 급수·증기 흐름: 급수 → 절탄기 → 드럼 → 과열기 → 스팀터빈 */}
        <path d="M600,272 H500 V248" fill="none" stroke={water} strokeWidth="2" markerEnd="url(#arrW)" strokeDasharray="6 4" className={flow} />
        <text x="604" y="276" fontSize="10" fill={water}>{t('diagram.feedwater')}</text>
        <path d="M500,152 V93 H446" fill="none" stroke={water} strokeWidth="2" markerEnd="url(#arrW)" strokeDasharray="6 4" className={flow} />
        <path d="M355,93 H275 V148" fill="none" stroke={water} strokeWidth="2" strokeDasharray="5 3" markerEnd="url(#arrW)" />
        <path d="M262,152 V40 H470" fill="none" stroke={water} strokeWidth="2.5" markerEnd="url(#arrW)" strokeDasharray="6 4" className={flow} />
        <text x="290" y="34" fontSize="10" fill={water}>{t('diagram.steam')}</text>

        {/* 스팀터빈 */}
        <g {...part('ST')}>
          <path d="M478,22 L560,12 L560,68 L478,58 Z" fill={box} stroke={focus === 'ST' ? 'rgb(var(--accent))' : stroke} strokeWidth="2" />
          <text x="519" y="44" textAnchor="middle" fontSize="11" fontWeight="700" fill="rgb(var(--ink))">{t('diagram.ST.short')}</text>
        </g>

        {/* 굴뚝 */}
        <g {...part('STACK')}>
          <path d="M604,260 L612,40 L652,40 L660,260 Z" fill={box} stroke={focus === 'STACK' ? 'rgb(var(--accent))' : stroke} strokeWidth="2" />
          <text x="632" y="150" textAnchor="middle" fontSize="11" fontWeight="700" fill="rgb(var(--ink))">{t('diagram.STACK.short')}</text>
          <rect x="584" y="6" width="104" height="30" rx="6" fill="rgb(var(--sunken))" />
          <text x="636" y="25" textAnchor="middle" fontSize="12" fontWeight="700" fill="rgb(var(--ink))">{show(values.stackTempC, '°C')}</text>
        </g>

        {values.evaGasTempC != null && (
          <g>
            <rect x="404" y="266" width="80" height="20" rx="4" fill="rgb(var(--sunken))" />
            <text x="444" y="280" textAnchor="middle" fontSize="10" fill={gas}>{t('diagram.evaGas')} {show(values.evaGasTempC, '°C', 0)}</text>
          </g>
        )}
        {values.ecoWaterTempC != null && (
          <g>
            <rect x="506" y="110" width="78" height="20" rx="4" fill="rgb(var(--sunken))" />
            <text x="545" y="124" textAnchor="middle" fontSize="10" fill={water}>{t('diagram.ecoWater')} {show(values.ecoWaterTempC, '°C', 0)}</text>
          </g>
        )}
        {fouled && (
          <g>
            <rect x="216" y="266" width="182" height="20" rx="4" fill="rgb(var(--caution-soft))" />
            <text x="224" y="280" fontSize="9.5" fontWeight="600" fill="rgb(var(--caution))">▨ {t('diagram.fouling')}</text>
          </g>
        )}
      </svg>
      <div className="mt-2 min-h-[44px] rounded-lg bg-sunken px-3 py-2 text-xs" aria-live="polite">
        {focus ? (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <b className="text-ink">{t(`diagram.${focus}.name`)}</b>
            <span className="text-muted">{t(`diagram.${focus}.desc`)}</span>
            <Link to={LINK[focus]} className="ml-auto font-semibold text-accent-ink hover:underline">{t('diagram.open')} →</Link>
          </div>
        ) : (
          <span className="text-muted">{note ?? t('diagram.hint')}</span>
        )}
      </div>
    </div>
  )
}
