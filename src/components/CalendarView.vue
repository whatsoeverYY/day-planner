<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import CalendarDayPanel from './CalendarDayPanel.vue'
import CalendarTimeline from './CalendarTimeline.vue'
import type { ActivityDefinition, HabitDefinition } from '../domain/catalog'
import {
  clock,
  dayLabel,
  monthDays,
  weekDays,
  weekday,
  type Activity,
  type Checkin,
  type Habit,
  type PlannerEvent,
  type TimeSelection,
} from '../domain/planner'

const props = defineProps<{
  mode: 'day' | 'week' | 'month'
  selected: string
  today: string
  activities: ActivityDefinition[]
  habits: HabitDefinition[]
  events: PlannerEvent[]
  checkins: Checkin[]
  checkinsReady: boolean
  pendingHabits: Habit[]
}>()

const emit = defineEmits<{
  select: [date: string]
  openDay: [date: string]
  navigate: [offset: number]
  today: []
  edit: [event: PlannerEvent]
  plan: [selection: TimeSelection]
  check: [habit: Habit, checked: boolean]
}>()

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const calendarWeekdays = [...weekdays.slice(1), weekdays[0]]
const activitiesById = computed(() => new Map(props.activities.map((item) => [item.id, item])))
const dayPanel = ref<InstanceType<typeof CalendarDayPanel> | null>(null)

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

function activityName(id: Activity) {
  return activitiesById.value.get(id)?.name ?? '未命名活动'
}

function activityToneClass(id: Activity) {
  return 'tone-' + (activitiesById.value.get(id)?.tone ?? 'purple')
}

function describeDay(date: string) {
  const events = eventsByDate.value.get(date) ?? []
  const habits = props.habits.filter((habit) => habit.startDate <= date)
  const checks = checksByDate.value.get(date)
  const checkCount = habits.filter((habit) => checks?.has(habit.id)).length
  const activityTones = [...new Set(events.map((event) => activityToneClass(event.activity)))]
  const weekLabel = '周' + weekdays[weekday(date)]
  const showCheckCount = props.checkinsReady && date <= props.today && habits.length > 0
  const checkLabel = showCheckCount ? `，打卡 ${checkCount} 项，共 ${habits.length} 项` : ''
  const eventLabel = events.length ? '，' + events.map((event) => activityName(event.activity)).join('、') : ''
  return {
    date,
    events,
    habits,
    checks,
    checkCount,
    showCheckCount,
    activityTones,
    weekLabel,
    dayNumber: dateNumber(date),
    label: dayLabel(date) + ' ' + weekLabel + eventLabel + checkLabel,
  }
}

const week = computed(() => weekDays(props.selected).map(describeDay))
const month = computed(() => monthDays(props.selected).map(describeDay))
const selectedDay = computed(() => describeDay(props.selected))
const timelineDays = computed(() => props.mode === 'day' ? [selectedDay.value] : week.value)
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

async function showCompactDay(date: string) {
  emit('openDay', date)
  await nextTick()
  dayPanel.value?.focusHeading()
}

async function selectMonthDay(date: string) {
  emit('select', date)
  if (window.matchMedia('(max-width: 775px)').matches) {
    await nextTick()
    dayPanel.value?.scrollIntoView()
  }
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
                :class="activityToneClass(event.activity)"
              >{{ activityName(event.activity) }}</span>
              <span v-if="day.events.length > 2" class="month-extra">+{{ day.events.length - 2 }}</span>
            </span>
            <span class="month-dots" aria-hidden="true">
              <b v-for="tone in day.activityTones" :key="tone" class="tone-dot" :class="tone"></b>
            </span>
            <span v-if="day.showCheckCount" class="month-checks">✓ {{ day.checkCount }}/{{ day.habits.length }}</span>
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
                <b v-for="tone in day.activityTones" :key="tone" class="tone-dot" :class="tone"></b>
              </span>
              <span v-if="day.showCheckCount" class="day-check-count">✓ {{ day.checkCount }}/{{ day.habits.length }}</span>
            </button>
          </div>

          <CalendarTimeline
            :mode="mode"
            :selected="selected"
            :days="timelineDays"
            :activity-name="activityName"
            :activity-tone-class="activityToneClass"
            @edit="emit('edit', $event)"
            @plan="emit('plan', $event)"
          />

          <div v-if="mode === 'week'" class="compact-week">
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
                  <b class="tone-dot" :class="activityToneClass(event.activity)" aria-hidden="true"></b>
                  <span class="compact-time">{{ clock(event.start) }}–{{ clock(event.end) }}</span>
                  <span>{{ activityName(event.activity) }}{{ event.workException ? ' · 例外' : '' }}</span>
                </span>
                <span v-if="!day.events.length" class="compact-time">暂无活动</span>
              </span>
            <span v-if="day.showCheckCount" class="day-check-count">✓ {{ day.checkCount }}/{{ day.habits.length }}</span>
            </button>
          </div>
        </template>
      </div>

      <div v-if="mode !== 'day'" class="calendar-legend" aria-label="日历图例">
        <span v-for="activity in activities" :key="activity.id">
          <b class="tone-dot" :class="'tone-' + activity.tone" aria-hidden="true"></b>{{ activity.name }}
        </span>
        <span v-if="mode === 'week'"><b class="work-key" aria-hidden="true"></b>工作时段</span>
        <span v-if="habits.length">✓ 当日打卡项数</span>
      </div>
    </div>

    <CalendarDayPanel
      ref="dayPanel"
      :day="selectedDay"
      :today="today"
      :checkins-ready="checkinsReady"
      :pending-habits="pendingHabits"
      :activity-name="activityName"
      :activity-tone-class="activityToneClass"
      @edit="emit('edit', $event)"
      @check="(habit, checked) => emit('check', habit, checked)"
    />
  </div>
</template>

<style scoped>
.calendar-legend > span,
.compact-items > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
