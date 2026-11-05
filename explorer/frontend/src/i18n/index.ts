import { useCallback } from 'react'
import { useApp } from '../store/app'
import ko from './ko'
import en from './en'

const dicts = { ko, en }

function lookup(dict: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict)
  return typeof v === 'string' ? v : undefined
}

/** 화면 전용 문장: 한국어·영어를 나란히 적는 짧은 형태 — L('평가 실행', 'Run evaluation'). 공통 용어는 t() 사전을 씁니다. */
export function useL() {
  const lang = useApp((s) => s.lang)
  return useCallback((ko: string, en: string) => (lang === 'ko' ? ko : en), [lang])
}

/** t('case.deleteConfirm', { name }) — 사전에 없는 키는 키 자체를 보여 줘서 빠진 번역을 바로 알 수 있게 합니다. */
export function useT() {
  const lang = useApp((s) => s.lang)
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const text = lookup(dicts[lang], key) ?? lookup(dicts.ko, key) ?? key
      return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text
    },
    [lang],
  )
}
