// 서버 응답 타입과 실행 중 형식 검사. 서버가 예상과 다른 모양을 보내면 화면 상태를 바꾸지 않습니다(데이터 오염 방지).

export type Lang = 'ko' | 'en'
export type Bilingual = { ko: string; en: string }

export interface Case {
  id: number
  name: string
  memo: string
  is_demo: boolean
  cloned_from: number | null
  created_at: string
  updated_at: string
}

export interface ClonePolicy {
  copied: string[]
  not_copied: string[]
}

export interface Health {
  status: 'ok' | 'error'
  server: 'ok'
  database: 'ok' | 'error'
  search: { status: 'ready' | 'unavailable'; vector: 'ready' | 'not_loaded' | 'unavailable'; reason?: Bilingual | null }
  ai: { status: 'not_connected' | 'ready'; reason?: Bilingual | null; key_configured: boolean; external_enabled: boolean }
  checked_at: string
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

export function isCase(x: unknown): x is Case {
  return (
    isObj(x) &&
    typeof x.id === 'number' &&
    typeof x.name === 'string' &&
    typeof x.memo === 'string' &&
    typeof x.is_demo === 'boolean' &&
    (x.cloned_from === null || typeof x.cloned_from === 'number') &&
    typeof x.created_at === 'string' &&
    typeof x.updated_at === 'string'
  )
}

export const isCaseList = (x: unknown): x is Case[] => Array.isArray(x) && x.every(isCase)

export const isCloneResult = (x: unknown): x is { case: Case; policy: ClonePolicy } =>
  isObj(x) && isCase(x.case) && isObj(x.policy)

export function isHealth(x: unknown): x is Health {
  return (
    isObj(x) &&
    (x.database === 'ok' || x.database === 'error') &&
    isObj(x.search) &&
    isObj(x.ai) &&
    typeof x.checked_at === 'string'
  )
}
