<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { BookOpen, Footprints } from '@lucide/vue'
import {
  ACTIVITY_NAMES,
  HABIT_NAMES,
  WORK_BLOCKS,
  clock,
  dayLabel,
  isWorkday,
  monthDays,
  weekDays,
  weekday,
  type Activity,
  type Checkin,
  type Habit,
  type PlannerEvent,
} from '../planner'

const props = defineProps<{
  mode: 'day' | 'week' | 'month'
  selected: string
  today: string
  events: PlannerEvent[]
  checkins: Checkin[]
  pendingHabits: Habit[]
}>()

const emit = defineEmits<{
  select: [date: string]
  openDay: [date: string]
  navigate: [offset: number]
  today: []
  edit: [event: PlannerEvent]
  check: [habit: Habit, checked: boolean]
}>()

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const calendarWeekdays = [...weekdays.slice(1), weekdays[0]]
const activities = Object.keys(ACTIVITY_NAMES) as Activity[]
const habits = Object.keys(HABIT_NAMES) as Habit[]
const hourHeight = 35
const dayPanel = ref<HTMLElement | null>(null)
const dayHeading = ref<HTMLHeadingElement | null>(null)

const eventsByDate = computed(() => {
  const groups = new Map<string, PlannerEvent[]>()
  for (const event of props.events) {
    const group = groups.get(event.date) ?? []
    group.push(event)
    groups.set(event.date, group)
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.end - b.end)
  }
  return groups
})

const checksByDate = computed(() => {
  const groups = new Map<string, Set<Habit>>()
  for (const checkin of props.checkins) {
    const group = groups.get(checkin.date) ?? new Set<Habit>()
    group.add(checkin.habit)
    groups.set(checkin.date, group)
  }
  return groups
})

function dateNumber(date: string) {
  return Number(date.slice(-2))
}

function describeDay(date: string) {
  const events = eventsByDate.value.get(date) ?? []
  const checkCount = checksByDate.value.get(date)?.size ?? 0
  const dayActivities = [...new Set(events.map((event) => event.activity))]
  const weekLabel = '周' + weekdays[weekday(date)]
  const checkLabel = date <= props.today ? `，打卡 ${checkCount} 项，共 ${habits.length} 项` : ''
  const eventLabel = events.length ? '，' + events.map((event) => ACTIVITY_NAMES[event.activity]).join('、') : ''
  return {
    date,
    events,
    checkCount,
    dayActivities,
    weekLabel,
    dayNumber: dateNumber(date),
    label: dayLabel(date) + ' ' + weekLabel + eventLabel + checkLabel,
  }
}

const week = computed(() => weekDays(props.selected).map(describeDay))
const month = computed(() => monthDays(props.selected).map(describeDay))
const selectedDay = computed(() => describeDay(props.selected))
const selectedChecks = computed(() => checksByDate.value.get(props.selected))
const navigationUnit = computed(() => ({ day: '天', week: '周', month: '月' })[props.mode])

const calendarTitle = computed(() => {
  if (props.mode === 'day') {
    return dayLabel(props.selected)
  }
  if (props.mode === 'month') {
    return `${props.selected.slice(0, 4)} 年 ${Number(props.selected.slice(5, 7))} 月`
  }
  const first = week.value[0]?.date ?? props.selected
  const last = week.value.at(-1)?.date ?? props.selected
  const endLabel = first.slice(0, 7) === last.slice(0, 7) ? `${dateNumber(last)} 日` : dayLabel(last)
  return `${dayLabel(first)} – ${endLabel}`
})

const visibleHours = computed(() => {
  let first = 9
  let last = 21
  for (const day of week.value) {
    for (const event of day.events) {
      first = Math.min(first, Math.floor(event.start / 60))
      last = Math.max(last, Math.ceil(event.end / 60))
    }
  }
  return { first, last, ticks: Array.from({ length: last - first }, (_, offset) => first + offset) }
})

function offsetAt(minute: number) {
  return (minute / 60 - visibleHours.value.first) * hourHeight
}

function blockStyle(start: number, end: number) {
  return { top: `${offsetAt(start)}px`, height: `${offsetAt(end) - offsetAt(start)}px` }
}

function placeEvents(events: PlannerEvent[]) {
  type Position = { event: PlannerEvent; top: number; height: number; lane: number }
  const tiles: { event: PlannerEvent; style: Record<string, string> }[] = []
  let group: Position[] = []
  let laneEnds: number[] = []
  let groupEnd = 0

  function finishGroup() {
    const width = 100 / laneEnds.length
    for (const { event, top, height, lane } of group) {
      tiles.push({
        event,
        style: {
          top: `${top}px`,
          height: `${height}px`,
          left: `calc(${lane * width}% + 1px)`,
          width: `max(1px, calc(${width}% - 2px))`,
        },
      })
    }
    group = []
    laneEnds = []
    groupEnd = 0
  }

  const timelineEnd = offsetAt(visibleHours.value.last * 60)
  for (const event of events) {
    const height = Math.max(16, offsetAt(event.end) - offsetAt(event.start) - 2)
    const top = Math.min(offsetAt(event.start) + 1, timelineEnd - height)
    if (group.length && top >= groupEnd) {
      finishGroup()
    }
    const available = laneEnds.findIndex((end) => end <= top)
    const lane = available === -1 ? laneEnds.length : available
    const bottom = top + height
    laneEnds[lane] = bottom
    groupEnd = Math.max(groupEnd, bottom)
    group.push({ event, top, height, lane })
  }
  if (group.length) {
    finishGroup()
  }
  return tiles
}

const timeline = computed(() => week.value.map((day) => ({
  date: day.date,
  workday: isWorkday(day.date),
  tiles: placeEvents(day.events),
})))

function eventLabel(event: PlannerEvent) {
  return `${ACTIVITY_NAMES[event.activity]}，${clock(event.start)}–${clock(event.end)}${event.workException ? '，工作时段例外' : ''}`
}

async function showCompactDay(date: string) {
  emit('openDay', date)
  await nextTick()
  dayHeading.value?.focus()
}

async function selectMonthDay(date: string) {
  emit('select', date)
  if (window.matchMedia('(max-width: 775px)').matches) {
    await nextTick()
    dayPanel.value?.scrollIntoView({ block: 'nearest' })
  }
}

function toggleHabit(habit: Habit, event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const checked = input.checked
  input.checked = selectedChecks.value?.has(habit) ?? false
  emit('check', habit, checked)
}
</script>

<template>
  <div class="planner-body">
    <div class="week-panel">
      <div class="week-toolbar">
        <h2 id="calendar-title">{{ calendarTitle }}</h2>
        <div class="week-actions" role="group" aria-label="切换日期">
          <button
            type="button"
            class="planner-button icon-button"
            :aria-label="'上一' + navigationUnit"
            @click="emit('navigate', -1)"
          >‹</button>
          <button type="button" class="planner-button" @click="emit('today')">今天</button>
          <button
            type="button"
            class="planner-button icon-button"
            :aria-label="'下一' + navigationUnit"
            @click="emit('navigate', 1)"
          >›</button>
        </div>
      </div>

      <div class="calendar" role="group" aria-labelledby="calendar-title">
        <div v-if="mode === 'month'" class="month-grid">
          <span v-for="name in calendarWeekdays" :key="name" class="month-weekday">周{{ name }}</span>
          <button
            v-for="day in month"
            :key="day.date"
            type="button"
            class="month-day"
            :class="{ 'outside-month': day.date.slice(0, 7) !== selected.slice(0, 7) }"
            :aria-pressed="day.date === selected"
            :aria-current="day.date === today ? 'date' : undefined"
            :aria-label="day.label"
            @click="selectMonthDay(day.date)"
          >
            <span class="month-date">{{ day.dayNumber }}</span>
            <span class="month-names">
              <span
                v-for="event in day.events.slice(0, 2)"
                :key="event.id"
                class="month-item"
                :class="event.activity"
              >{{ ACTIVITY_NAMES[event.activity] }}</span>
              <span v-if="day.events.length > 2" class="month-extra">+{{ day.events.length - 2 }}</span>
            </span>
            <span class="month-dots" aria-hidden="true">
              <b v-for="activity in day.dayActivities" :key="activity" class="tone-dot" :class="activity"></b>
            </span>
            <span v-if="day.date <= today" class="month-checks">✓ {{ day.checkCount }}/{{ habits.length }}</span>
          </button>
        </div>

        <template v-else>
          <div class="day-strip">
            <span class="axis-label">时间</span>
            <button
              v-for="day in week"
              :key="day.date"
              type="button"
              class="date-button"
              :aria-pressed="day.date === selected"
              :aria-current="day.date === today ? 'date' : undefined"
              :aria-label="day.label"
              @click="emit('select', day.date)"
            >
              <span>{{ day.weekLabel }}</span>
              <span class="day-number">{{ day.dayNumber }}</span>
              <span class="date-indicator" aria-hidden="true">
                <b v-for="activity in day.dayActivities" :key="activity" class="tone-dot" :class="activity"></b>
              </span>
              <span v-if="day.date <= today" class="day-check-count">✓ {{ day.checkCount }}/{{ habits.length }}</span>
            </button>
          </div>

          <template v-if="mode === 'week'">
            <div class="week-grid" :style="{ '--dp-hours': visibleHours.ticks.length }">
              <div class="time-axis" aria-hidden="true">
                <span v-for="hour in visibleHours.ticks" :key="hour">{{ clock(hour * 60) }}</span>
              </div>
              <div
                v-for="day in timeline"
                :key="day.date"
                class="week-column"
                :class="{ selected: day.date === selected }"
                role="group"
                :aria-label="dayLabel(day.date)"
              >
                <template v-if="day.workday">
                  <div
                    v-for="[start, end] in WORK_BLOCKS"
                    :key="start"
                    class="work-block"
                    :style="blockStyle(start, end)"
                    :aria-label="`工作时段 ${clock(start)}–${clock(end)}`"
                    role="group"
                  ><span aria-hidden="true">工作中</span></div>
                </template>
                <button
                  v-for="{ event, style } in day.tiles"
                  :key="event.id"
                  type="button"
                  class="event-tile"
                  :class="event.activity"
                  :style="style"
                  :aria-label="eventLabel(event)"
                  :title="eventLabel(event)"
                  @click="emit('edit', event)"
                >
                  <span class="event-title">{{ ACTIVITY_NAMES[event.activity] }}</span>
                  <span
                    v-if="event.end - event.start >= 60"
                    class="event-time"
                    :class="{ 'tile-exception': event.workException }"
                  >{{ event.workException ? '例外 · ' : '' }}{{ clock(event.start) }}</span>
                </button>
              </div>
            </div>

            <div class="compact-week">
              <button
                v-for="day in week"
                :key="day.date"
                type="button"
                class="compact-day"
                :aria-current="day.date === today ? 'date' : undefined"
                @click="showCompactDay(day.date)"
              >
                <span class="compact-date">{{ day.weekLabel }} {{ day.dayNumber }}</span>
                <span class="compact-items">
                  <span v-for="event in day.events" :key="event.id">
                    <b class="tone-dot" :class="event.activity" aria-hidden="true"></b>
                    <span class="compact-time">{{ clock(event.start) }}–{{ clock(event.end) }}</span>
                    <span>{{ ACTIVITY_NAMES[event.activity] }}{{ event.workException ? ' · 例外' : '' }}</span>
                  </span>
                  <span v-if="!day.events.length" class="compact-time">暂无活动</span>
                </span>
                <span v-if="day.date <= today" class="day-check-count">✓ {{ day.checkCount }}/{{ habits.length }}</span>
              </button>
            </div>
          </template>
        </template>
      </div>

      <div v-if="mode !== 'day'" class="calendar-legend" aria-label="日历图例">
        <span v-for="activity in activities" :key="activity">
          <b class="tone-dot" :class="activity" aria-hidden="true"></b>{{ ACTIVITY_NAMES[activity] }}
        </span>
        <span v-if="mode === 'week'"><b class="work-key" aria-hidden="true"></b>工作时段</span>
        <span>✓ 当日打卡项数</span>
      </div>
    </div>

    <aside ref="dayPanel" class="day-panel" aria-labelledby="selected-day-title">
      <header class="day-heading">
        <span class="day-caption">{{ selected === today ? '今天 · ' : '' }}{{ selectedDay.weekLabel }}</span>
        <h2 id="selected-day-title" ref="dayHeading" tabindex="-1">{{ dayLabel(selected) }}</h2>
      </header>

      <section class="day-section" aria-labelledby="day-agenda-title">
        <div class="section-heading">
          <h3 id="day-agenda-title">当天日程</h3>
          <span class="agenda-count">{{ selectedDay.events.length }} 项</span>
        </div>
        <div class="agenda">
          <button
            v-for="event in selectedDay.events"
            :key="event.id"
            type="button"
            class="agenda-item"
            :class="event.activity"
            @click="emit('edit', event)"
          >
            <span>
              <span class="agenda-name">{{ ACTIVITY_NAMES[event.activity] }}</span>
              <span class="agenda-time">{{ clock(event.start) }}–{{ clock(event.end) }}</span>
            </span>
            <span v-if="event.workException" class="agenda-exception">工作时段例外</span>
          </button>
          <p v-if="!selectedDay.events.length" class="empty-agenda">这一天还没有活动</p>
        </div>
      </section>

      <section class="day-section habit-section" aria-labelledby="day-habits-title">
        <div class="section-heading">
          <h3 id="day-habits-title">当日打卡</h3>
          <span class="habit-count" aria-live="polite">
            {{ selected > today ? '—' : `${selectedDay.checkCount} / ${habits.length}` }}
          </span>
        </div>
        <div class="habit-progress" aria-hidden="true">
          <span v-for="index in habits.length" :key="index" :class="{ done: index <= selectedDay.checkCount }"></span>
        </div>
        <label v-for="habit in habits" :key="habit" class="habit-row">
          <span>
            <Footprints v-if="habit === 'steps'" :size="15" aria-hidden="true" />
            <BookOpen v-else :size="15" aria-hidden="true" />
            {{ HABIT_NAMES[habit] }}
          </span>
          <input
            type="checkbox"
            :checked="selectedChecks?.has(habit) ?? false"
            :disabled="selected > today || pendingHabits.includes(habit)"
            :aria-busy="pendingHabits.includes(habit)"
            @change="toggleHabit(habit, $event)"
          >
        </label>
        <p v-if="selected > today" class="future-hint">到当天后可以打卡</p>
      </section>

      <section v-if="isWorkday(selected)" class="phone-work" aria-labelledby="day-work-title">
        <div class="section-heading"><h3 id="day-work-title">工作时段</h3><span>默认避开</span></div>
        <div class="work-pills">
          <span v-for="[start, end] in WORK_BLOCKS" :key="start">{{ clock(start) }}–{{ clock(end) }}</span>
        </div>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.event-tile:focus-visible {
  z-index: 3;
}
</style>
