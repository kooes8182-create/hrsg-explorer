import { useCallback } from 'react'
import type { UnitDef } from '../api/engine'
import type { Lang } from '../api/types'
import { useApp } from '../store/app'
import { useCaseData } from '../store/caseData'

// 숫자·단위 표시. 단위 환산은 서버가 준 변환표(schema.units)로 '표시만' 바꿉니다 — 계산 값은 그대로.

export function fmtNum(v: number | null | undefined, lang: Lang, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { maximumFractionDigits: digits })
}

/** 원화: 전체 금액 + (한국어) 억·만 요약 */
export function fmtWon(v: number | null | undefined, lang: Lang): { full: string; short: string } {
  if (v === null || v === undefined) return { full: '—', short: '—' }
  const full = `${v.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US')} ${lang === 'ko' ? '원' : 'KRW'}`
  const a = Math.abs(v), sign = v < 0 ? '−' : ''
  let short: string
  if (lang === 'ko') short = a >= 1e8 ? `${sign}${(a / 1e8).toFixed(2)}억 원` : a >= 1e4 ? `${sign}${(a / 1e4).toFixed(0)}만 원` : full
  else short = a >= 1e9 ? `${sign}₩${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${sign}₩${(a / 1e6).toFixed(1)}M` : full
  return { full, short }
}

export function fmtDateTime(iso: string | null | undefined, lang: Lang) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const DISPLAY_UNIT: Record<string, string> = { mmH2O: 'mmH₂O', inH2O: 'inH₂O', 'in H2O': 'inH₂O', kPa: 'kPa', mbar: 'mbar', '°C': '°C', '°F': '°F' }
/** 표시 단위별 알맞은 소수 자릿수 (예: 450 mmH₂O = 4.413 kPa 이므로 kPa 는 3자리) */
const UNIT_DIGITS: Record<string, number> = { kPa: 3, inH2O: 2, mbar: 1, mmH2O: 1, '°C': 1, '°F': 1 }
export const unitDigits = (unit: string | null | undefined, fallback: number) => (unit && unit in UNIT_DIGITS ? UNIT_DIGITS[unit] : fallback)

export const unitLabel = (u: string | null | undefined) => (u ? DISPLAY_UNIT[u] ?? u : '')

function convert(v: number, from: UnitDef, to: UnitDef) {
  const base = (v - from.offset) / from.factor
  return base * to.factor + to.offset
}

/** 압력·온도 값을 사용자가 고른 표시 단위로 (다른 단위는 그대로) */
export function useDisplay() {
  const units = useCaseData((s) => s.schema?.units)
  const pressureUnit = useApp((s) => s.pressureUnit)
  const tempUnit = useApp((s) => s.tempUnit)
  return useCallback(
    (value: number | null | undefined, unit: string | null | undefined): { value: number | null; unit: string } => {
      if (value === null || value === undefined || !unit || !units?.[unit]) return { value: value ?? null, unit: unit ?? '' }
      const from = units[unit]
      // 배압·차압(수주·kPa·mbar 계열)은 표시 단위로, 드럼 압력(bar)은 그대로
      const smallPressure = ['mmH2O', 'kPa', 'inH2O', 'mbar'].includes(unit)
      const target = smallPressure ? pressureUnit : from.quantity === 'temperature' ? tempUnit : unit
      const to = units[target]
      if (!to || to.quantity !== from.quantity || target === unit) return { value, unit }
      return { value: convert(value, from, to), unit: target }
    },
    [units, pressureUnit, tempUnit],
  )
}
