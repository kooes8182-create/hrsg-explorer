<script setup>
import { t } from '../i18n/index.js'

defineProps({ titleKey: String, leadKey: String })
</script>

<template>
  <h1 class="h3 mb-1">{{ t(titleKey) }}</h1>
  <p class="text-body-secondary mb-4">{{ t(leadKey) }}</p>
  <div class="card">
    <div class="card-body text-center text-body-secondary py-5">{{ t('views.soon') }}</div>
  </div>
</template>
