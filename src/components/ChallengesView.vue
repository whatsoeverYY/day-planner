<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  MAX_CHALLENGE_DAYS,
  challengeProgress,
  validateChallenge,
} from '../challenges'
import type { Challenge, ChallengeData, ChallengeDraft } from '../challenges'
import { dayCount, isDateKey, shiftDay } from '../planner'

const props = defineProps<{
  data: ChallengeData
  today: string
  loading: boolean
  error: string
  mutationError: string
  busy: boolean
}>()

const emit = defineEmits<{
  create: [draft: ChallengeDraft]
  remove: [id: string]
  check: [id: string, date: string, checked: boolean]
  retry: []
}>()

const creating = ref(false)
const title = ref('')
const targetDays = ref<number | string>(7)
const startDate = ref(props.today)
const formError = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const createButton = ref<HTMLButtonElement | null>(null)
let pendingCreate: { draft: ChallengeDraft; existing: Set<string> } | undefined
const confirming = ref<string | null>(null)
const checkDates = ref<Record<string, string>>({})

const cards = computed(() => {
  const checkinsByChallenge = new Map<string, Set<string>>()
  for (const checkin of props.data.checkins) {
    const dates = checkinsByChallenge.get(checkin.challengeId) ?? new Set<string>()
    dates.add(checkin.date)
    checkinsByChallenge.set(checkin.challengeId, dates)
  }
  return props.data.challenges.map((challenge) => {
    const dates = checkinsByChallenge.get(challenge.id) ?? new Set<string>()
    const started = challenge.startDate <= props.today
    const recentCount = started ? Math.min(7, dayCount(challenge.startDate, props.today)) : 0
    const recent = Array.from({ length: recentCount }, (_, index) => {
      const date = shiftDay(props.today, index + 1 - recentCount)
      return { date, checked: dates.has(date) }
    })
    const date = checkDates.value[challenge.id] ?? props.today
    return {
      ...challenge,
      started,
      recent,
      date,
      checked: dates.has(date),
      progress: challengeProgress(challenge, [...dates], props.today),
    }
  })
})

async function openCreate() {
  title.value = ''
  targetDays.value = 7
  startDate.value = props.today
  formError.value = ''
  creating.value = true
  await nextTick()
  titleInput.value?.focus()
}

async function closeCreate() {
  pendingCreate = undefined
  creating.value = false
  await nextTick()
  createButton.value?.focus()
}

function createChallenge() {
  if (props.busy) return
  const draft = { title: title.value.trim(), targetDays: Number(targetDays.value), startDate: startDate.value }
  formError.value = validateChallenge(draft)
  if (formError.value) return
  pendingCreate = { draft, existing: new Set(props.data.challenges.map(({ id }) => id)) }
  emit('create', draft)
}

watch(() => props.data.challenges.length, () => {
  const pending = pendingCreate
  if (!pending) return
  const { draft, existing } = pending
  if (props.data.challenges.some((item) =>
    !existing.has(item.id) &&
    item.title === draft.title && item.targetDays === draft.targetDays && item.startDate === draft.startDate,
  )) {
    void closeCreate()
  }
})

function setCheckDate(challenge: Challenge & { date: string }, event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const date = input.value
  if (!isDateKey(date) || date < challenge.startDate || date > props.today) {
    input.value = challenge.date
    return
  }
  if (date === props.today) delete checkDates.value[challenge.id]
  else checkDates.value[challenge.id] = date
}

function toggleCheck(challenge: Challenge & { date: string; checked: boolean }, event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const checked = input.checked
  input.checked = challenge.checked
  if (!props.busy) emit('check', challenge.id, challenge.date, checked)
}
</script>

<template>
  <section class="records-panel" aria-labelledby="challenge-heading">
    <header class="record-heading">
      <div>
        <h2 id="challenge-heading">挑战</h2>
        <p class="challenge-note">每天打卡，累计连续完成的天数。中断后可以重新累计。</p>
      </div>
      <button
        v-if="!creating"
        ref="createButton"
        type="button"
        class="planner-button primary"
        :disabled="busy || loading || Boolean(error)"
        @click="openCreate"
      >新建挑战</button>
    </header>

    <form v-if="creating" class="challenge-form" :aria-busy="busy" @submit.prevent="createChallenge">
      <div class="challenge-fields">
        <label class="record-field">
          <span>挑战名称</span>
          <input
            ref="titleInput"
            v-model="title"
            type="text"
            placeholder="每天阅读 20 分钟"
            :disabled="busy"
            required
          >
        </label>
        <label class="record-field">
          <span>连续目标天数</span>
          <input
            v-model.number="targetDays"
            type="number"
            min="1"
            :max="MAX_CHALLENGE_DAYS"
            step="1"
            :disabled="busy"
            required
          >
        </label>
        <label class="record-field">
          <span>开始日期</span>
          <input
            v-model="startDate"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            :disabled="busy"
            required
          >
        </label>
      </div>
      <p v-if="formError" class="challenge-error" role="alert">{{ formError }}</p>
      <div class="challenge-actions">
        <button type="button" class="planner-button" :disabled="busy" @click="closeCreate">取消</button>
        <button type="submit" class="planner-button primary" :disabled="busy">创建挑战</button>
      </div>
    </form>

    <p v-if="mutationError" class="challenge-error" role="alert">{{ mutationError }}</p>
    <p v-if="loading && !cards.length" class="challenge-note" role="status">正在读取挑战…</p>
    <div v-else-if="error" class="challenge-error">
      <p role="alert">{{ error }}</p>
      <button type="button" class="planner-button" :disabled="loading" @click="emit('retry')">重试</button>
    </div>
    <p v-else-if="!cards.length && !creating" class="challenge-empty">还没有挑战。新建挑战后，就可以开始记录。</p>

    <div v-if="cards.length" class="challenge-list">
      <article v-for="item in cards" :key="item.id" class="challenge-card" :aria-labelledby="'challenge-title-' + item.id">
        <header class="challenge-card-heading">
          <div>
            <h3 :id="'challenge-title-' + item.id">{{ item.title }}</h3>
            <p class="challenge-note"><time :datetime="item.startDate">{{ item.startDate }}</time> 开始</p>
          </div>
          <span class="challenge-status" :class="{ achieved: item.progress.complete }">
            {{ item.progress.complete ? '已达成' : item.started ? '进行中' : '待开始' }}
          </span>
        </header>

        <dl class="challenge-metrics" aria-live="polite">
          <div><dt>当前连续</dt><dd>{{ item.progress.current }} 天</dd></div>
          <div><dt>最长连续</dt><dd>{{ item.progress.longest }} 天</dd></div>
          <div><dt>目标</dt><dd>{{ item.targetDays }} 天</dd></div>
        </dl>
        <progress
          class="challenge-progress"
          :value="item.progress.complete ? item.targetDays : item.progress.current"
          :max="item.targetDays"
          :aria-label="item.title + ' 挑战进度'"
        ></progress>

        <template v-if="item.started">
          <div class="challenge-check">
            <label class="record-field">
              <span>打卡日期</span>
              <input
                type="date"
                :min="item.startDate"
                :max="today"
                :value="item.date"
                :disabled="busy"
                @change="setCheckDate(item, $event)"
              >
            </label>
            <label class="challenge-toggle">
              <input type="checkbox" :checked="item.checked" :disabled="busy" @change="toggleCheck(item, $event)">
              <span>{{ item.date === today ? '今天完成' : '当天完成' }}</span>
            </label>
          </div>

          <ul class="challenge-history" aria-label="最近 7 天打卡">
            <li v-for="day in item.recent" :key="day.date" :class="{ checked: day.checked }">
              <time :datetime="day.date">{{ day.date.slice(5).replace('-', '/') }}</time>
              <span :aria-label="day.checked ? '已完成' : '未打卡'" role="img">{{ day.checked ? '✓' : '–' }}</span>
            </li>
          </ul>
        </template>
        <p v-else class="challenge-note">到开始日期后可以打卡。</p>

        <div class="challenge-actions">
          <template v-if="confirming === item.id">
            <p class="challenge-note">删除后会一并清除挑战打卡。</p>
            <button type="button" class="planner-button" :disabled="busy" @click="confirming = null">取消</button>
            <button
              type="button"
              class="planner-button delete-button"
              :disabled="busy"
              @click="emit('remove', item.id)"
            >确认删除</button>
          </template>
          <button
            v-else
            type="button"
            class="planner-button"
            :aria-label="'删除挑战 ' + item.title"
            :disabled="busy"
            @click="confirming = item.id"
          >删除挑战</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.challenge-note,
.challenge-empty {
  color: var(--dp-sub);
  font-size: 12px;
}

.challenge-empty {
  padding-block: 12px;
}

.challenge-form,
.challenge-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--dp-line);
  border-radius: 10px;
}

.challenge-form {
  margin-bottom: 12px;
  background: var(--dp-bg);
}

.challenge-fields,
.challenge-list {
  display: grid;
  gap: 10px;
}

.challenge-fields {
  grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
}

.challenge-list {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  align-items: start;
}

.challenge-card-heading,
.challenge-actions {
  display: flex;
  gap: 8px;
}

.challenge-card-heading {
  justify-content: space-between;
  align-items: start;
}

.challenge-card-heading h3 {
  overflow-wrap: anywhere;
}

.challenge-actions {
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.challenge-actions p {
  margin-inline-end: auto;
}

.challenge-error {
  margin-block: 8px;
  color: var(--dp-danger);
}

.challenge-error button {
  margin-block-start: 6px;
}

.challenge-status {
  flex: none;
  padding: 3px 8px;
  border-radius: 99px;
  background: var(--dp-bg);
  color: var(--dp-sub);
  font-size: 12px;
}

.challenge-status.achieved {
  color: var(--dp-accent);
  background: var(--dp-select);
}

.challenge-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.challenge-metrics dt {
  color: var(--dp-sub);
  font-size: 12px;
}

.challenge-metrics dd {
  margin: 0;
  font-weight: 620;
}

.challenge-progress {
  width: 100%;
  height: 8px;
  accent-color: var(--dp-accent);
}

.challenge-check {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.challenge-check .record-field {
  flex: 1 1 120px;
}

.challenge-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  cursor: pointer;
}

.challenge-toggle input {
  margin: 0;
  accent-color: var(--dp-accent);
}

.challenge-history {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.challenge-history li {
  display: grid;
  justify-items: center;
  border-radius: 5px;
  padding-block: 4px;
  background: var(--dp-bg);
  color: var(--dp-sub);
  font-size: 11px;
}

.challenge-history li.checked {
  background: var(--dp-select);
  color: var(--dp-accent);
}

@media (max-width: 540px) {
  .challenge-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .challenge-fields label:first-child {
    grid-column: 1 / -1;
  }
}

@media (pointer: coarse) {
  .challenge-toggle {
    min-height: 44px;
  }
}
</style>
