// 알림 센터 응답 타입 (서버 notifications 앱)
import type { Bilingual } from './types'

export type NotifCategory = 'OPERATION' | 'DATA' | 'CALC' | 'SYSTEM'
export type NotifSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS'

export interface AppNotification {
  id: number
  caseId: number | null
  kind: 'STATE' | 'EVENT' // STATE: 해결 개념 있음 · EVENT: 한 번 일어난 일
  category: NotifCategory
  severity: NotifSeverity
  title: Bilingual
  message: Bilingual
  source: string
  isDemo: boolean
  createdAt: string
  readAt: string | null
  resolvedAt: string | null
  targetRoute: string
  targetItemId: string
  eventKey: string
  /** 관련 수치·기준값 (알림을 만들 때의 서버 값) */
  data?: { label: Bilingual; value: string }[]
  /** 발생 조건 */
  condition?: Bilingual | null
  /** 추가로 확인할 사항 */
  checks?: Bilingual[]
}

export interface NotificationList {
  items: AppNotification[]
  unread: number
  unresolved: number
  live_plant_data: boolean
}

export const isNotificationList = (x: unknown): x is NotificationList =>
  !!x && typeof x === 'object' && Array.isArray((x as NotificationList).items) && typeof (x as NotificationList).unread === 'number'
