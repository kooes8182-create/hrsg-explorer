import { createRouter, createWebHistory } from 'vue-router'

import HomeView from './views/HomeView.vue'
import DataView from './views/DataView.vue'
import EvalLayout from './views/EvalLayout.vue'
import SimulateView from './views/SimulateView.vue'
import AnalysisView from './views/AnalysisView.vue'
import AskView from './views/AskView.vue'
import AskLayout from './views/AskLayout.vue'
import PaperAskView from './views/PaperAskView.vue'
import LabLayout from './views/LabLayout.vue'
import LabRecordsView from './views/LabRecordsView.vue'
import DevSearchView from './views/DevSearchView.vue'

// 왼쪽 메뉴: 사용 목적별 두 묶음. labelKey 는 i18n 사전의 키, match 는 '현재 위치' 표시에 쓰는 경로 앞부분입니다.
export const menuGroups = [
  {
    key: 'work',
    items: [
      { path: '/home', match: '/home', labelKey: 'menu.home', icon: 'home' },
      { path: '/data', match: '/data', labelKey: 'menu.data', icon: 'data' },
      { path: '/simulate', match: '/simulate', labelKey: 'menu.simulate', icon: 'simulate' },
      { path: '/analysis', match: '/analysis', labelKey: 'menu.analysis', icon: 'analysis' },
    ],
  },
  {
    key: 'tools',
    items: [
      { path: '/ask', match: '/ask', labelKey: 'menu.ask', icon: 'ask' },
      { path: '/lab', match: '/lab', labelKey: 'menu.lab', icon: 'lab' },
    ],
  },
]
export const ANALYSIS_TABS = ['reference', 'economics', 'pinch', 'sources']

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/home', component: HomeView },
    { path: '/data', component: DataView },
    {
      // 시뮬레이션과 분석은 같은 평가 상태(입력·결과)를 공유합니다 → 화면을 옮겨도 입력이 남습니다.
      path: '/',
      component: EvalLayout,
      children: [
        { path: '', redirect: '/home' },
        { path: 'simulate', component: SimulateView },
        { path: 'analysis', redirect: '/analysis/reference' },
        { path: 'analysis/:tab(reference|economics|pinch|sources)', component: AnalysisView },
      ],
    },
    {
      // AI 도우미: 논문 근거 질문(RAG) / 평가 케이스 질문(기존 데모) 탭
      path: '/ask',
      component: AskLayout,
      children: [
        // 결과 화면의 '이 결과 질문하기'(/ask?about=...)는 케이스 질문으로
        { path: '', redirect: (to) => (to.query.about ? { path: '/ask/case', query: to.query } : '/ask/papers') },
        { path: 'papers', component: PaperAskView },
        { path: 'case', component: AskView },
      ],
    },
    {
      // 검색 성능 실험: 공식 평가셋 실험 기록 / 질문별 검색 비교(개인 프로토타입 코퍼스)
      path: '/lab',
      component: LabLayout,
      children: [
        { path: '', redirect: '/lab/records' },
        { path: 'records', component: LabRecordsView },
        { path: 'compare', component: DevSearchView },
      ],
    },
    // 예전 주소 → 새 주소
    { path: '/overview', redirect: '/home' },
    { path: '/evaluate', redirect: '/simulate' },
    { path: '/dev/search', redirect: (to) => ({ path: '/lab/compare', query: to.query }) },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
  scrollBehavior: (to, from, saved) => saved || (to.path !== from.path ? { top: 0 } : undefined),
})
