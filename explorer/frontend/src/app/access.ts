import type { Bilingual } from '../api/types'
import { MENU, PAGES, type MenuGroup, type PageDef } from './routes'

// 역할별 화면 접근 (화면 쪽 보호). 실제 권한은 서버 권한표(accounts.policy)가 정하며, 여기 값을 바꿔도 서버 데이터는 열리지 않습니다.
export type Role = 'PLANT_ENGINEER' | 'AI_ADMIN'

export interface SessionUser {
  employee_id: string
  name: string
  role: Role
  role_label: Bilingual
  home: string
}

const PLANT_KEYS = ['dashboard', 'checklist', 'simulation', 'calculator', 'analysis', 'beforeAfter', 'aiAssistant', 'reference']
const ADMIN_KEYS = ['knowledgeBase', 'ragEvaluation']
// 메뉴에는 없지만 허용 화면 안에서 쓰는 주소 (알림 전체 화면, 인쇄용 보고서)
const PLANT_EXTRA = ['/notifications', '/report']

export const HOME: Record<Role, string> = { PLANT_ENGINEER: '/dashboard', AI_ADMIN: '/rag-evaluation' }

const keysOf = (role: Role) => (role === 'PLANT_ENGINEER' ? PLANT_KEYS : ADMIN_KEYS)

/** 이 역할이 이 주소(경로·쿼리 포함 가능)를 열 수 있는지 */
export function canAccess(role: Role | null | undefined, to: string) {
  if (!role) return false
  const path = to.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  const pages = PAGES.filter((p) => keysOf(role).includes(p.key)).map((p) => p.path)
  const extra = role === 'PLANT_ENGINEER' ? PLANT_EXTRA : []
  return [...pages, ...extra].some((p) => path === p || path.startsWith(p + '/'))
}

/** 역할별 사이드바 메뉴 — 항목이 없는 그룹은 제목도 숨김. AI 관리자는 'RAG 관리' 그룹 하나 */
export function menuFor(role: Role): MenuGroup[] {
  if (role === 'AI_ADMIN') return [{ key: 'rag', pages: PAGES.filter((p) => ADMIN_KEYS.includes(p.key)) }]
  return MENU.map((g) => ({ ...g, pages: g.pages.filter((p: PageDef) => PLANT_KEYS.includes(p.key)) })).filter((g) => g.pages.length > 0)
}

/** 로그인 후 돌아갈 주소: 이 역할에 허용된 경우에만, 아니면 시작 화면 */
export function safeNext(role: Role, next: string | null) {
  if (next && next.startsWith('/') && !next.startsWith('//') && canAccess(role, next)) return next
  return HOME[role]
}
