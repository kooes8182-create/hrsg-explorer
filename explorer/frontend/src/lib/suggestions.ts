// 추천 질문 데이터 (한곳에서 관리). 추천 질문은 '미리 정한 사용자 질문'일 뿐이며, 답은 항상 실제 검색(BM25+BGE-M3+RRF)과
// AI 답변 로직으로 만듭니다 (미리 써 둔 답변 없음). 질문을 고치거나 더할 때는 이 파일만 바꾸면 됩니다.
import type { ContextPage } from '../api/rag'

export type SuggestCategory = 'thermo' | 'cleaning' | 'pinch' | 'data'

/** 화면 데이터가 필요한 질문의 조건 — 서버 /ai-context/ 의 available 값으로 판단합니다. */
export type Needs = 'performance' | 'economics' | 'comparison_kpi' | 'checklist' | null

export interface Suggestion {
  id: string
  category: SuggestCategory | 'screen'
  ko: string
  en: string
  /** 관련 화면 (참고·이동용) */
  route: string
  /** 함께 보낼 화면 데이터 (서버가 DB 값으로 만듦). null 이면 문헌 근거만 */
  context: ContextPage | null
  needs: Needs
}

export const CATEGORIES: { id: SuggestCategory; ko: string; en: string }[] = [
  { id: 'thermo', ko: '열역학·성능 영향', en: 'Thermodynamics & performance' },
  { id: 'cleaning', ko: '세정 공법 및 경제성', en: 'Cleaning & economics' },
  { id: 'pinch', ko: '핀치·어프로치 포인트', en: 'Pinch & approach' },
  { id: 'data', ko: '필요 데이터 가이드', en: 'Data guide' },
]

const q = (id: string, category: Suggestion['category'], ko: string, en: string, route: string, context: ContextPage | null = null, needs: Needs = null): Suggestion =>
  ({ id, category, ko, en, route, context, needs })

export const SUGGESTIONS: Suggestion[] = [
  q('thermo-1', 'thermo', 'HRSG 배압이 증가하면 발전 성능에 어떤 영향을 주는가?', 'How does higher HRSG back pressure affect plant performance?', '/simulation'),
  q('thermo-2', 'thermo', 'HRSG 차압(ΔP)이 상승하는 원인은 무엇인가?', 'What causes the HRSG pressure drop (ΔP) to rise?', '/analysis'),
  q('thermo-3', 'thermo', '스택 배기가스 출구 온도가 상승하면 무엇을 의미하는가?', 'What does a rising stack exhaust temperature indicate?', '/dashboard'),
  q('thermo-4', 'thermo', 'HRSG 오염(파울링)은 성능에 어떤 영향을 주는가?', 'How does HRSG fouling affect performance?', '/analysis'),

  q('cleaning-1', 'cleaning', 'HRSG 세정이 필요한 시점은 어떻게 판단하는가?', 'How do you decide when an HRSG needs cleaning?', '/dashboard'),
  q('cleaning-2', 'cleaning', '드라이아이스·고압수·화학 세정의 차이점은 무엇인가?', 'How do dry-ice, high-pressure water and chemical cleaning differ?', '/analysis'),
  q('cleaning-3', 'cleaning', '세정 공법별 경제성은 어떻게 비교하는가?', 'How are cleaning methods compared economically?', '/simulation'),
  q('cleaning-4', 'cleaning', '세정 투자 회수기간은 어떻게 계산하는가?', 'How is the payback period of a cleaning investment calculated?', '/simulation'),

  q('pinch-1', 'pinch', 'Pinch Point와 Approach Point의 차이는 무엇인가?', 'What is the difference between the pinch point and the approach point?', '/analysis?tab=pinch'),
  q('pinch-2', 'pinch', 'Pinch Point가 증가하면 어떤 문제가 발생하는가?', 'What problems arise when the pinch point increases?', '/analysis?tab=pinch'),
  q('pinch-3', 'pinch', '드럼 압력과 포화온도는 어떤 관계인가?', 'How are drum pressure and saturation temperature related?', '/analysis?tab=pinch'),
  q('pinch-4', 'pinch', 'Pinch/Approach Point는 HRSG 성능 평가에 어떻게 활용되는가?', 'How are pinch/approach points used in HRSG performance evaluation?', '/analysis?tab=pinch'),

  q('data-1', 'data', 'HRSG 성능 평가에 필요한 필수 데이터는 무엇인가?', 'What data is essential for an HRSG performance evaluation?', '/checklist'),
  q('data-2', 'data', '세정 전후 성능을 비교하려면 어떤 데이터가 필요한가?', 'What data is needed to compare performance before and after cleaning?', '/before-after'),
  q('data-3', 'data', '현재 평가 케이스에서 부족한 데이터는 무엇인가?', 'Which data is missing in the current evaluation case?', '/checklist', 'checklist', 'checklist'),
  q('data-4', 'data', '데이터가 부족할 때 어떤 분석이 제한되는가?', 'Which analyses are limited when data is missing?', '/checklist', 'checklist', 'checklist'),
]

/** 현재 화면 맞춤 질문 — 그 화면의 서버 데이터를 함께 보냅니다. 필요한 값이 없으면 보내지 않고 안내만 합니다. */
export type ScreenKey = ContextPage | 'notifications'

export const SCREEN_SUGGESTIONS: Record<ScreenKey, Suggestion[]> = {
  dashboard: [
    q('dash-1', 'screen', '현재 HRSG 운전 상태를 설명해 줘.', 'Explain the current HRSG operating state.', '/dashboard', 'dashboard', 'performance'),
    q('dash-2', 'screen', '현재 배압 상태에서 확인해야 할 사항은?', 'What should I check given the current back pressure?', '/dashboard', 'dashboard', null),
    q('dash-3', 'screen', '세정 필요도를 판단하려면 어떤 데이터가 더 필요한가?', 'What more data is needed to judge the cleaning need?', '/dashboard', 'dashboard', 'checklist'),
  ],
  calculator: [
    q('calc-1', 'screen', '현재 계산 결과를 설명해 줘.', 'Explain the current calculation results.', '/simulation', 'calculator', 'performance'),
    q('calc-2', 'screen', '발전 출력 손실이 계산된 이유는?', 'Why was this output loss calculated?', '/simulation', 'calculator', 'performance'),
    q('calc-3', 'screen', '세정 투자 회수기간을 해석해 줘.', 'Interpret the cleaning payback period.', '/simulation', 'calculator', 'economics'),
  ],
  simulation: [
    q('sim-1', 'screen', '현재 시나리오의 주요 특징은?', 'What are the key features of the current scenario?', '/simulation', 'simulation', 'performance'),
    q('sim-2', 'screen', '정상 운전과 세정 필요 시나리오의 차이는?', 'How do the normal and cleaning-needed scenarios differ?', '/simulation', 'simulation', null),
    q('sim-3', 'screen', '어떤 운전 조건이 결과에 영향을 주는가?', 'Which operating conditions affect the result?', '/simulation', 'simulation', null),
  ],
  analysis: [
    q('ana-1', 'screen', '현재 분석 결과의 주요 의미는?', 'What do the current analysis results mean?', '/analysis', 'analysis', 'performance'),
    q('ana-2', 'screen', '관련 논문 근거를 찾아줘.', 'Find related literature evidence.', '/analysis', 'analysis', null),
    q('ana-3', 'screen', '분석 결과를 해석할 때 주의할 점은?', 'What should I be careful about when interpreting the analysis?', '/analysis', 'analysis', 'performance'),
  ],
  'before-after': [
    q('ba-1', 'screen', '세정 전후 배압 변화를 설명해 줘.', 'Explain the back-pressure change before and after cleaning.', '/before-after', 'before-after', 'comparison_kpi'),
    q('ba-2', 'screen', '현재 데이터로 세정 효과를 판단할 수 있는가?', 'Can the cleaning effect be judged with the current data?', '/before-after', 'before-after', null),
    q('ba-3', 'screen', '운전 조건 차이가 비교에 어떤 영향을 주는가?', 'How do operating-condition differences affect the comparison?', '/before-after', 'before-after', null),
  ],
  // 알림 화면 (모바일): 화면 데이터 없이 문헌 근거로. 특정 알림은 알림 상세의 'AI에게 설명 요청'으로 알림 내용을 첨부
  notifications: [
    q('nt-1', 'screen', '이 경고가 발생한 이유는 무엇인가?', 'Why does this kind of warning occur?', '/notifications', 'dashboard', null),
    q('nt-2', 'screen', '어떤 데이터를 확인해야 하는가?', 'Which data should I check?', '/notifications', 'checklist', 'checklist'),
  ],
  checklist: [
    q('ck-1', 'screen', '현재 부족한 필수 데이터는?', 'Which required data is currently missing?', '/checklist', 'checklist', 'checklist'),
    q('ck-2', 'screen', '어떤 데이터를 우선 요청해야 하는가?', 'Which data should be requested first?', '/checklist', 'checklist', 'checklist'),
    q('ck-3', 'screen', '미수신 데이터 때문에 제한되는 분석은?', 'Which analyses are limited by data not yet received?', '/checklist', 'checklist', 'checklist'),
  ],
}

/** 필요한 값이 없을 때 보여 줄 안내 */
export const NEEDS_TEXT: Record<Exclude<Needs, null>, [string, string]> = {
  performance: ['현재 입력으로 계산한 결과가 없습니다. 먼저 [계산 실행] 또는 [평가 실행]을 하세요.', 'No results for the current inputs. Run the calculation first.'],
  economics: ['현재 입력으로 계산한 경제성 결과가 없습니다. 먼저 계산을 실행하세요.', 'No economics results for the current inputs. Run the calculation first.'],
  comparison_kpi: ['세정 전(D<0)과 세정 후(D≥0) 실측값이 모두 있어야 합니다. 세정 전후 비교 화면에서 실측값을 입력하세요.', 'Needs measurements both before (D<0) and after (D≥0) cleaning.'],
  checklist: ['체크리스트를 불러오지 못했습니다.', 'Could not load the checklist.'],
}
