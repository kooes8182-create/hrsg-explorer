import { useState } from 'react'
import { useT } from '../i18n'
import { currentCase, useApp } from '../store/app'
import { CaseFormDialog } from './CaseDialogs'
import Icon from './Icon'
import ReliabilityBadge from './ReliabilityBadge'

/** 헤더의 케이스 선택 + 새 케이스 + DEMO/사용자 입력 표시 */
export default function CaseSwitcher() {
  const t = useT()
  const cases = useApp((s) => s.cases)
  const casesStatus = useApp((s) => s.casesStatus)
  const cur = useApp(currentCase)
  const switchCase = useApp((s) => s.switchCase)
  const loadCases = useApp((s) => s.loadCases)
  const [creating, setCreating] = useState(false)

  if (casesStatus === 'error') {
    return (
      <button type="button" className="btn-ghost text-danger" onClick={loadCases}>
        <Icon name="refresh" size={14} />
        {t('case.loadFailed')} · {t('common.retry')}
      </button>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <select
          aria-label={t('case.select')}
          className="input h-9 appearance-none truncate py-0 pr-8 font-medium sm:max-w-[16rem]"
          value={cur?.id ?? ''}
          disabled={casesStatus !== 'ready' || cases.length === 0}
          onChange={(e) => switchCase(Number(e.target.value))}
        >
          {cases.length === 0 && <option value="">{casesStatus === 'ready' ? t('shell.noCase') : t('common.loading')}</option>}
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
      </div>
      <button type="button" className="btn-ghost h-9 whitespace-nowrap" onClick={() => setCreating(true)} title={t('case.new')}>
        <Icon name="plus" size={16} />
        <span className="hidden xl:inline">{t('case.new')}</span>
      </button>
      {cur && (
        <span className="hidden md:inline-flex" title={cur.is_demo ? t('mode.demoHelp') : t('mode.userHelp')}>
          <ReliabilityBadge kind={cur.is_demo ? 'DEMO' : 'USER_INPUT'} />
        </span>
      )}
      {creating && <CaseFormDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
