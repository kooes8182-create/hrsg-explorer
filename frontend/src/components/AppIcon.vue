<script setup>
// 메뉴·버튼용 선 아이콘 (24×24, currentColor). 외부 아이콘 패키지 없이 필요한 것만 둡니다.
defineProps({ name: { type: String, required: true }, size: { type: [Number, String], default: 18 } })
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  data: 'M4 5h16M4 5v14h16V5M8 9h8M8 13h8M8 17h5',
  simulate: 'M4 18h4l3-12 3 12 3-6h3',
  analysis: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  ask: 'M5 5h14v10H9l-4 4V5zM9 9h6M9 12h4',
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9',
  play: 'M7 5v14l12-7z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  alert: 'M12 4 2.5 20h19L12 4zM12 10v4M12 17v.5',
  check: 'M5 12.5 10 17 19 7',
  chevron: 'M9 6l6 6-6 6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
}
</script>

<template>
  <svg class="app-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="PATHS[name]" />
  </svg>
</template>
