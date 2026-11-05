import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import type { Case } from '../api/types'
import { useT } from '../i18n'
import { useApp } from '../store/app'
import Modal from './Modal'

/** 케이스 만들기·수정 (case 를 주면 수정) */
export function CaseFormDialog({ edit, onClose }: { edit?: Case; onClose: () => void }) {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const createCase = useApp((s) => s.createCase)
  const updateCase = useApp((s) => s.updateCase)
  const [name, setName] = useState(edit?.name ?? '')
  const [memo, setMemo] = useState(edit?.memo ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ form?: string; name?: string }>({})

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError({ name: t('common.required') })
      return
    }
    setBusy(true)
    setError({})
    try {
      if (edit) await updateCase(edit.id, { name, memo })
      else await createCase(name, memo)
      onClose()
    } catch (err) {
      const ae = err instanceof ApiError ? err : null
      const nf = ae?.fields.name
      setError({ form: ae ? ae.text[lang] : String(err), name: Array.isArray(nf) ? nf[0] : nf?.[lang] })
      setBusy(false)
    }
  }

  return (
    <Modal title={edit ? t('case.edit') : t('case.create')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="case-name">
            {t('case.name')} <span className="text-danger">*</span>
          </label>
          <input
            id="case-name"
            className="input"
            maxLength={100}
            value={name}
            placeholder={t('case.namePlaceholder')}
            aria-invalid={!!error.name}
            aria-describedby={error.name ? 'case-name-err' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {error.name && (
            <p id="case-name-err" className="mt-1 text-xs text-danger">
              {error.name}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="case-memo">
            {t('case.memo')}
          </label>
          <textarea id="case-memo" className="input min-h-[80px]" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
        {error.form && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error.form}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function DeleteCaseDialog({ target, onClose }: { target: Case; onClose: () => void }) {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const deleteCase = useApp((s) => s.deleteCase)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    try {
      await deleteCase(target.id)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.text[lang] : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('case.deleteTitle')} onClose={onClose}>
      <p className="text-sm text-muted">{t('case.deleteConfirm', { name: target.name })}</p>
      {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} data-autofocus>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn-danger" onClick={confirm} disabled={busy}>
          {t('case.delete')}
        </button>
      </div>
    </Modal>
  )
}
