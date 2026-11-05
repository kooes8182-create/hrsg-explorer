// Phase 3 서버 응답 타입 (계산·체크리스트·실측값·용어집). 계산은 서버에서만 하고, 화면은 받은 값을 표시만 합니다.
import type { Bilingual } from './types'

export type Rel =
  | 'DEMO' | 'EXAMPLE' | 'USER_INPUT' | 'MEASURED' | 'PUBLIC_REF' | 'NEEDS_VERIFICATION'
  | 'VERIFIED' | 'UNCONFIRMED' | 'MODEL_NOT_CONNECTED' | 'UNAVAILABLE' | 'REEVALUATION_REQUIRED'

/** 결과 값 하나. value 가 null 이면 reason 이 반드시 있습니다. */
export interface Val<T = number> {
  value: T | null
  unit: string | null
  reason: Bilingual | null
  /** 금액 표시 글자 (키트 format_krw, 예: 「2.04억 원」) */
  text?: string
  rel?: Rel
  source?: string
  note?: Bilingual
  day?: number
}

export interface FieldSpec {
  key: string
  group: 'equipment' | 'thermo' | 'economics' | 'methods'
  label: Bilingual
  unit: string | null
  min: number | null
  max: number | null
  default: number | string | null
  required: boolean
  kind: 'number' | 'choice'
  choices: string[] | null
  note: Bilingual | null
  method: string | null
}

export interface ScenarioSpec {
  id: 'NORMAL' | 'ALARM' | 'TRIP'
  label: Bilingual
  status: string
  status_label: Bilingual
  values: Values
}

export interface UnitDef {
  quantity: 'pressure' | 'temperature' | 'flow'
  factor: number
  offset: number
}

export interface Schema {
  fields: FieldSpec[]
  groups: Record<string, Bilingual>
  methods: { key: string; ko: string; en: string }[]
  scenarios: ScenarioSpec[]
  scenario_note: Bilingual
  defaults: Values
  units: Record<string, UnitDef>
  coefficients: { key: string; value: number | string; label: Bilingual; where: string }[]
  engine_version: string
}

export type Values = Record<string, number | string | null>
export type Mode = 'DEMO' | 'USER'
export type Scenario = 'NORMAL' | 'ALARM' | 'TRIP' | 'CUSTOM'

export interface InputsPayload {
  mode: Mode
  scenario: Scenario
  values: Values
  sources: Record<string, 'DEMO' | 'USER_INPUT' | null>
  hash: string
  warnings: { key: string; message: Bilingual }[]
  updated_at: string
}

export interface Step {
  id: string
  label: Bilingual
  formula: string
  substituted?: string
  result?: number
  unit?: string
  note?: Bilingual
}

export interface Point {
  x: number
  y: number | null
  id?: number
}

export interface Performance {
  scenario: Scenario | null
  status: { code: 'NORMAL' | 'ALARM' | 'TRIP' | 'UNKNOWN'; label: Bilingual; rel: Rel; reason: Bilingual }
  currentBP: Val
  baselineBP: Val
  excessBP: Val
  excessBP_inH2O: Val
  stackTempC: Val
  lossMW: Val
  lossWonMonth: Val
  cleaningScore: { value: number | null; bpPart: number; tempPart: number | null; reason: Bilingual | null; rel: Rel; note: Bilingual; formula: string }
  referenceBand: { mmH2O: [number, number]; inH2O: [number, number]; position: 'BELOW' | 'WITHIN' | 'ABOVE'; source: Source; note: Bilingual }
  lossCurve: { x: number; y: number }[] | null
  /** 배압 상태 게이지 (키트 r.gauge, mmH₂O) */
  gauge?: { valueMM: number; maxMM: number; refMM: [number, number] } | null
  steps: Step[]
  warnings: Bilingual[]
  notice: Bilingual
}

export interface MethodResult {
  key: string
  name: Bilingual
  /** false 면 「산출 불가 — 입력 필요: …」 (키트 available/message) */
  available?: boolean
  message?: Bilingual
  recoveryMW: Val
  cost: Val
  outageDays: Val
  monthlyBenefit: Val
  outageCost: Val
  initialCost: Val
  paybackMonths: Val
  bepDays: Val
  firstMonthNet: Val
}

export interface Economics {
  methods: MethodResult[]
  shortestPayback: string | null
  /** 비교 탭별 정렬 (키트 compareMethods 'payback' | 'total' | 'net') */
  order?: Partial<Record<'paybackMonths' | 'initialCost' | 'firstMonthNet', string[]>>
  shortestNote: Bilingual
  economicParams: { method: string; monthlyNetBenefit: number; initialCost: number; bepDays: number; targetRecoveryMW: number } | null
  sensitivity: {
    smp: { x: number[]; unit: string; series: Record<string, (number | null)[]> }
    hours: { x: number[]; unit: string; series: Record<string, (number | null)[]> }
    y_unit: string
  }
  steps: Step[]
  warnings: Bilingual[]
  coefficients: Schema['coefficients']
  notice: Bilingual
  doubleCountNote: Bilingual
}

export type Position = 'BELOW' | 'WITHIN' | 'ABOVE' | null

export interface Pinch {
  notice: Bilingual
  basis: 'absolute' | 'gauge'
  drumPressureAbsMPa: number
  ranges: { demo: { pinch: [number, number]; approach: [number, number] }; ist2000: { pinch: [number, number]; approachTypical: number } }
  sources: Source[]
  steps: Step[]
  saturationTempC: Val
  pinch: Val
  approach: Val
  position: { demo: { pinch: Position; approach: Position }; ist2000: { pinch: Position } } | null
  designDiff: { pinch: Val; approach: Val } | null
  warnings?: Bilingual[]
  /** 키트 pinchSection 판정·문구 */
  level?: 'normal' | 'caution' | 'danger' | 'no_data'
  message?: Bilingual
  design?: { pinch_c: number; approach_c: number } | null
}

export interface Effects {
  output_loss_pct: { low: Val; high: Val }
  output_loss_mw: { low: Val; high: Val }
  heat_rate_increase_pct: Val
  exhaust_temp_increase_c: Val
}

export interface Reference {
  notice: Bilingual
  trigger_reference_in_h2o: [number, number]
  steam_turbine_loss: Val
  stack_temp_increase: Val
  sources: Source[]
  dp_increase: { kpa: Val; in_h2o: Val }
  trigger_position: Position
  effects: Effects | null
  effects_reason: Bilingual | null
  recovery: (Effects & { dp_reduction: { kpa: Val; in_h2o: Val } }) | null
  recovery_reason: Bilingual | null
  gtOutputMW: { value: number; unit: string; note: Bilingual }
}

export interface Comparison {
  method: string | null
  methodName: Bilingual | null
  initialCost: Val
  virtual: { backPressure: Point[]; stackTempC: Point[]; lossMW: Point[]; cumulativeNet: Point[] | null; assumption: Bilingual }
  virtualBepDays: number | null
  measured: { backPressure: Point[]; stackTempC: Point[]; lossMW: Point[]; cumulativeNet?: Point[] | null }
  kpi: null | {
    backPressureBefore: Val; backPressureAfter: Val; backPressureChange: Val; stackTempChange: Val; recoveryMW: Val; cumulativeNet: Val
  }
  kpiReason: Bilingual | null
  deviation: null | {
    loadDiffPP: number | null; ambientDiffC: number | null; limits: { loadPP: number; ambientC: number }
    exceeded: boolean; message: Bilingual | null; missing: boolean; note: Bilingual
  }
  actualPerformanceGap: null | { d0_backPressure: number; current_backPressure: number; actualRecoveryMW: number; bepAchieved: boolean | null }
  warnings: Bilingual[]
  count: number
}

export interface Source {
  type?: string
  key: string
  title: string | Bilingual
  author?: string
  year?: number | null
  where?: string
  scope: Bilingual
  checked_on?: string
  quote?: string
  limit?: Bilingual
}

export type Kind = 'performance' | 'economics' | 'pinch' | 'reference' | 'comparison'
export interface PayloadByKind {
  performance: Performance
  economics: Economics
  pinch: Pinch
  reference: Reference
  comparison: Comparison
}
export interface ResultEntry<K extends Kind = Kind> {
  payload: PayloadByKind[K]
  computed_at: string
  inputs_hash: string
  engine_version: string
  stale: boolean
}
export interface ResultsPayload {
  results: { [K in Kind]?: ResultEntry<K> }
  current_hash: string
  last_calculated_at: string | null
}

export interface SnapshotSummary {
  id: number
  label: string
  mode: Mode
  scenario: Scenario
  inputs_hash: string
  engine_version: string
  created_at: string
  summary: { lossMW: number | null; excessBP: number | null; cleaningScore: number | null; shortestPayback: string | null }
  values?: Values
  results?: Partial<PayloadByKind>
}

// ---------------------------------------------------------------- 체크리스트
export type Supply = 'NOT_ENTERED' | 'REQUEST_NEEDED' | 'RECEIVED' | 'NEEDS_CHECK' | 'NA'
export type Verify = 'UNVERIFIED' | 'IN_PROGRESS' | 'VERIFIED' | 'FAILED'

export interface ChecklistState {
  reviewed: boolean
  value: string | null
  unit: string
  location: string
  condition: string
  measured_at: string | null
  data_source: string
  supply_status: Supply
  verify_status: Verify
  document_confirmed: boolean
  memo: string
}

export interface ChecklistItem {
  id: string
  category: 'A' | 'B' | 'C' | 'D' | 'E'
  name: Bilingual
  data_type: 'number' | 'text' | 'date' | 'document'
  unit: string | null
  reason: Bilingual
  required: boolean
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  calc_field: string | null
  source: 'PROMPT_GUIDE' | 'PLAN_DRAFT' | 'PUBLIC_REF' | 'KIT'
  /** 키트: 「필수 · 높음」 (priorityLabel), 측정값 칸 (measureCell), 설명 줄 (detailLine) */
  priority_label?: string
  measure_cell?: string
  detail_line?: string
  legacy: string[]
  ref: string | null
  ext_group: string | null
  state: ChecklistState
  updated_at: string
  /** 현장 사진 수 (모바일 점검) */
  photos?: number
}

export interface Attachment {
  id: number
  item_id: string
  original_name: string
  content_type: string
  size: number
  created_at: string
  url: string
}

export interface ChecklistSummary {
  totalCount: number
  receivedCount: number
  verifiedCount: number
  reviewedCount: number
  requiredCount: number
  requiredMetCount: number
  missingRequiredCount: number
  readinessRate: number | null
  reviewRate: number | null
  verifiedRate: number | null
  requiredMetRate: number | null
  byCategory: Record<string, { total: number; received: number; rate: number | null }>
  bySupply: Record<Supply, number>
  matrix: Record<string, Record<Supply, number>>
  byVerify: Record<Verify, number>
  missingRequired: string[]
  provisional: boolean
}

export interface ChecklistPayload {
  items: ChecklistItem[]
  summary: ChecklistSummary
  /** 키트 filterItems 결과 (요청 주소의 검색·카테고리·상태·필수만 조건) */
  filtered?: string[]
  categories: { code: string; label: Bilingual }[]
  labels: { supply: Record<Supply, Bilingual>; verify: Record<Verify, Bilingual> }
}

export interface RequestText {
  subject: string
  body: string
  format: 'markdown' | 'html'
  lang: 'ko' | 'en'
  items: string[]
  items_key: string
  generated_at: string
  count: number
}

export interface Measurement {
  id: number
  dayOffset: number
  backPressure: number
  stackTempC: number | null
  loadFactor: number | null
  ambientTempC: number | null
  measuredOn: string | null
  memo: string
}

export interface GlossaryPayload {
  glossary: { key: string; term: Bilingual; definition: Bilingual; formula: string | null; pages: string[]; sources: string[] }[]
  categories: { key: string; label: Bilingual; items: Source[]; empty?: Bilingual }[]
  checkedOn: string
}

export interface SmpPayload {
  unit: string
  region: Bilingual
  average: Bilingual
  monthly: { month: string; value: number }[]
  annual: { year: string; value: number }[]
  source: Source
  notice: Bilingual
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
export const isSchema = (x: unknown): x is Schema => isObj(x) && Array.isArray(x.fields) && isObj(x.units)
export const isInputs = (x: unknown): x is InputsPayload => isObj(x) && isObj(x.values) && typeof x.hash === 'string'
export const isResults = (x: unknown): x is ResultsPayload => isObj(x) && isObj(x.results) && typeof x.current_hash === 'string'
export const isChecklist = (x: unknown): x is ChecklistPayload => isObj(x) && Array.isArray(x.items) && isObj(x.summary)
export const isMeasurementList = (x: unknown): x is Measurement[] => Array.isArray(x) && x.every((m) => isObj(m) && typeof m.dayOffset === 'number')
export const isSnapshotList = (x: unknown): x is SnapshotSummary[] => Array.isArray(x) && x.every((s) => isObj(s) && typeof s.id === 'number')

// ---------------------------------------------------------------- 대시보드 집계 (Phase 4)
export interface OverviewKpi {
  key: 'backPressure' | 'stackTemp' | 'lossMW' | 'lossMonthlyWon' | 'recoveryPct' | 'cleaningScore' | 'readiness'
  label: Bilingual
  value: number | [number | null, number | null] | null
  unit: string
  rel: Rel | 'DEMO' | 'USER_INPUT' | null
  baseline: number | null
  delta: number | null
  changeRate: number | null
  status: string | null
  computedAt: string | null
  reason: Bilingual | null
  previous: number | null
  note: Bilingual | null
}

export interface Overview {
  case: { id: number; name: string; is_demo: boolean }
  mode: Mode
  scenario: Scenario
  values: Values
  sources: Record<string, 'DEMO' | 'USER_INPUT' | null>
  status: Performance['status']
  lastEvaluatedAt: string | null
  kpis: OverviewKpi[]
  panel: {
    turbineModel: string; capacityMW: number; loadFactor: number; currentBP: number; baselineBP: number
    hrsgDpKpa: number | null; stackTempC: number; excessBP: number | null; referenceBand: Performance['referenceBand'] | null
  }
  calc_summary_kpi: null | { backPressure: number; deltaP: number | null; stackTemp: number; lossMW: number | null; lossMonthlyWon: number | null; recoveryBenefit: number | null; cleaningNeedScore: number | null }
  calc_economic_params: Economics['economicParams']
  checklist_readiness: { totalCount: number; receivedCount: number; requiredMetCount: number; readinessRate: number | null; verifiedCount: number; missingRequiredCount: number }
  checklist: { summary: ChecklistSummary; missingRequired: { id: string; name: Bilingual }[] }
  actual_performance_gap: Comparison['actualPerformanceGap']
  comparison: Comparison | null
  economics: null | { methods: MethodResult[]; shortestPayback: string | null; shortestNote: Bilingual }
  workflow: { key: 'data' | 'simulation' | 'analysis' | 'ai'; state: 'done' | 'progress' | 'todo' | 'stale' | 'unavailable'; detail: Bilingual; link: string }[]
  recommendations: { key: string; tone: 'accent' | 'caution' | 'info'; text: Bilingual; link: string }[]
  alerts: { tone: 'caution' | 'danger'; text: Bilingual }[]
  activity: { type: 'result' | 'snapshot' | 'measurement'; kind?: Kind; label?: string; id?: number; at: string; stale?: boolean }[]
}
export const isOverview = (x: unknown): x is Overview => isObj(x) && Array.isArray(x.kpis) && Array.isArray(x.workflow)
