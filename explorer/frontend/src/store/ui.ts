import { create } from 'zustand'

// 화면 방식 선택: auto = 좁은 화면이면 모바일 화면, desktop = 휴대폰에서도 PC 화면 (브라우저에만 기억)
type Pref = 'auto' | 'desktop'
const KEY = 'hrsgx.ui'
const read = (): Pref => {
  try {
    return localStorage.getItem(KEY) === 'desktop' ? 'desktop' : 'auto'
  } catch {
    return 'auto'
  }
}

const PRESENT_KEY = 'hrsgx.present'
/** 발표 모드 (이 브라우저에만 기억). 화면 표시만 바뀌고 데이터는 그대로 */
export const readPresentation = () => {
  try {
    return localStorage.getItem(PRESENT_KEY) === '1'
  } catch {
    return false
  }
}

export const useUi = create<{ pref: Pref; setPref: (p: Pref) => void; presentation: boolean; setPresentation: (on: boolean) => void }>((set) => ({
  presentation: readPresentation(),
  setPresentation: (on) => {
    try {
      if (on) localStorage.setItem(PRESENT_KEY, '1')
      else localStorage.removeItem(PRESENT_KEY)
    } catch {
      /* 기억하지 못해도 이번에는 적용 */
    }
    window.location.reload() // 켜기·끄기 모두 새로 불러와 화면 글자를 처음부터 맞춤
  },
  pref: read(),
  setPref: (pref) => {
    try {
      localStorage.setItem(KEY, pref)
    } catch {
      /* 기억하지 못해도 이번 화면에는 적용 */
    }
    set({ pref })
  },
}))
