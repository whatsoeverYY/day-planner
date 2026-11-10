<script setup lang="ts">
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { CalendarDays, Clock3, Plus } from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import CalendarView from './components/CalendarView.vue'
import EventEditor from './components/EventEditor.vue'
import RecordsView from './components/RecordsView.vue'
import {
  isDateKey, monthDays, shiftDay, shiftMonth, todayInBeijing, validateEvent, weekDays,
  type DateRange, type EventDraft, type Habit, type PlannerData, type PlannerEvent,
  type PlannerMode, type RecordQuery,
} from './planner'
import { cloudRepository, localRepository } from './repository'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
const localMode = !url && !key
let client: SupabaseClient | null = null
if (url && key) {
  try {
    client = createClient(url, key, { auth: { flowType: 'pkce' } })
  } catch {
    // A malformed environment is shown in the setup state below.
  }
}

type Access = 'checking' | 'login' | 'owner' | 'denied' | 'error' | 'config'
const access = ref<Access>(localMode ? 'owner' : client ? 'checking' : 'config')
const session = shallowRef<Session | null>(null)
const authError = ref('')
const authBusy = ref(false)
const userId = computed(() => session.value?.user.id)
const repository = computed(() => {
  if (access.value !== 'owner') return null
  if (localMode) return localRepository
  return client && userId.value ? cloudRepository(client, userId.value) : null
})
let accessRequest = 0
let unsubscribe: (() => void) | undefined
let active = false

async function verifyAccess() {
  if (!client || !session.value) return
  const request = ++accessRequest
  access.value = 'checking'
  authError.value = ''
  try {
    const { data, error } = await client.rpc('planner_has_access')
    if (error) throw error
    if (request === accessRequest) access.value = data === true ? 'owner' : 'denied'
  } catch {
    if (request !== accessRequest) return
    access.value = 'error'
    authError.value = '无法验证日程访问权限。请检查网络或 Supabase 配置。'
  }
}

function receiveSession(next: Session | null) {
  const changedUser = session.value?.user.id !== next?.user.id
  session.value = next
  if (!next) {
    accessRequest++
    access.value = 'login'
    editor.value = null
  } else if (changedUser) {
    editor.value = null
    void verifyAccess()
  }
}

async function signIn() {
  if (!client || authBusy.value) return
  authBusy.value = true
  authError.value = ''
  try {
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.href).href
    const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo } })
    if (error) throw error
  } catch {
    authError.value = '无法打开 GitHub 登录，请稍后重试。'
  } finally {
    authBusy.value = false
  }
}

async function signOut() {
  if (!client || authBusy.value) return
  authBusy.value = true
  authError.value = ''
  try {
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw error
    receiveSession(null)
  } catch {
    authError.value = '退出登录失败，请重试。'
  } finally {
    authBusy.value = false
  }
}

const today = ref(todayInBeijing())
const selected = ref(today.value)
const mode = ref<PlannerMode>('week')
const modes = [
  { value: 'day', label: '当天' },
  { value: 'week', label: '周历' },
  { value: 'month', label: '月历' },
  { value: 'records', label: '单项记录' },
] as const
const recordQuery = ref<RecordQuery>({ item: 'practice', start: shiftDay(today.value, -6), end: today.value })
const calendarRange = computed<DateRange>(() => {
  const days = mode.value === 'month' ? monthDays(selected.value) : weekDays(selected.value)
  return { start: days[0], end: days[days.length - 1] }
})
const range = computed(() => mode.value === 'records' ? recordQuery.value : calendarRange.value)
const rangeKey = computed(() => JSON.stringify(range.value))
const data = ref<PlannerData>({ events: [], checkins: [] })
const loading = ref(false)
const readError = ref('')
const writeError = ref('')
let readRequest = 0

async function refresh(showLoading = true) {
  const request = ++readRequest
  const source = repository.value
  const query = range.value
  readError.value = ''
  if (source && showLoading) loading.value = true
  if (!source || !isDateKey(query.start) || !isDateKey(query.end) || query.start > query.end) {
    loading.value = false
    return
  }
  try {
    const result = await source.read(query)
    if (request === readRequest) data.value = result
  } catch {
    if (request === readRequest) readError.value = '读取日程失败。请检查网络后重试。'
  } finally {
    if (request === readRequest) loading.value = false
  }
}

watch([repository, rangeKey], () => {
  data.value = { events: [], checkins: [] }
  writeError.value = ''
  void refresh()
}, { immediate: true })

function selectDay(date: string) {
  if (isDateKey(date)) selected.value = date
}

function openDay(date: string) {
  selectDay(date)
  mode.value = 'day'
}

function navigate(offset: number) {
  const next = mode.value === 'month'
    ? shiftMonth(selected.value, offset)
    : shiftDay(selected.value, offset * (mode.value === 'week' ? 7 : 1))
  selectDay(next)
}

const editor = shallowRef<{ id: string; event: PlannerEvent | null } | null>(null)
const editorEvents = shallowRef<PlannerEvent[] | null>(null)
const editorError = ref('')
const saving = ref(false)
let editorRequest = 0

function openEditor(event: PlannerEvent | null = null) {
  editorEvents.value = null
  editorError.value = ''
  editor.value = { id: event?.id ?? crypto.randomUUID(), event }
}

function closeEditor() {
  editorRequest++
  editor.value = null
}

async function loadEditorDate(date: string) {
  const request = ++editorRequest
  editorEvents.value = null
  const source = repository.value
  if (!source || !isDateKey(date) || (date >= calendarRange.value.start && date <= calendarRange.value.end)) return
  try {
    const result = await source.read({ start: date, end: date })
    if (request === editorRequest) editorEvents.value = result.events
  } catch {
    // Work-hour validation still applies when other events cannot be loaded.
  }
}

async function changeEvent(draft: EventDraft | null) {
  const source = repository.value
  const currentEditor = editor.value
  if (!source || !currentEditor || saving.value) return
  editorError.value = draft ? validateEvent(draft) : ''
  if (editorError.value) return
  saving.value = true
  try {
    if (draft) {
      const event = { ...draft, id: currentEditor.id }
      await source.saveEvent(event, Boolean(currentEditor.event))
      if (source !== repository.value) return
      data.value.events = data.value.events.filter((row) => row.id !== event.id).concat(event)
      selectDay(event.date)
    } else {
      await source.deleteEvent(currentEditor.id)
      if (source !== repository.value) return
      data.value.events = data.value.events.filter((row) => row.id !== currentEditor.id)
    }
    closeEditor()
    void refresh(false)
  } catch (error) {
    if (source !== repository.value) return
    editorError.value = error instanceof Error && error.message.startsWith('这条活动')
      ? error.message
      : draft ? '保存活动失败，请重试。' : '删除活动失败，请重试。'
  } finally {
    saving.value = false
  }
}

const pendingChecks = ref(new Map<string, { date: string; habit: Habit; checked: boolean; token: symbol }>())
const pendingHabits = computed(() =>
  [...pendingChecks.value.values()].filter(({ date }) => date === selected.value).map(({ habit }) => habit),
)
const shownCheckins = computed(() => {
  const items = data.value.checkins.filter((row) => !pendingChecks.value.has(row.date + ':' + row.habit))
  for (const { date, habit, checked } of pendingChecks.value.values()) {
    if (checked) items.push({ date, habit })
  }
  return items
})

async function changeCheckin(habit: Habit, checked: boolean) {
  const source = repository.value
  const date = selected.value
  const pendingKey = date + ':' + habit
  if (!source || date > today.value || pendingChecks.value.has(pendingKey)) return
  writeError.value = ''
  const update = { date, habit, checked, token: Symbol() }
  pendingChecks.value.set(pendingKey, update)
  try {
    await source.setCheckin(date, habit, checked)
    if (source !== repository.value) return
    data.value.checkins = data.value.checkins.filter((row) => row.date !== date || row.habit !== habit)
    if (checked) data.value.checkins.push({ date, habit })
    void refresh(false)
  } catch {
    if (source === repository.value) writeError.value = '打卡保存失败，请重试。'
  } finally {
    if (pendingChecks.value.get(pendingKey)?.token === update.token) pendingChecks.value.delete(pendingKey)
  }
}

watch(repository, () => pendingChecks.value.clear())

let timer: number | undefined
let lastRefresh = 0
function updateToday() {
  today.value = todayInBeijing()
}
function onReturn() {
  if (document.visibilityState === 'hidden') return
  updateToday()
  if (Date.now() - lastRefresh < 500) return
  lastRefresh = Date.now()
  void refresh(false)
}

onMounted(() => {
  active = true
  if (client) {
    const { data: auth } = client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => { if (active) receiveSession(nextSession) }, 0)
    })
    unsubscribe = () => auth.subscription.unsubscribe()
  }
  window.addEventListener('focus', onReturn)
  window.addEventListener('storage', onReturn)
  document.addEventListener('visibilitychange', onReturn)
  timer = window.setInterval(updateToday, 30_000)
})

onUnmounted(() => {
  active = false
  accessRequest++
  unsubscribe?.()
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
        <button v-if="access === 'owner' && mode !== 'records'" class="planner-button primary" type="button" @click="openEditor()">
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
      <div v-if="readError && mode !== 'records'" class="planner-message" role="alert">
        {{ readError }} <button class="planner-button" type="button" @click="refresh()">重试</button>
      </div>
      <p v-if="writeError || authError" class="planner-message" role="alert">{{ writeError || authError }}</p>
      <p v-if="loading && mode !== 'records'" class="loading-message" role="status">正在读取日程…</p>
      <RecordsView v-if="mode === 'records'" :query="recordQuery" :today="today" :events="data.events"
        :checkins="shownCheckins" :loading="loading" :error="readError"
        @update="recordQuery = $event" @retry="refresh()" />
      <CalendarView v-else :mode="mode" :selected="selected" :today="today"
        :events="data.events" :checkins="shownCheckins" :pending-habits="pendingHabits"
        @select="selectDay" @open-day="openDay" @navigate="navigate" @today="selectDay(today)"
        @edit="openEditor" @check="changeCheckin" />
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
        <p>首次设置时，请按项目说明在 Supabase 中登记以下用户 ID。</p>
        <code>{{ userId }}</code>
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

  <EventEditor v-if="editor" :date="selected" :event="editor.event" :events="editorEvents ?? data.events"
    :saving="saving" :error="editorError" @close="closeEditor" @save="changeEvent"
    @remove="changeEvent(null)" @date-change="loadEditorDate" />
</template>
