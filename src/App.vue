<script setup lang="ts">
import { CalendarDays, Clock3, Plus } from '@lucide/vue'
import { computed, onMounted, onUnmounted, watch } from 'vue'
import CalendarView from './components/CalendarView.vue'
import CatalogView from './components/CatalogView.vue'
import ChallengesView from './components/ChallengesView.vue'
import EventEditor from './components/EventEditor.vue'
import RecordsView from './components/RecordsView.vue'
import { cloudRepository, localRepository } from './repository'
import { cloudChallengeRepository, localChallengeRepository } from './challengeRepository'
import { cloudCatalogRepository, localCatalogRepository } from './catalogRepository'
import { useCatalog } from './useCatalog'
import { useChallenges } from './useChallenges'
import { usePlanner } from './usePlanner'
import { usePlannerAuth } from './usePlannerAuth'

const { localMode, client, access, session, userId, authError, authBusy, verifyAccess, signIn, signOut } = usePlannerAuth()
const repositories = computed(() => {
  if (access.value !== 'owner') return null
  if (localMode) {
    return { planner: localRepository, catalog: localCatalogRepository, challenges: localChallengeRepository }
  }
  const id = userId.value
  if (!client || !id) return null
  return {
    planner: cloudRepository(client, id),
    catalog: cloudCatalogRepository(client, id),
    challenges: cloudChallengeRepository(client, id),
  }
})
const catalog = useCatalog(computed(() => repositories.value?.catalog ?? null))
const {
  today, selected, mode, calendarVisible, recordQuery,
  data, loading, readError, writeError, checkinsReady, pendingHabits, shownCheckins,
  editor, editorEvents, editorError, saving,
  refresh, updateToday, selectDay, openDay, navigate,
  openEditor, planSelection, closeEditor, loadEditorDate, changeEvent, changeCheckin,
} = usePlanner(computed(() => repositories.value?.planner ?? null), catalog.data)
const challengesVisible = computed(() => mode.value === 'challenges')
const challenges = useChallenges(computed(() => repositories.value?.challenges ?? null), challengesVisible)

watch(userId, closeEditor, { flush: 'sync' })

const modes = [
  { value: 'day', label: '当天' },
  { value: 'week', label: '周历' },
  { value: 'month', label: '月历' },
  { value: 'records', label: '单项记录' },
  { value: 'challenges', label: '挑战' },
  { value: 'catalog', label: '配置' },
] as const

let timer: number | undefined
let lastRefresh = 0

function onReturn() {
  if (document.visibilityState === 'hidden') return
  updateToday()
  if (Date.now() - lastRefresh < 500) return
  lastRefresh = Date.now()
  void catalog.refresh(false)
  if (challengesVisible.value) void challenges.refresh(false)
  else void refresh(false)
}

onMounted(() => {
  window.addEventListener('focus', onReturn)
  window.addEventListener('storage', onReturn)
  document.addEventListener('visibilitychange', onReturn)
  timer = window.setInterval(updateToday, 30_000)
})

onUnmounted(() => {
  window.removeEventListener('focus', onReturn)
  window.removeEventListener('storage', onReturn)
  document.removeEventListener('visibilitychange', onReturn)
  window.clearInterval(timer)
})
</script>

<template>
  <main class="planner-window" :data-mode="mode">
    <header class="planner-header">
      <div class="brand">
        <span class="brand-icon"><CalendarDays aria-hidden="true" /></span>
        <div>
          <span class="brand-caption">个人计划</span>
          <h1>我的日程</h1>
        </div>
      </div>
      <div class="header-actions">
        <span v-if="localMode" class="local-label">仅本机</span>
        <button v-if="session" class="planner-button signout-button" type="button" :disabled="authBusy" @click="signOut">
          退出
        </button>
        <button v-if="access === 'owner' && calendarVisible" class="planner-button primary" type="button" @click="openEditor()">
          <Plus aria-hidden="true" />新增活动
        </button>
      </div>
    </header>

    <template v-if="access === 'owner'">
      <nav class="planner-modes" aria-label="日程与记录视图">
        <button v-for="view in modes" :key="view.value" class="planner-button" type="button"
          :aria-pressed="view.value === mode" @click="mode = view.value">
          {{ view.label }}
        </button>
      </nav>
      <div v-if="readError && calendarVisible" class="planner-message" role="alert">
        {{ readError }} <button class="planner-button" type="button" @click="refresh()">重试</button>
      </div>
      <p v-if="writeError || authError" class="planner-message" role="alert">{{ writeError || authError }}</p>
      <p v-if="loading && calendarVisible" class="loading-message" role="status">正在读取日程…</p>
      <RecordsView v-if="mode === 'records'" :query="recordQuery" :today="today" :events="data.events"
        :checkins="shownCheckins" :loading="loading" :error="readError"
        :activities="catalog.data.value.activities" :habits="catalog.data.value.habits"
        @update="recordQuery = $event" @retry="refresh()" />
      <ChallengesView v-else-if="mode === 'challenges'" :data="challenges.data.value" :today="today"
        :loading="challenges.loading.value" :error="challenges.error.value"
        :mutation-error="challenges.mutationError.value" :busy="challenges.busy.value"
        @create="challenges.create" @remove="challenges.remove" @check="challenges.check"
        @retry="challenges.refresh()" />
      <CatalogView v-else-if="mode === 'catalog'" :catalog="catalog.data.value"
        :loading="catalog.loading.value" :error="catalog.error.value" :busy="catalog.busy.value"
        :mutation-error="catalog.mutationError.value" @save="catalog.save" @retry="catalog.refresh()" />
      <CalendarView v-else :mode="mode" :selected="selected" :today="today"
        :events="data.events" :checkins="shownCheckins" :checkins-ready="checkinsReady" :pending-habits="pendingHabits"
        :activities="catalog.data.value.activities" :habits="catalog.data.value.habits"
        @select="selectDay" @open-day="openDay" @navigate="navigate" @today="selectDay(today)"
        @edit="openEditor" @plan="planSelection" @check="changeCheckin" />
    </template>
    <section v-else class="access-panel" aria-labelledby="access-title">
      <template v-if="access === 'checking'">
        <h2 id="access-title">正在验证登录</h2>
        <p role="status">正在确认你的日程访问权限…</p>
      </template>
      <template v-else-if="access === 'login'">
        <h2 id="access-title">登录我的日程</h2>
        <p>用同一个 GitHub 账号在手机和电脑上查看日程与打卡。</p>
        <button class="planner-button primary" type="button" :disabled="authBusy" @click="signIn">
          {{ authBusy ? '正在打开登录…' : '使用 GitHub 登录' }}
        </button>
      </template>
      <template v-else-if="access === 'denied'">
        <h2 id="access-title">当前账号尚未开通</h2>
        <p>首次设置时，请按项目说明在 Supabase 中开通当前账号。</p>
        <button class="planner-button" type="button" @click="verifyAccess">重新验证</button>
      </template>
      <template v-else-if="access === 'error'">
        <h2 id="access-title">验证失败</h2>
        <button class="planner-button" type="button" @click="verifyAccess">重试</button>
      </template>
      <template v-else>
        <h2 id="access-title">需要配置 Supabase</h2>
        <p>请检查项目 URL 与 Publishable Key，并重新启动或部署应用。</p>
      </template>
      <p v-if="authError" class="access-error" role="alert">{{ authError }}</p>
    </section>
    <footer class="planner-footer"><Clock3 aria-hidden="true" />北京时间 · UTC+8</footer>
  </main>

  <EventEditor v-if="editor" :date="selected" :event="editor.event" :selection="editor.selection" :events="editorEvents ?? data.events"
    :activities="catalog.data.value.activities" :saving="saving" :error="editorError" @close="closeEditor" @save="changeEvent"
    @remove="changeEvent(null)" @date-change="loadEditorDate" />
</template>
