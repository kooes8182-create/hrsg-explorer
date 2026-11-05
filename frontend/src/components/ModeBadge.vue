<script setup>
import { computed } from 'vue'
import { currentCase } from '../store.js'
import { t } from '../i18n/index.js'

// 데모/실제 평가 여부를 모든 화면 상단에 항상 표시합니다.
// 케이스가 있으면 그 케이스의 평가 모드, 없으면 앱 전체가 데모라는 표시.
const mode = computed(() => currentCase.value?.mode || 'APP')
</script>

<template>
  <span class="mode-badge" :class="mode === 'REAL' ? 'mode-real' : 'mode-demo'" :title="t('mode.note')">
    {{ t('mode.' + mode) }}
  </span>
</template>
