import type { ReactNode } from 'react'
import type { FieldSpec, Rel, Val } from '../api/engine'
import type { Bilingual } from '../api/types'
import { useT } from '../i18n'
import { fmtNum, fmtWon, unitDigits, unitLabel, useDisplay } from '../lib/format'
import { useApp } from '../store/app'
import Icon, { type IconName } from './Icon'
import ReliabilityBadge from './ReliabilityBadge'

export function Card({ title, icon, aside, children, className = '', bodyClass = 'p-5 pt-4', sub }: {
  title?: ReactNode; icon?: IconName; aside?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; sub?: ReactNode
}) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-5 pt-5">
          {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon name={icon} size={16} /></span>}
          <div className="min-w-[10rem] flex-1">
            <h2 className="truncate text-[15px] font-bold text-ink">{title}</h2>
            {sub && <p className="truncate text-xs text-muted">{sub}</p>}
          </div>
          {aside}
        </header>
      )}
      <div className={title ? (bodyClass === 'p-0' ? 'mt-4' : bodyClass) : bodyClass.replace('pt-4', '')}>{children}</div>
    </section>
  )
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'caution' | 'danger' | 'muted'; icon?: IconName; children: ReactNode }) {
  const cls = { info: 'border border-[rgb(var(--peach)/.7)] bg-accent-soft text-slate [&>svg]:text-accent', caution: 'border border-caution/25 bg-caution-soft text-caution', danger: 'border border-danger/25 bg-danger-soft text-danger', muted: 'border border-line bg-canvas text-muted' }[tone]
  const ic: IconName = icon ?? (tone === 'info' || tone === 'muted' ? 'info' : 'alert')
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] leading-snug ${cls}`}>
      <Icon name={ic} size={15} className="mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** 결과 값 하나: 숫자+단위, 또는 '산출 불가 + 이유'. 압력·온도는 표시 단위로 바꿔 보여 줍니다. */
export function ValueText({ v, digits = 2, money = false, className = '', compact = false }: { v: Val | null | undefined; digits?: number; money?: boolean; className?: string; compact?: boolean }) {
  const lang = useApp((s) => s.lang)
  const display = useDisplay()
  if (!v) return <span className="text-faint">—</span>
  if (v.value === null)
    return compact ? <span className="cursor-help text-faint" title={v.reason?.[lang]}>—</span> : <span className="text-sm text-muted" title={v.reason?.[lang]}>{v.reason?.[lang] ?? '—'}</span>
  if (money) {
    const w = fmtWon(v.value, lang)
    return <span className={className} title={w.full}>{lang === 'ko' && v.text ? v.text : w.short}</span>
  }
  const d = display(v.value, v.unit)
  return (
    <span className={className}>
      {fmtNum(d.value, lang, d.unit !== v.unit ? unitDigits(d.unit, digits) : digits)}
      {d.unit && <span className="ml-0.5 text-[0.7em] font-medium text-muted">{unitLabel(d.unit)}</span>}
    </span>
  )
}

export function Kpi({ label, v, rel, sub, money, digits, stale, tone }: {
  label: string; v: Val | null | undefined; rel?: Rel; sub?: ReactNode; money?: boolean; digits?: number; stale?: boolean; tone?: 'default' | 'accent'
}) {
  const kind = stale ? 'REEVALUATION_REQUIRED' : (rel ?? v?.rel ?? (v?.value === null ? 'UNAVAILABLE' : undefined))
  return (
    <div className={`card card-hover relative p-4 ${tone === 'accent' ? 'bg-gradient-to-b from-accent-soft to-surface' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[13px] font-semibold leading-snug text-muted">{label}</span>
        {kind && <span className="shrink-0"><ReliabilityBadge kind={kind} /></span>}
      </div>
      <div data-kpi className={`mt-3 text-[26px] font-bold leading-none tracking-tight text-ink ${stale ? 'opacity-40 blur-[1.5px]' : ''}`}>
        <ValueText v={v} money={money} digits={digits} />
      </div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </div>
  )
}

const STATUS_STYLE = {
  NORMAL: { cls: 'border-line bg-sunken text-ink', icon: 'check' as IconName },
  ALARM: { cls: 'border-caution/50 bg-caution-soft text-caution', icon: 'alert' as IconName },
  TRIP: { cls: 'border-danger/50 bg-danger-soft text-danger', icon: 'alert' as IconName },
  UNKNOWN: { cls: 'border-dashed border-line bg-sunken text-muted', icon: 'info' as IconName },
}
/** 운전 상태: 색 + 아이콘 + 글자 (정상은 중립색 — ISA-101) */
export function StatusPill({ code, label, large }: { code: keyof typeof STATUS_STYLE; label: Bilingual; large?: boolean }) {
  const lang = useApp((s) => s.lang)
  const s = STATUS_STYLE[code]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border font-bold ${s.cls} ${large ? 'px-3 py-1.5 text-base' : 'px-2 py-0.5 text-xs'}`}>
      <Icon name={s.icon} size={large ? 18 : 13} />
      {label[lang]}
    </span>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-sunken p-1">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" type="button" aria-selected={value === tb.id} onClick={() => onChange(tb.id)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all ${value === tb.id ? 'bg-surface text-accent-ink shadow-card' : 'text-muted hover:text-ink'}`}>
          {tb.label}
        </button>
      ))}
    </div>
  )
}

/** 입력 칸 하나 (규격은 서버 schema). 오류는 즉시 표시. */
export function InputField({ f, value, onChange, error, changed, source, label }: {
  label?: string; f: FieldSpec; value: string | number | null | undefined; onChange: (v: string) => void; error?: Bilingual | null; changed?: boolean; source?: 'DEMO' | 'USER_INPUT' | null
}) {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const id = `in-${f.key}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <span className="truncate" title={f.label[lang]}>{label ?? f.label[lang]}</span>
        {f.required && <span className="shrink-0 text-danger" aria-hidden="true">*</span>}
        {changed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title={t('sim.changed')} />}
        {source === 'DEMO' && !changed && <span className="ml-auto shrink-0 text-[10px] font-semibold text-accent-ink">DEMO</span>}
      </label>
      {f.kind === 'choice' ? (
        <select id={id} className="input h-9 py-0" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {f.choices!.map((c) => <option key={c} value={c}>{t(`choice.${c}`) === `choice.${c}` ? c : t(`choice.${c}`)}</option>)}
        </select>
      ) : (
        <div className="relative">
          <input
            id={id}
            inputMode="decimal"
            className={`input h-9 pr-14 tabular-nums ${error ? 'border-danger focus:border-danger' : ''}`}
            value={value ?? ''}
            placeholder={f.required ? '' : t('common.optional')}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          {f.unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">{unitLabel(f.unit)}</span>}
        </div>
      )}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-[11px] text-danger">{error[lang]}</p>
      ) : f.note ? (
        <p className="mt-1 text-[11px] text-faint">{f.note[lang]}</p>
      ) : null}
    </div>
  )
}

export function Steps({ steps }: { steps: { id: string; label: Bilingual; formula: string; substituted?: string; result?: number; unit?: string; note?: Bilingual }[] }) {
  const lang = useApp((s) => s.lang)
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s.id}>
         <details className="group rounded-xl border border-line bg-surface open:bg-canvas" open={i < 2}>
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-ink">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft font-mono text-[11px] text-accent-ink">{i + 1}</span>
            <span className="flex-1">{s.label[lang]}</span>
            {s.result !== undefined && <span className="text-xs font-semibold tabular-nums text-muted">{s.result.toLocaleString()} {unitLabel(s.unit)}</span>}
            <Icon name="chevronDown" size={15} className="text-faint transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-3.5 pb-3">
          <code className="mt-1 block break-words font-mono text-[12px] text-ink">{s.formula}</code>
          {s.substituted && (
            <code className="block break-words font-mono text-[12px] text-muted">
              = {s.substituted}
              {s.result !== undefined && <> = <b className="text-ink">{s.result.toLocaleString()}</b> {unitLabel(s.unit)}</>}
            </code>
          )}
          {s.note && <p className="mt-1 text-[11px] text-accent-ink">{s.note[lang]}</p>}
          </div>
         </details>
        </li>
      ))}
    </ol>
  )
}

/** 켜기/끄기 스위치 (설정 토글). 체크박스와 같은 역할, 보기만 다릅니다. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-line'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-card transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  )
}
