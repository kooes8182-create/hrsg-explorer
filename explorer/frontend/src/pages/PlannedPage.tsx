import type { PageDef } from '../app/routes'
import Icon from '../components/Icon'
import { useT } from '../i18n'
import { useApp } from '../store/app'

/** 아직 구현하지 않은 화면. 가짜 카드·수치를 두지 않고, 어느 Phase 에서 무엇을 만들지 그대로 보여 줍니다. */
export default function PlannedPage({ page }: { page: PageDef }) {
  const t = useT()
  const lang = useApp((s) => s.lang)
  return (
    <section className="card mx-auto max-w-3xl p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
          <Icon name={page.icon} size={22} />
        </span>
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted">
            <Icon name="clock" size={12} />
            {t('planned.badge', { n: page.phase })}
          </span>
          <h2 className="mt-2 text-lg font-bold">{t('planned.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('planned.body', { n: page.phase })}</p>
        </div>
      </div>
      {page.planned && (
        <div className="mt-6 border-t border-line pt-5">
          <div className="eyebrow">{t('planned.list')}</div>
          <ul className="mt-3 space-y-2">
            {page.planned.map((item) => (
              <li key={item.en} className="flex gap-2 text-sm">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-faint" aria-hidden="true" />
                <span>{item[lang]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
