import type { Bilingual } from './types'

// 서버 공통 오류 형식: {"error": {"code", "message": {ko, en}, "fields"}}
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public text: Bilingual,
    public fields: Record<string, string[] | Bilingual> = {},
  ) {
    super(text.en)
  }
}

/** 서버가 로그인 세션이 없거나 만료됐다고 알릴 때 */
export const UNAUTHORIZED = 'hrsgx:unauthorized'

/** Django 가 발급한 CSRF 토큰 (쿠키 csrftoken — 세션 쿠키와 달리 화면에서 읽을 수 있는 값) */
export function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

const NETWORK: Bilingual = { ko: '서버에 연결할 수 없습니다.', en: 'Cannot reach the server.' }
const BAD_SHAPE: Bilingual = {
  ko: '서버 응답 형식이 예상과 다릅니다. 화면 데이터를 바꾸지 않았습니다.',
  en: 'Unexpected server response. Nothing on screen was changed.',
}

type Guard<T> = (x: unknown) => x is T

/** 서버 데이터를 바꾸는 요청(GET 제외)이 끝나면 알림 센터가 바로 다시 읽도록 알립니다 (성공·실패 모두). */
const MUTATED = 'hrsgx:mutated'
export const onMutated = (f: () => void) => {
  window.addEventListener(MUTATED, f)
  return () => window.removeEventListener(MUTATED, f)
}

/** JSON API 호출. guard 를 주면 응답 모양을 검사하고, 다르면 ApiError('BAD_RESPONSE') 를 던집니다. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, guard?: Guard<T>): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  try {
    return await request<T>(path, init, guard)
  } finally {
    if (method !== 'GET' && !path.startsWith('/notifications/')) window.dispatchEvent(new Event(MUTATED))
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown }, guard?: Guard<T>): Promise<T> {
  const { json, ...rest } = init
  const method = (rest.method ?? 'GET').toUpperCase()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      credentials: 'same-origin', // 로그인 세션 쿠키
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken() } : {}), // 서버가 세션 로그인 요청의 CSRF 토큰을 확인
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError('NETWORK', 0, NETWORK)
  }
  if (res.status === 204) return undefined as T
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Vite 프록시가 백엔드에 닿지 못하면 JSON 이 아닌 502/504 응답을 돌려줍니다.
    throw new ApiError(res.status >= 500 ? 'NETWORK' : 'BAD_RESPONSE', res.status, res.status >= 500 ? NETWORK : BAD_SHAPE)
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: Bilingual; fields?: Record<string, string[] | Bilingual> } })?.error
    // 로그인 만료·로그아웃된 세션 → 로그인 화면으로 (로그인 실패 자체는 제외)
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED))
    throw new ApiError(err?.code ?? 'HTTP_' + res.status, res.status, err?.message ?? BAD_SHAPE, err?.fields ?? {})
  }
  if (guard && !guard(body)) throw new ApiError('BAD_RESPONSE', res.status, BAD_SHAPE)
  return body as T
}
