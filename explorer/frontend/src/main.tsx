import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom'
import Layout from './app/Layout'
import { HomeRedirect } from './components/account'
import RequireRole from './components/RequireRole'
import LoginPage from './pages/LoginPage'
import { LEGACY_REDIRECTS, PAGES } from './app/routes'
import AiAssistantPage from './pages/AiAssistantPage'
import AnalysisPage from './pages/AnalysisPage'
import BeforeAfterPage from './pages/BeforeAfterPage'
import CalculatorPage from './pages/CalculatorPage'
import ChecklistPage from './pages/ChecklistPage'
import DashboardPage from './pages/DashboardPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import PlannedPage from './pages/PlannedPage'
import RagEvaluationPage from './pages/RagEvaluationPage'
import ReportPage from './pages/ReportPage'
import ReferencePage from './pages/ReferencePage'
import SettingsPage from './pages/SettingsPage'
import SimulationPage from './pages/SimulationPage'
import MobileAlerts from './mobile/MobileAlerts'
import { startPresentation } from './lib/presentation'
import { readPresentation } from './store/ui'
import './index.css'

// 예전 해시 주소(#/data 등)로 들어오면 일반 주소로 바꿉니다.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1))
}

const IMPLEMENTED: Record<string, JSX.Element> = {
  dashboard: <DashboardPage />,
  checklist: <ChecklistPage />,
  simulation: <SimulationPage />,
  calculator: <CalculatorPage />,
  analysis: <AnalysisPage />,
  beforeAfter: <BeforeAfterPage />,
  reference: <ReferencePage />,
  aiAssistant: <AiAssistantPage />,
  knowledgeBase: <KnowledgeBasePage />,
  ragEvaluation: <RagEvaluationPage />,
  settings: <SettingsPage />,
}

const children: RouteObject[] = [
  { index: true, element: <HomeRedirect /> },
  ...PAGES.map((p) => ({ path: p.path.slice(1) + '/*', element: IMPLEMENTED[p.key] ?? <PlannedPage page={p} /> })),
  ...LEGACY_REDIRECTS.map(([from, to]) => ({ path: from.replace(/^\/|\/$/g, '') + '/*', element: <Navigate to={to} replace /> })),
  // 알림 전체 화면 (모바일 하단 '알림' 탭 · PC 에서도 같은 주소로 열 수 있음)
  { path: 'notifications', element: <MobileAlerts /> },
  { path: '*', element: <HomeRedirect /> },
]

// 인쇄용 보고서는 사이드바·헤더 없이 (Layout 밖)
// 로그인 화면은 Layout 밖 (로그인 전에 업무 화면·데이터를 불러오지 않음)
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/report', element: <RequireRole role="PLANT_ENGINEER"><ReportPage /></RequireRole> },
  { path: '/', element: <Layout />, children },
])

startPresentation(readPresentation())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
