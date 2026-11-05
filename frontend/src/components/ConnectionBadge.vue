<script setup>
import { computed } from 'vue'
import { store } from '../store.js'
import { t } from '../i18n/index.js'

// 상태는 색상 + 기호 + 글자로 함께 표시합니다.
const look = computed(() => ({
  checking: { cls: 'text-bg-secondary', mark: '…' },
  ok: { cls: 'text-bg-success', mark: '●' },
  db_error: { cls: 'text-bg-warning', mark: '▲' },
  offline: { cls: 'text-bg-danger', mark: '■' },
})[store.server.state])
</script>

<template>
  <span class="conn-badge" :class="'conn-' + store.server.state" role="status">
    <span class="conn-dot" aria-hidden="true">{{ look.mark }}</span><span class="conn-text">{{ t('server.' + store.server.state) }}</span>
  </span>
</template>
