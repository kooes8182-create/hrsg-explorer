import { create } from 'zustand'

// 짧은 알림 (저장·실패 등). 4초 뒤 사라지며, 스크린리더에는 status 로 읽힙니다.
export interface Toast {
  id: number
  tone: 'ok' | 'error' | 'info' | 'warn'
  text: string
  title?: string
  to?: string // 누르면 이동할 화면 (알림 토스트)
  key?: string // 같은 알림 토스트 중복 방지
}

interface ToastState {
  toasts: Toast[]
  push: (tone: Toast['tone'], text: string, extra?: Pick<Toast, 'title' | 'to' | 'key'>) => void
  dismiss: (id: number) => void
}

let seq = 0
export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, text, extra) => {
    if (extra?.key && get().toasts.some((t) => t.key === extra.key)) return
    const id = ++seq
    set({ toasts: [...get().toasts.slice(-2), { id, tone, text, ...extra }] })
    setTimeout(() => get().dismiss(id), extra?.to ? 7000 : 4000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (tone: Toast['tone'], text: string) => useToast.getState().push(tone, text)
