import { store } from './store.js'

// 서버가 주는 한/영 문구 {ko, en} 에서 현재 언어를 고릅니다.
export function txt(obj) {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  return obj[store.lang] ?? obj.ko ?? ''
}

// 숫자 표시 (천 단위 구분). 계산은 하지 않습니다.
export function num(v, digits) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toLocaleString(store.lang === 'en' ? 'en-US' : 'ko-KR',
    digits === undefined ? { maximumFractionDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const UNIT_EN = { 원: 'KRW', '원/kWh': 'KRW/kWh' }
export function unit(u) {
  if (!u) return ''
  return store.lang === 'en' ? UNIT_EN[u] ?? u : u
}

// 압력 표시 단위 변환 (저장·계산은 kPa). 1 in H2O = 249.08891 Pa, 1 mbar = 0.1 kPa
const PRESSURE = { kPa: { f: 1, label: 'kPa', d: 2 }, inH2O: { f: 1000 / 249.08891, label: 'in H2O', d: 1 }, mbar: { f: 10, label: 'mbar', d: 1 } }
export function pressure(kpa, unitKey = store.pressureUnit) {
  if (kpa === null || kpa === undefined || kpa === '') return { value: null, text: '—', unit: PRESSURE[unitKey].label }
  const p = PRESSURE[unitKey]
  const v = Number(kpa) * p.f
  return { value: v, text: num(v, p.d), unit: p.label }
}
export const pressureUnitLabel = (unitKey = store.pressureUnit) => PRESSURE[unitKey].label

export function dateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(store.lang === 'en' ? 'en-US' : 'ko-KR')
}
