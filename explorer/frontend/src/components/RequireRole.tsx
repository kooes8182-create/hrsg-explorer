import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Role } from '../app/access'
import { useAuth } from '../store/auth'
import { AccessDenied, BootScreen } from './account'

/** Layout 밖 화면(인쇄용 보고서)용 로그인·역할 확인 */
export default function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { status, user, check } = useAuth()
  const loc = useLocation()
  useEffect(() => {
    check()
  }, [check])
  if (status === 'checking') return <BootScreen />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (user.role !== role) return <div className="p-6"><AccessDenied user={user} /></div>
  return <>{children}</>
}
