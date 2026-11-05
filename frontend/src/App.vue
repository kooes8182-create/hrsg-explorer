<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { menuGroups } from './router.js'
import { store, setLang, toggleTheme, checkServer, loadCases } from './store.js'
import { t } from './i18n/index.js'
import ServerAlert from './components/ServerAlert.vue'
import ModeBadge from './components/ModeBadge.vue'
import ConnectionBadge from './components/ConnectionBadge.vue'
import CaseSelector from './components/CaseSelector.vue'
import AppIcon from './components/AppIcon.vue'

const route = useRoute()
let timer = null
onMounted(() => {
  checkServer()
  loadCases()
  timer = setInterval(checkServer, 30000) // 30초마다 서버 상태 확인
})
onBeforeUnmount(() => clearInterval(timer))

// 서버가 다시 연결되면 케이스 목록을 다시 불러옵니다.
watch(() => store.server.state, (s) => {
  if (s === 'ok' && !store.casesLoaded) loadCases()
})

// 작은 화면 메뉴: 링크에 data-bs-dismiss 를 달면 Bootstrap 이 클릭을 막아 이동하지 않으므로, 화면이 바뀔 때 직접 닫습니다.
watch(() => route.fullPath, () => {
  const el = document.getElementById('sideMenu')
  if (el?.classList.contains('show')) el.querySelector('.btn-close')?.click() // 닫기 버튼은 Bootstrap 이 정상 처리
})

// 현재 위치: 메뉴 항목·묶음 (경로 앞부분으로 판단)
const isActive = (m) => route.path === m.match || route.path.startsWith(m.match + '/')
const current = computed(() => {
  for (const g of menuGroups) for (const m of g.items) if (isActive(m)) return { group: g.key, item: m }
  return null
})
// 평가 케이스와 무관한 화면(검색 성능 실험)에서는 케이스 선택을 감춥니다.
const caseScoped = computed(() => !route.path.startsWith('/lab'))
</script>

<template>
  <a class="skip-link" href="#main">{{ t('shell.skip') }}</a>
  <div class="app-shell d-flex">
    <!-- 데스크톱: 왼쪽 고정 메뉴 -->
    <aside class="sidebar d-none d-lg-flex flex-column">
      <RouterLink to="/home" class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 15h4l2-6 3 10 2-7 2 3h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </span>
        <span>
          <span class="brand-title">{{ t('app.title') }}</span>
          <span class="brand-sub">{{ t('app.subtitle') }}</span>
        </span>
      </RouterLink>
      <nav :aria-label="t('shell.nav')" class="side-nav">
        <div v-for="g in menuGroups" :key="g.key" class="side-group">
          <div class="side-group-label">{{ t('menu.group.' + g.key) }}</div>
          <RouterLink v-for="m in g.items" :key="m.path" :to="m.path" class="side-link"
            :class="{ active: isActive(m) }" :aria-current="isActive(m) ? 'page' : undefined">
            <AppIcon :name="m.icon" />{{ t(m.labelKey) }}
          </RouterLink>
        </div>
      </nav>
      <div class="side-foot">{{ t('mode.note') }}</div>
    </aside>

    <!-- 작은 화면: 접히는 메뉴 -->
    <div id="sideMenu" class="offcanvas offcanvas-start" tabindex="-1" aria-labelledby="sideMenuLabel">
      <div class="offcanvas-header">
        <div id="sideMenuLabel" class="brand-title">{{ t('app.title') }}</div>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" :aria-label="t('common.close')"></button>
      </div>
      <nav class="offcanvas-body side-nav" :aria-label="t('shell.nav')">
        <div v-for="g in menuGroups" :key="g.key" class="side-group">
          <div class="side-group-label">{{ t('menu.group.' + g.key) }}</div>
          <RouterLink v-for="m in g.items" :key="m.path" :to="m.path" class="side-link"
            :class="{ active: isActive(m) }" :aria-current="isActive(m) ? 'page' : undefined">
            <AppIcon :name="m.icon" />{{ t(m.labelKey) }}
          </RouterLink>
        </div>
      </nav>
    </div>

    <div class="flex-grow-1 main-col">
      <header class="topbar">
        <button class="btn btn-icon d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#sideMenu"
          :aria-label="t('menu.open')"><AppIcon name="menu" :size="20" /></button>
        <nav v-if="current" class="crumbs" :aria-label="t('shell.where')">
          <span class="crumb-group d-none d-md-inline">{{ t('menu.group.' + current.group) }}</span>
          <AppIcon name="chevron" :size="14" class="crumb-sep d-none d-md-inline" />
          <span class="crumb-page">{{ t(current.item.labelKey) }}</span>
        </nav>
        <div v-if="caseScoped" class="topbar-case">
          <CaseSelector />
          <ModeBadge />
        </div>
        <div class="topbar-tools">
          <ConnectionBadge />
          <div class="seg seg-sm" role="group" :aria-label="t('lang.toggle')">
            <button type="button" :class="{ on: store.lang === 'ko' }" :aria-pressed="store.lang === 'ko'" @click="setLang('ko')">KO</button>
            <button type="button" :class="{ on: store.lang === 'en' }" :aria-pressed="store.lang === 'en'" @click="setLang('en')">EN</button>
          </div>
          <button class="btn btn-icon" type="button" :aria-label="t('theme.toggle')" :title="t('theme.toggle')" @click="toggleTheme">
            <AppIcon :name="store.theme === 'dark' ? 'moon' : 'sun'" :size="18" />
          </button>
        </div>
      </header>

      <ServerAlert />

      <main id="main" class="main-area" tabindex="-1">
        <RouterView v-slot="{ Component, route: r }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="r.matched[0]?.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
