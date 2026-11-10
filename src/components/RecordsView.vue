<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ACTIVITY_NAMES, HABIT_NAMES, clock, dayCount, dayLabel, durationLabel, isDateKey, shiftDay, weekday,
} from '../planner'
import type { Checkin, PlannerEvent, RecordQuery } from '../planner'

const props = defineProps<{
  query: RecordQuery
  today: string
  events: PlannerEvent[]
  checkins: Checkin[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  update: [query: RecordQuery]
  retry: []
}>()

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const pageSize = 7
const limit = ref(pageSize)

const rangeError = computed(() => {
  if (!isDateKey(props.query.start) || !isDateKey(props.query.end)) return '请选择有效的起止日期。'
  if (props.query.end < props.query.start) return '结束日期须等于或晚于开始日期。'
  return ''
})
const isActivity = computed(() => props.query.item in ACTIVITY_NAMES)
const countedEnd = computed(() => props.query.end < props.today ? props.query.end : props.today)
const matchingEvents = computed(() => props.events.filter((item) =>
  item.activity === props.query.item && item.date >= props.query.start && item.date <= props.query.end,
).sort((left, right) => right.date.localeCompare(left.date) || left.start - right.start || left.id.localeCompare(right.id)))
const totalDuration = computed(() => matchingEvents.value.reduce((total, item) => total + item.end - item.start, 0))
const checkedDates = computed(() => new Set(props.checkins.filter((item) =>
  item.habit === props.query.item && item.date >= props.query.start && item.date <= countedEnd.value,
).map((item) => item.date)))
const countedDays = computed(() => !rangeError.value && props.query.start <= countedEnd.value
  ? dayCount(props.query.start, countedEnd.value)
  : 0)
const visibleDates = computed(() => Array.from({ length: Math.min(countedDays.value, limit.value) }, (_, index) =>
  shiftDay(countedEnd.value, -index),
))
const totalRows = computed(() => isActivity.value ? matchingEvents.value.length : countedDays.value)

watch(() => [props.query.item, props.query.start, props.query.end], () => {
  limit.value = pageSize
})

function setPreset(days: number) {
  emit('update', { ...props.query, start: shiftDay(props.today, 1 - days), end: props.today })
}

function setItem(event: Event) {
  const item = (event.target as HTMLSelectElement).value as RecordQuery['item']
  emit('update', { ...props.query, item })
}

function setDate(field: 'start' | 'end', event: Event) {
  emit('update', { ...props.query, [field]: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <section class="records-panel" aria-labelledby="record-heading">
    <header class="record-heading">
      <h2 id="record-heading">单项记录</h2>
      <div class="record-presets" role="group" aria-label="快捷日期范围">
        <button
          v-for="days in [7, 30]"
          :key="days"
          class="planner-button"
          type="button"
          :aria-pressed="query.start === shiftDay(today, 1 - days) && query.end === today"
          @click="setPreset(days)"
        >近 {{ days }} 天</button>
      </div>
    </header>
    <div class="record-controls">
      <label class="record-field">
        <span>查看项目</span>
        <select :value="query.item" @change="setItem">
          <optgroup label="活动">
            <option v-for="(label, key) in ACTIVITY_NAMES" :key="key" :value="key">{{ label }}</option>
          </optgroup>
          <optgroup label="每日打卡">
            <option v-for="(label, key) in HABIT_NAMES" :key="key" :value="key">{{ label }}</option>
          </optgroup>
        </select>
      </label>
      <label class="record-field">
        <span>开始日期</span>
        <input type="date" min="0001-01-01" max="9999-12-31" :value="query.start" @change="setDate('start', $event)">
      </label>
      <label class="record-field">
        <span>结束日期</span>
        <input type="date" min="0001-01-01" max="9999-12-31" :value="query.end" @change="setDate('end', $event)">
      </label>
    </div>
    <p v-if="rangeError" class="record-error" role="alert">{{ rangeError }}</p>
    <p v-else-if="loading" class="record-loading" role="status">正在读取记录…</p>
    <div v-else-if="error" class="record-error">
      <p role="alert">{{ error }}</p>
      <button class="planner-button record-more" type="button" @click="emit('retry')">重试</button>
    </div>
    <div v-else class="record-results">
      <div class="record-summary" aria-live="polite">
        <template v-if="isActivity">
          <div class="record-metric"><span>已安排</span><strong>{{ matchingEvents.length }} 次</strong></div>
          <div class="record-metric"><span>安排总时长</span><strong>{{ durationLabel(totalDuration) }}</strong></div>
        </template>
        <template v-else>
          <div class="record-metric"><span>已打卡</span><strong>{{ checkedDates.size }} 天</strong></div>
          <div class="record-metric"><span>可打卡天数</span><strong>{{ countedDays }} 天</strong></div>
        </template>
      </div>
      <h3>{{ isActivity ? '安排明细' : '逐日打卡' }}</h3>
      <ol v-if="isActivity && totalRows" class="record-list">
        <li v-for="item in matchingEvents.slice(0, limit)" :key="item.id">
          <span class="record-row-day">
            <time :datetime="item.date">{{ dayLabel(item.date) }}</time>
            <span class="record-note">周{{ weekdays[weekday(item.date)] }}</span>
          </span>
          <span class="record-row-detail">
            <span>{{ clock(item.start) }}–{{ clock(item.end) }}</span>
            <span v-if="item.workException" class="record-note">工作时段例外</span>
          </span>
        </li>
      </ol>
      <ol v-else-if="totalRows" class="record-list">
        <li v-for="day in visibleDates" :key="day">
          <span class="record-row-day">
            <time :datetime="day">{{ dayLabel(day) }}</time>
            <span class="record-note">周{{ weekdays[weekday(day)] }}</span>
          </span>
          <span class="record-note" :data-done="checkedDates.has(day)">{{ checkedDates.has(day) ? '已打卡' : '未打卡' }}</span>
        </li>
      </ol>
      <p v-else class="record-empty">
        {{ isActivity ? '这段时间还没有该活动的安排。' : '这段时间内还没有到可以打卡的日期。' }}
      </p>
      <button v-if="totalRows > limit" class="planner-button record-more" type="button" @click="limit += pageSize">
        查看更多（还有 {{ totalRows - limit }} 条）
      </button>
    </div>
  </section>
</template>

<style scoped>
.record-loading {
  margin-top: 10px;
  color: var(--dp-sub);
  font-size: 12px;
}
</style>
