import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../i18n'
import Icon from './Icon'

/** 간단한 대화상자: Esc·바깥 클릭으로 닫힘, 열릴 때 첫 입력칸에 포커스, 닫히면 원래 위치로 포커스 복귀. */
export default function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  // onClose 는 렌더마다 새 함수일 수 있으므로 ref 로 보관 (포커스 설정은 열릴 때 한 번만)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('input, textarea, button[data-autofocus]')
    first?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card w-full shadow-pop ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
