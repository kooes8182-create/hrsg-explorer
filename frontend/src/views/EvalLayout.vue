<script setup>
import { provideEvaluation } from '../composables/useEvaluation.js'
import { t } from '../i18n/index.js'
import CaseGate from '../components/CaseGate.vue'

// 시뮬레이션·분석 공통 틀: 평가 상태(입력·결과)를 한 번 만들어 두 화면이 함께 씁니다.
// 화면은 입력을 저장하고 서버 계산 결과를 그리기만 합니다. 계산·판정은 모두 서버(backend/calculators)에서 합니다.
const ev = provideEvaluation()
</script>

<template>
  <CaseGate>
    <div v-if="ev.loadError.value" class="alert alert-danger d-flex align-items-center gap-2">
      <span>{{ t('common.loadFailed') }} {{ t('views.home.loadHelp') }}</span>
      <button class="btn btn-sm btn-light ms-auto" @click="ev.load">{{ t('server.retry') }}</button>
    </div>
    <div v-else-if="!ev.shown.value" class="text-body-secondary py-3">
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ t('common.loading') }}
    </div>
    <RouterView v-else />
  </CaseGate>
</template>
