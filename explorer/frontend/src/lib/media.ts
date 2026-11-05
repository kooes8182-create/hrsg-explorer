import { useEffect, useState } from 'react'
import { useUi } from '../store/ui'

/** CSS 미디어 쿼리 결과 (화면 폭 등) */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

/** 휴대폰 접속용 서버(npm run dev:mobile, 5175)로 연 화면인지. PC 주소(5174)·일반 빌드에서는 false → 항상 PC 화면 */
export const MOBILE_SERVER = import.meta.env.VITE_MOBILE_UI === '1'

/** 모바일 화면을 쓸지: 휴대폰 접속용 서버 + 폭 767px 이하 + 사용자가 'PC 화면 보기'를 고르지 않았을 때 */
export function useMobileUI() {
  const narrow = useMedia('(max-width: 767px)')
  const pref = useUi((s) => s.pref)
  return MOBILE_SERVER && narrow && pref === 'auto'
}

/** 휴대폰 화면 키보드가 열렸는지 (보이는 영역이 크게 줄면 열린 것으로 봄) — 하단 메뉴를 잠시 숨겨 입력창을 가리지 않게 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => setOpen(window.innerHeight - vv.height > 150)
    vv.addEventListener('resize', on)
    return () => vv.removeEventListener('resize', on)
  }, [])
  return open
}

/** 브라우저가 알려 주는 네트워크 연결 여부 */
export function useOnline() {
  const [on, setOn] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

/** 화면 키보드가 아래를 가리는 높이(px). iOS Safari 는 키보드가 열려도 화면 크기가 그대로라, 고정된 입력창을 이만큼 올려야 보입니다. */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
    }
  }, [])
  return inset
}
