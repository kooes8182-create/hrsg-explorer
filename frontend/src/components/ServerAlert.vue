<script setup>
import { store, checkServer } from '../store.js'
import { t } from '../i18n/index.js'
</script>

<template>
  <!-- 서버 또는 DB 연결 실패 시 상단 안내. 앱은 멈추지 않습니다. -->
  <div v-if="store.server.state === 'offline' || store.server.state === 'db_error'"
    class="alert alert-danger rounded-0 mb-0 d-flex flex-wrap align-items-center gap-2" role="alert">
    <strong>■ {{ t('server.' + store.server.state) }}</strong>
    <span>{{ store.server.state === 'offline' ? t('server.offlineHelp') : t('server.dbHelp') }}</span>
    <button class="btn btn-sm btn-light ms-auto" @click="checkServer">{{ t('server.retry') }}</button>
  </div>
</template>
