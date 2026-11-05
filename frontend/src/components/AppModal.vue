<script setup>
import { t } from '../i18n/index.js'

defineProps({ title: String, size: { type: String, default: '' } })
defineEmits(['close'])
</script>

<template>
  <!-- Vue 로 열고 닫는 단순 모달 (Bootstrap 모양만 사용) -->
  <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" @keydown.esc="$emit('close')">
    <div class="modal-dialog modal-dialog-scrollable" :class="size">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5">{{ title }}</h2>
          <button type="button" class="btn-close" :aria-label="t('common.close')" @click="$emit('close')"></button>
        </div>
        <div class="modal-body"><slot /></div>
        <div v-if="$slots.footer" class="modal-footer"><slot name="footer" /></div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop show" @click="$emit('close')"></div>
</template>
