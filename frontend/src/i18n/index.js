import { store } from '../store.js'
import ko from './ko.js'
import en from './en.js'

const dictionaries = { ko, en }

// t('menu.overview') → 현재 언어의 문구. 없으면 한국어, 그래도 없으면 키를 그대로 보여줍니다.
// t('common.unsaved', { n: 3 }) → '{n}' 자리에 값을 넣습니다.
export function t(key, vars) {
  const pick = (dict) => key.split('.').reduce((obj, k) => obj?.[k], dict)
  let text = pick(dictionaries[store.lang]) ?? pick(ko) ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v)
  return text
}

// 서버가 한/영 이름을 함께 주는 항목에서 현재 언어 이름을 고릅니다.
export function nameOf(obj, base = 'name') {
  return store.lang === 'en' ? obj[`${base}_en`] ?? obj.en : obj[`${base}_ko`] ?? obj.ko
}
