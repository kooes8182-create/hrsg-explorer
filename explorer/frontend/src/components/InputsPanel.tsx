import { useState, type ReactNode } from 'react'
import type { FieldSpec } from '../api/engine'
import { useL } from '../i18n'
import { useApp } from '../store/app'
import { dirtyKeys, useCaseData, validateField } from '../store/caseData'
import Icon from './Icon'
import { InputField } from './ui'
import { ErrorState, PageSkeleton } from './feedback'

/** 입력 묶음 (설비·운전 / 열역학 / 경제성 / 세정 공법). keys 를 주면 그 항목만 보여 줍니다. */
export default function InputsPanel({ sections }: { sections: { title: string; keys?: string[]; group?: FieldSpec['group']; open?: boolean }[] }) {
  const schema = useCaseData((s) => s.schema)
  const draft = useCaseData((s) => s.draft)
  const inputs = useCaseData((s) => s.inputs)
  const runError = useCaseData((s) => s.runError)
  const setValue = useCaseData((s) => s.setValue)
  const lang = useApp((s) => s.lang)
  if (!schema || !draft) return null
  // 공법 묶음 안에서는 이름 앞의 공법명을 빼고 짧게 (예: '드라이아이스 세정 비용' → '비용')
  const shortLabel = (f: FieldSpec) => {
    const m = f.method && schema.methods.find((x) => x.key === f.method)
    if (!m) return undefined
    const name = lang === 'ko' ? m.ko : m.en
    const full = f.label[lang]
    return full.startsWith(name + ' ') ? full.slice(name.length + 1) : full
  }
  const dirty = new Set(dirtyKeys(draft, inputs))

  return (
    <div className="space-y-3">
      {sections.map((sec) => {
        const list = schema.fields.filter((f) => (sec.keys ? sec.keys.includes(f.key) : f.group === sec.group))
        const ordered = sec.keys ? sec.keys.map((k) => list.find((f) => f.key === k)!).filter(Boolean) : list
        const errorCount = ordered.filter((f) => validateField(f, draft.values[f.key])).length
        return (
          <Section key={sec.title} title={sec.title} open={sec.open ?? true} badge={errorCount > 0 ? errorCount : undefined}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ordered.map((f) => (
                <InputField
                  key={f.key}
                  f={f}
                  value={draft.values[f.key] as string | number | null}
                  onChange={(v) => setValue(f.key, v)}
                  error={validateField(f, draft.values[f.key]) ?? runError?.fields[f.key]}
                  changed={dirty.has(f.key)}
                  source={inputs?.sources[f.key]}
                  label={shortLabel(f)}
                />
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

function Section({ title, open, badge, children }: { title: string; open: boolean; badge?: number; children: ReactNode }) {
  const [isOpen, setOpen] = useState(open)
  return (
    <div className="rounded-xl border border-line">
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold">
        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} className="text-muted" />
        <span className="flex-1">{title}</span>
        {badge !== undefined && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{badge}</span>}
      </button>
      {isOpen && <div className="border-t border-line px-4 py-3">{children}</div>}
    </div>
  )
}

/** 케이스 데이터(입력값·결과)를 불러온 뒤에만 화면을 그립니다. */
export function CaseDataGate({ children }: { children: ReactNode }) {
  const L = useL()
  const status = useCaseData((s) => s.status)
  const caseId = useApp((s) => s.currentCaseId)
  const load = useCaseData((s) => s.load)
  if (status === 'error') return <ErrorState text={L('케이스 데이터를 불러오지 못했습니다.', 'Could not load case data.')} onRetry={caseId !== null ? () => load(caseId) : undefined} />
  if (status !== 'ready') return <PageSkeleton />
  return <>{children}</>
}
