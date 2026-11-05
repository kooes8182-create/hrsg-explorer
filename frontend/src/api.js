import axios from 'axios'

// 모든 요청은 같은 출처의 /api 로 보냅니다. 개발 중에는 Vite 가 Django 로 전달합니다.
export const http = axios.create({ baseURL: '/api', timeout: 8000 })

// 서버 상태: 'ok' | 'db_error'(서버는 켜졌으나 DB 연결 실패) | 'offline'(서버 응답 없음)
export async function getHealth() {
  try {
    const res = await http.get('/health/')
    return res.data?.status === 'ok' ? 'ok' : 'db_error'
  } catch (err) {
    if (err.response?.status === 503) return 'db_error'
    return 'offline'
  }
}

// 오류를 화면에서 쓰기 쉬운 모양으로 바꿉니다.
//   kind: 'input'(400, 입력 오류) | 'notfound'(404) | 'server'(연결 실패·서버 오류)
export class ApiError extends Error {
  constructor(kind, message, data = {}) {
    super(message)
    this.kind = kind
    this.fields = data.fields || {}
    this.items = data.items || {}
  }
}

async function call(promise) {
  try {
    return (await promise).data
  } catch (err) {
    const res = err.response
    if (res?.status === 400) throw new ApiError('input', res.data?.error, res.data)
    if (res?.status === 404) throw new ApiError('notfound', res.data?.error)
    throw new ApiError('server', res?.data?.error)
  }
}

const q = (lang) => ({ params: { lang } })
// 논문 검색의 첫 요청은 서버가 임베딩 모델(약 2.3GB)을 불러오느라 1~2분 걸릴 수 있어 시간 제한을 늘립니다.
const LONG = { timeout: 180000 }

export const api = {
  listCases: () => call(http.get('/cases/')),
  createCase: (data) => call(http.post('/cases/', data)),
  updateCase: (id, data) => call(http.patch(`/cases/${id}/`, data)),
  // 실수 방지: 케이스 이름을 그대로 보내야 삭제됩니다
  deleteCase: (id, confirmName) => call(http.delete(`/cases/${id}/`, { data: { confirm_name: confirmName } })),
  overview: (id, lang) => call(http.get(`/cases/${id}/overview/`, q(lang))),
  checklist: (id) => call(http.get(`/cases/${id}/checklist/`)),
  saveChecklist: (id, items) => call(http.patch(`/cases/${id}/checklist/`, { items })),
  requestText: (id, lang) => call(http.get(`/cases/${id}/checklist/request-text/`, q(lang))),
  inputs: (id) => call(http.get(`/cases/${id}/inputs/`)),
  // 보낸 부분만 저장: { mode, scenario_id, operating_values, economics_assumptions, pinch_inputs }
  saveInputs: (id, data) => call(http.put(`/cases/${id}/inputs/`, data)),
  scenarios: () => call(http.get('/demo/scenarios/')),
  // kind: 'performance' | 'economics' | 'pinch-approach'
  evaluate: (id, kind) => call(http.post(`/cases/${id}/evaluate/${kind}/`)),
  results: (id) => call(http.get(`/cases/${id}/results/`)),
  // 공개 자료 (원문에서 확인한 값만, 기준일 표시)
  publicSmp: () => call(http.get('/public/smp/')),
  publicSources: () => call(http.get('/public/sources/')),
  // AI 질문하기 (현재 서버의 템플릿 기반 데모 답변. 답변 생성은 모두 서버에서 합니다)
  qaInfo: () => call(http.get('/qa/info/')),
  questions: (id) => call(http.get(`/cases/${id}/questions/`)),
  ask: (id, question) => call(http.post(`/cases/${id}/questions/`, { question })),
  // 논문 근거 질문 (RAG). 검색·답변 생성 모두 서버에서 하며, 답변용 문단 본문은 서버가 코퍼스에서 다시 읽습니다.
  ragInfo: () => call(http.get('/rag/info/')),
  ragSearch: (question, mode = 'hybrid') => call(http.post('/rag/search/', { question, mode }, LONG)),
  ragAnswer: (question, chunkIds) => call(http.post('/rag/answer/', { question, chunk_ids: chunkIds }, LONG)),
  // 개발용 검색 비교 { bm25_k, vector_k, rrf_k }
  ragCompare: (question, cfg) => call(http.post('/rag/compare/', { question, ...cfg }, LONG)),
  // 공식 평가셋 v1 실험 기록 (저장된 결과 파일만 읽음)
  ragExperiments: () => call(http.get('/rag/experiments/')),
}
