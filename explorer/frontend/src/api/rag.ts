// Phase 5 응답 타입: 논문 근거 검색·AI 대화·검색 성능 기록·지식베이스
import type { Bilingual } from './types'

export type SearchMode = 'bm25' | 'dense' | 'hybrid'
export type ConfigKey = 'locked' | 'equal40'

export interface Evidence {
  i: number
  ref: string
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  venue: string | null
  page: number | null
  kind: 'text' | 'note'
  text: string
  rank: number
  // 검색 점수·순위는 RAG 평가 화면(AI 관리자)에서만 옵니다 — 챗봇 응답에서는 서버가 빼서 보냄
  bm25_rank?: number | null
  dense_rank?: number | null
  bm25_score?: number | null
  cosine?: number | null
  rrf?: number | null
  cited?: boolean
  scope?: 'OFFICIAL' | 'UPLOAD'
}

export interface SearchConfig {
  label: Bilingual
  vector_weight: number
  bm25_k: number
  vector_k: number
  rrf_k: number
  final_k: number
  per_ref_cap: number
  validated: boolean
}

export interface Generation {
  status: 'ok' | 'not_configured' | 'disabled' | 'no_passages' | 'refused' | 'error'
  model?: string
  text?: string
  citations?: number[]
  warnings?: { type: 'invalid_citations' | 'no_citations' | 'unverified_numbers' | 'truncated'; values?: (string | number)[] }[]
  message?: string
  ms?: number
}

export interface AssistantPayload {
  mode: SearchMode
  requested_mode: SearchMode
  fallback_reason: string | null
  config: ConfigKey
  terms: { ko: string; en: string }[]
  timing: { bm25_ms: number; dense_ms?: number }
  evidence: Evidence[]
  generation: Generation
  lang: 'ko' | 'en'
  snapshot: null | { id: number; label: string; created_at: string; lines: string[] }
  context?: PageContext | null
  verification: { kind: 'AUTOMATIC'; note: Bilingual }
}

/** 화면 맥락 (서버가 DB 값으로 만든 줄 목록). page 이름만 보내고 숫자는 서버가 채웁니다. */
export type ContextPage = 'dashboard' | 'calculator' | 'simulation' | 'analysis' | 'before-after' | 'checklist'
export interface PageContext {
  page: ContextPage
  label: Bilingual
  lines: string[]
  stale: string[]
  notification?: number // 'AI에게 설명 요청'으로 첨부한 알림 ID
  /** 화면 맞춤 질문을 보낼 수 있는지 (서버 저장값 기준) */
  available?: Record<string, boolean | number>
}

export interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  payload: AssistantPayload | { masking?: { type: string; count: number }[]; snapshot_id?: number | null; context?: ContextPage | null }
  created_at: string
  feedback: null | { rating: 'up' | 'down'; comment: string }
}

export interface Conversation {
  id: number
  case: number
  title: string
  created_at: string
  updated_at: string
  message_count: number
  messages?: Message[]
}

export interface RagInfo {
  corpus: null | { documents: number; passages: number; sha256: string; file: string; official: boolean }
  error: string | null
  vector: { status: 'ready' | 'not_loaded' | 'unavailable'; reason: string | null; device: string | null; model: string | null; revision: string }
  /** AI 관리자에게만 (플랜트 엔지니어 챗봇에는 검색 설정을 보내지 않음) */
  configs?: Record<ConfigKey, SearchConfig>
  ai: { key_configured: boolean; external_enabled: boolean; model: string; ready: boolean }
}

export interface CompareResult {
  config: ConfigKey
  settings: SearchConfig
  terms: { ko: string; en: string }[]
  timing: { bm25_ms: number; dense_ms?: number }
  fallback_reason: string | null
  modes: Record<SearchMode, null | { results: Evidence[]; candidates: number; skipped_by_cap: number }>
}

export interface Summary { n: number; recall: number; hit: number; mrr: number; page: number | null }

export interface Experiments {
  source: string
  eval_set: string
  split_note: { dev: number; test: number; scored_dev: number; scored_test: number }
  dev_experiments: { stage: string; model: string; mode: string; vector_weight: number | null; bm25_k: number; vector_k: number; rrf_k: number; ko_recall8: number | null; ko_mrr: number | null; en_recall8: number | null; all_recall8: number | null; all_mrr: number | null }[]
  test_locked: { group: string; n: number; base_recall: number; locked_recall: number; base_mrr: number; locked_mrr: number; recall_delta_pp: number }[]
  locked_meta: { locked_config: Record<string, unknown>; device: string; dev_part_matches_dev_experiment: boolean } | null
  verify: null | { checked_at: string; questions: number; bm25_match: number; hybrid_match: number; top8_match: number; device: string; query_ms_median: number; note: string }
  dev_runs: Record<string, { config: ConfigKey; settings: SearchConfig; summary: Record<string, Summary>; ran_at: string; scorer: string }>
  unverified_claims: { claim: string; status: string }[]
  configs: Record<ConfigKey, SearchConfig>
}

export interface Paper {
  ref: string
  title: string
  authors: string[]
  year: number | null
  venue?: string
  doi?: string
  url?: string
  chunks: number
  kinds: string[]
  embedding: 'EMBEDDED' | 'MISSING'
  scope: 'OFFICIAL'
  version: string
}

export interface PapersPayload {
  papers: Paper[]
  index: { documents: number; chunks: number; corpus_sha256: string; vectors: number[] | null; embedding_created_at: string | null; model: string | null; revision: string; vector_status: string; vector_reason: string | null }
  readonly: boolean
  note: Bilingual
}

export interface Label {
  id: number
  question: string
  lang: 'ko' | 'en'
  expected_refs: string[]
  evidence: { ref: string; page?: number | null; passage_i?: number }[]
  reviewer: string
  status: 'DRAFT' | 'REVIEWED' | 'APPROVED'
  memo: string
  created_at: string
  updated_at: string
}

export interface TemplateAnswer {
  topic: string | null
  text: string
  sources: string[]
  type: 'TEMPLATE_DEMO'
}

export interface AppSettings {
  ai: RagInfo['ai']
  sensitive_terms: string[]
  search: { configs: Record<ConfigKey, SearchConfig>; default: ConfigKey }
}

export const isAssistant = (m: Message): m is Message & { payload: AssistantPayload } => m.role === 'assistant'
