// 화면 테스트가 쓰는 서버 쪽 준비 (manage.py 직접 실행): 테스트 전용 임시 계정, 외부 AI 설정 읽기·쓰기.
// 설정 화면·API 는 모든 역할에 막혀 있으므로, 운영자 명령(manage.py ai_settings)으로 바꿉니다.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '../../backend')

export function manage(...args) {
  const r = spawnSync(join(BACKEND, '.venv/bin/python'), [join(BACKEND, 'manage.py'), ...args], { cwd: BACKEND, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`manage.py ${args[0]} 실패: ${r.stderr.slice(0, 300)}`)
  return r.stdout.trim()
}

/** 테스트 전용 계정 {plant, admin} 생성 (새 난수 비밀번호 — 이 프로세스 메모리에만 있음). 끝나면 deleteE2eAccounts() */
export const createE2eAccounts = () => JSON.parse(manage('e2e_accounts', '--create').split('\n').pop())
export const deleteE2eAccounts = () => manage('e2e_accounts', '--delete')
/** 이번 테스트가 만든 케이스 번호 중 이름이 'E2E' 로 시작하는 것만 서버에서 직접 삭제 (화면 정리가 실패해도 남지 않게) */
export const cleanupE2eCases = (ids) => (ids.length ? manage('e2e_accounts', `--cleanup-cases=${ids.join(',')}`) : '')

export const getSettings = () => JSON.parse(manage('ai_settings', '--json'))
export function setSettings({ ai_external_enabled, sensitive_terms } = {}) {
  const args = ['ai_settings', '--json']
  if (ai_external_enabled !== undefined) args.push('--external', ai_external_enabled ? 'on' : 'off')
  if (sensitive_terms !== undefined) args.push('--terms', JSON.stringify(sensitive_terms))
  return JSON.parse(manage(...args))
}
