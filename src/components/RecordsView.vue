<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ActivityDefinition, HabitDefinition } from '../catalog'
import {
  WEEKDAYS, clock, dayCount, dayLabel, durationLabel, isDateKey, shiftDay, weekday,
} from '../planner'
import type { Checkin, PlannerEvent, RecordQuery } from '../planner'

const props = defineProps<{
  query: RecordQuery
  today: string
  activities: ActivityDefinition[]
  habits: HabitDefinition[]
  events: PlannerEvent[]
  checkins: Checkin[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  update: [query: RecordQuery]
  retry: []
}>()

const calendarWeekdays = [...WEEKDAYS.slice(1), WEEKDAYS[0]]
const activityPageSize = 7
const activityLimit = ref(activityPageSize)
const checkinPageSize = 31
const checkinPage = ref(0)

const rangeError = computed(() => {
  if (!isDateKey(props.query.start) || !isDateKey(props.query.end)) return '请选择有效的起止日期。'
  if (props.query.end < props.query.start) return '结束日期须等于或晚于开始日期。'
  return ''
})
const isActivity = computed(() => props.query.kind === 'activity')
const selectedValue = computed(() => itemValue(props.query.kind, props.query.item))
const selectedItem = computed(() => (isActivity.value ? props.activities : props.habits)
  .find(({ id }) => id === props.query.item))
const countedStart = computed(() => {
  const startsOn = isActivity.value ? undefined : props.habits.find(({ id }) => id === props.query.item)?.startDate
  return startsOn && startsOn > props.query.start ? startsOn : props.query.start
})
const countedEnd = computed(() => props.query.end < props.today ? props.query.end : props.today)
const matchingEvents = computed(() => props.events.filter((item) =>
  item.activity === props.query.item && item.date >= props.query.start && item.date <= props.query.end,
).sort((left, right) => right.date.localeCompare(left.date) || left.start - right.start || left.id.localeCompare(right.id)))
const totalDuration = computed(() => matchingEvents.value.reduce((total, item) => total + item.end - item.start, 0))
const checkedDates = computed(() => new Set(props.checkins.filter((item) =>
  item.habit === props.query.item && item.date >= countedStart.value && item.date <= countedEnd.value && isDateKey(item.date),
).map((item) => item.date)))
const countedDays = computed(() => !rangeError.value && countedStart.value <= countedEnd.value
  ? dayCount(countedStart.value, countedEnd.value)
  : 0)
const checkinStreak = computed(() => {
  let previous = ''
  let streak = 0
  let longest = 0
  for (const date of [...checkedDates.value].sort()) {
    streak = previous && shiftDay(previous, 1) === date ? streak + 1 : 1
    longest = Math.max(longest, streak)
    previous = date
  }
  const endsToday = countedEnd.value === props.today
  const reachesEnd = previous === countedEnd.value || (endsToday && previous === shiftDay(props.today, -1))
  return { end: reachesEnd ? streak : 0, longest, endsToday }
})
const checkinPageCount = computed(() => Math.ceil(countedDays.value / checkinPageSize))
const checkinCalendar = computed(() => {
  if (!countedDays.value) return null

  const offset = checkinPage.value * checkinPageSize
  const length = Math.min(checkinPageSize, countedDays.value - offset)
  const end = shiftDay(countedEnd.value, -offset)
  const start = shiftDay(end, 1 - length)
  const firstColumn = (weekday(start) + 6) % 7 + 1
  const days = Array.from({ length }, (_, index) => {
    const date = shiftDay(start, index)
    const month = Number(date.slice(5, 7))
    const day = Number(date.slice(8, 10))
    const checked = checkedDates.value.has(date)
    return {
      date,
      checked,
      label: index === 0 || day === 1 ? `${month}/${day}` : day,
      description: `${date} ${checked ? '已打卡' : '未打卡'}`,
      startsWeek: (firstColumn + index - 1) % 7 === 0,
    }
  })
  return { start, end, firstColumn, days }
})

watch(() => [props.query.kind, props.query.item, props.query.start, props.query.end], () => {
  activityLimit.value = activityPageSize
  checkinPage.value = 0
})
watch(checkinPageCount, (count) => {
  checkinPage.value = Math.min(checkinPage.value, Math.max(0, count - 1))
})

function setPreset(days: number) {
  emit('update', { ...props.query, start: shiftDay(props.today, 1 - days), end: props.today })
}

function itemValue(kind: RecordQuery['kind'], id: string) {
  return kind + ':' + id
}

function setItem(event: Event) {
  const value = (event.currentTarget as HTMLSelectElement).value
  const separator = value.indexOf(':')
  const kind = value.slice(0, separator)
  if (kind !== 'activity' && kind !== 'habit') return
  emit('update', { ...props.query, kind, item: value.slice(separator + 1) })
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
        <select :value="selectedValue" @change="setItem">
          <option v-if="!selectedItem" :value="selectedValue" disabled>{{ query.item ? '项目暂不可用' : '暂无可查看的项目' }}</option>
          <optgroup v-if="activities.length" label="活动">
            <option v-for="item in activities" :key="item.id" :value="itemValue('activity', item.id)">{{ item.name }}</option>
          </optgroup>
          <optgroup v-if="habits.length" label="每日打卡">
            <option v-for="item in habits" :key="item.id" :value="itemValue('habit', item.id)">{{ item.name }}</option>
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
      <div class="record-summary" :class="{ 'record-habit-summary': !isActivity }" aria-live="polite">
        <template v-if="isActivity">
          <div class="record-metric"><span>已安排</span><strong>{{ matchingEvents.length }} 次</strong></div>
          <div class="record-metric"><span>安排总时长</span><strong>{{ durationLabel(totalDuration) }}</strong></div>
        </template>
        <template v-else>
          <div class="record-metric">
            <span>已打卡</span>
            <strong>
              <span class="record-visually-hidden">{{ checkedDates.size }} 天，共 {{ countedDays }} 个可打卡日</span>
              <span class="record-checkin-total" aria-hidden="true">{{ checkedDates.size }} <small>/ {{ countedDays }} 天</small></span>
            </strong>
          </div>
          <div class="record-metric">
            <span>{{ checkinStreak.endsToday ? '当前连续' : '期末连续' }}</span>
            <strong>{{ checkinStreak.end }} <small>天</small></strong>
          </div>
          <div class="record-metric">
            <span>区间最长连续</span>
            <strong>{{ checkinStreak.longest }} <small>天</small></strong>
          </div>
        </template>
      </div>
      <template v-if="isActivity">
        <h3>安排明细</h3>
        <ol v-if="matchingEvents.length" class="record-list">
          <li v-for="item in matchingEvents.slice(0, activityLimit)" :key="item.id">
            <span class="record-row-day">
              <time :datetime="item.date">{{ dayLabel(item.date) }}</time>
              <span class="record-note">周{{ WEEKDAYS[weekday(item.date)] }}</span>
            </span>
            <span class="record-row-detail">
              <span>{{ clock(item.start) }}–{{ clock(item.end) }}</span>
              <span v-if="item.workException" class="record-note">工作时段例外</span>
            </span>
          </li>
        </ol>
        <p v-else class="record-empty">这段时间还没有该活动的安排。</p>
        <button
          v-if="matchingEvents.length > activityLimit"
          class="planner-button record-more"
          type="button"
          @click="activityLimit += activityPageSize"
        >查看更多（还有 {{ matchingEvents.length - activityLimit }} 条）</button>
      </template>
      <template v-else>
        <div class="record-calendar-heading">
          <h3 id="record-checkin-heading">逐日打卡</h3>
          <span v-if="checkinCalendar" class="record-calendar-range" aria-live="polite">
            {{ checkinCalendar.start }}<template v-if="checkinCalendar.start !== checkinCalendar.end"> – {{ checkinCalendar.end }}</template>
          </span>
        </div>
        <template v-if="checkinCalendar">
          <div class="record-calendar-weekdays" aria-hidden="true">
            <span v-for="name in calendarWeekdays" :key="name">{{ name }}</span>
          </div>
          <ol class="record-calendar-days" role="list" aria-labelledby="record-checkin-heading">
            <li
              v-for="(day, index) in checkinCalendar.days"
              :key="day.date"
              class="record-checkin-day"
              :data-checked="day.checked"
              :data-week-start="day.startsWeek"
              :style="index === 0 ? { gridColumnStart: checkinCalendar.firstColumn } : undefined"
              :title="day.description"
            >
              <time :datetime="day.date" :aria-current="day.date === today ? 'date' : undefined">
                <span class="record-visually-hidden">{{ day.description }}</span>
                <span aria-hidden="true">{{ day.label }}</span>
              </time>
              <span class="record-checkin-mark" aria-hidden="true">{{ day.checked ? '✓' : '–' }}</span>
            </li>
          </ol>
          <div class="record-calendar-footer">
            <div class="record-calendar-legend">
              <span><b class="record-checkin-key" data-checked="true" aria-hidden="true">✓</b>已打卡</span>
              <span><b class="record-checkin-key" aria-hidden="true">–</b>未打卡</span>
            </div>
            <div v-if="checkinPageCount > 1" class="record-calendar-navigation" role="group" aria-label="切换打卡日期">
              <button
                class="planner-button icon-button"
                type="button"
                aria-label="更早的打卡日期"
                :disabled="checkinPage + 1 >= checkinPageCount"
                @click="checkinPage++"
              >‹</button>
              <button
                class="planner-button icon-button"
                type="button"
                aria-label="更近的打卡日期"
                :disabled="checkinPage === 0"
                @click="checkinPage--"
              >›</button>
            </div>
          </div>
        </template>
        <p v-else class="record-empty">这段时间内还没有到可以打卡的日期。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.record-loading {
  margin-top: 10px;
  color: var(--dp-sub);
  font-size: 12px;
}

#app .record-habit-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

#app .record-metric .record-checkin-total {
  color: inherit;
  font-size: inherit;
}

.record-metric small {
  color: var(--dp-sub);
  font-size: 12px;
  font-weight: 500;
}

.record-calendar-heading,
.record-calendar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.record-calendar-range,
.record-calendar-weekdays,
.record-calendar-legend {
  color: var(--dp-sub);
  font-size: 11px;
}

.record-calendar-weekdays,
.record-calendar-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  text-align: center;
}

.record-calendar-weekdays {
  margin-top: 7px;
}

.record-calendar-days {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.record-checkin-day {
  position: relative;
  display: grid;
  place-content: center;
  min-height: 34px;
  border-radius: 6px;
  background: var(--dp-bg);
  color: var(--dp-sub);
  font-size: 12px;
  line-height: 1.15;
}

.record-checkin-day[data-checked="true"],
.record-checkin-key[data-checked="true"] {
  background: var(--dp-accent);
  color: var(--dp-on-accent);
}

.record-checkin-day[data-checked="true"]:has(+ [data-checked="true"][data-week-start="false"]) {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.record-checkin-day[data-checked="true"] + [data-checked="true"][data-week-start="false"] {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}

.record-checkin-day[data-checked="true"] + [data-checked="true"][data-week-start="false"]::before {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 100%;
  width: 4px;
  background: var(--dp-accent);
  content: '';
}

.record-checkin-day [aria-current="date"] {
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.record-checkin-mark {
  font-size: 11px;
  font-weight: 700;
}

.record-calendar-footer {
  margin-top: 8px;
}

.record-calendar-legend,
.record-calendar-legend > span,
.record-calendar-navigation {
  display: flex;
  align-items: center;
  gap: 5px;
}

.record-calendar-legend {
  gap: 12px;
}

.record-checkin-key {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--dp-bg);
}

.record-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 540px) and (max-height: 720px) {
  #app .record-habit-summary {
    margin-block: 8px;
  }

  .record-checkin-day {
    min-height: 28px;
  }
}
</style>
