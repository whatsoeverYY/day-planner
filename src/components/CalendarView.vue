<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BookOpen, CircleCheck, Footprints } from '@lucide/vue'
import type { ActivityDefinition, HabitDefinition } from '../catalog'
import {
  WORK_BLOCKS,
  clock,
  dayLabel,
  isWorkday,
  monthDays,
  overlapsWork,
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
  activities: ActivityDefinition[]
  habits: HabitDefinition[]
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
  plan: [selection: { date: string; start: number; end: number }]
  check: [habit: Habit, checked: boolean]
}>()

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const calendarWeekdays = [...weekdays.slice(1), weekdays[0]]
const activitiesById = computed(() => new Map(props.activities.map((item) => [item.id, item])))
const slotMinutes = 30
const hourHeight = computed(() => props.mode === 'day' ? 48 : 35)
const dayPanel = ref<HTMLElement | null>(null)
const dayHeading = ref<HTMLHeadingElement | null>(null)
const dayGridOpen = ref(false)

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
  const checkLabel = date <= props.today && habits.length ? `，打卡 ${checkCount} 项，共 ${habits.length} 项` : ''
  const eventLabel = events.length ? '，' + events.map((event) => activityName(event.activity)).join('、') : ''
  return {
    date,
    events,
    habits,
    checkCount,
    activityTones,
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
  for (const day of props.mode === 'day' ? [selectedDay.value] : week.value) {
    for (const event of day.events) {
      first = Math.min(first, Math.floor(event.start / 60))
      last = Math.max(last, Math.ceil(event.end / 60))
    }
  }
  return { first, last, ticks: Array.from({ length: last - first }, (_, offset) => first + offset) }
})

function offsetAt(minute: number) {
  return (minute / 60 - visibleHours.value.first) * hourHeight.value
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

const timeline = computed(() => (props.mode === 'day' ? [selectedDay.value] : week.value).map((day) => ({
  date: day.date,
  workday: isWorkday(day.date),
  tiles: placeEvents(day.events),
})))

const slotStarts = computed(() => Array.from(
  { length: visibleHours.value.ticks.length * 2 },
  (_, index) => visibleHours.value.first * 60 + index * slotMinutes,
))
const timelineStyle = computed(() => ({
  '--dp-hours': visibleHours.value.ticks.length,
  '--dp-hour': `${hourHeight.value}px`,
}))

type SlotRange = { date: string; anchor: number; cursor: number }

const pointerRange = ref<SlotRange | null>(null)
const keyboardRange = ref<SlotRange | null>(null)
const focusSlots = ref<Record<string, number>>({})
let activePointer: { id: number; surface: HTMLElement } | null = null

function selectionFor(range: SlotRange) {
  return {
    date: range.date,
    start: slotStarts.value[Math.min(range.anchor, range.cursor)],
    end: slotStarts.value[Math.max(range.anchor, range.cursor)] + slotMinutes,
  }
}

const selection = computed(() => {
  const range = pointerRange.value ?? keyboardRange.value
  return range ? selectionFor(range) : null
})

function slotLabel(date: string, start: number) {
  const end = start + slotMinutes
  const work = overlapsWork(date, start, end) ? '，工作时段，保存需开启例外' : ''
  return `${dayLabel(date)} ${clock(start)}–${clock(end)}，新增活动${work}`
}

function pointerSlot(surface: HTMLElement, clientY: number) {
  const bounds = surface.getBoundingClientRect()
  const slots = slotStarts.value.length
  const index = Math.floor((clientY - bounds.top) * slots / bounds.height)
  return Math.max(0, Math.min(slots - 1, index))
}

function startSelection(date: string, event: PointerEvent) {
  if (activePointer || !event.isPrimary || event.button !== 0) return
  const surface = event.currentTarget as HTMLElement
  const slot = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-slot-index]')
  if (!slot) return
  const index = Number(slot.dataset.slotIndex)
  event.preventDefault()
  slot.focus({ preventScroll: true })
  keyboardRange.value = null
  surface.setPointerCapture(event.pointerId)
  activePointer = { id: event.pointerId, surface }
  pointerRange.value = { date, anchor: index, cursor: index }
}

function moveSelection(event: PointerEvent) {
  if (!activePointer || activePointer.id !== event.pointerId || !pointerRange.value) return
  pointerRange.value.cursor = pointerSlot(activePointer.surface, event.clientY)
}

function clearPointer(event?: PointerEvent) {
  if (!activePointer || (event && activePointer.id !== event.pointerId)) return
  const { id, surface } = activePointer
  activePointer = null
  pointerRange.value = null
  if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id)
}

function finishSelection(event: PointerEvent) {
  if (activePointer?.id !== event.pointerId || !pointerRange.value) return
  moveSelection(event)
  const draft = selectionFor(pointerRange.value)
  // Let the browser release capture after pointerup so its click stays on the selection layer.
  activePointer = null
  pointerRange.value = null
  emit('plan', draft)
}

function activateSlot(date: string, index: number, event: MouseEvent) {
  // Pointer activation is handled on pointerup, including single taps.
  if (event.detail !== 0) return
  const range = keyboardRange.value?.date === date
    ? keyboardRange.value
    : { date, anchor: index, cursor: index }
  keyboardRange.value = null
  emit('plan', selectionFor(range))
}

function onSlotKey(date: string, index: number, event: KeyboardEvent) {
  if (event.key === 'Escape') {
    clearPointer()
    keyboardRange.value = null
    return
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const direction = event.key === 'ArrowUp' ? -1 : 1
  const next = Math.max(0, Math.min(slotStarts.value.length - 1, index + direction))
  const anchor = keyboardRange.value?.date === date ? keyboardRange.value.anchor : index
  keyboardRange.value = event.shiftKey ? { date, anchor, cursor: next } : null
  const surface = (event.currentTarget as HTMLElement).parentElement
  surface?.querySelector<HTMLButtonElement>(`[data-slot-index="${next}"]`)?.focus()
}

function clearKeyboard(event: FocusEvent) {
  const surface = event.currentTarget as HTMLElement
  if (!(event.relatedTarget instanceof Node) || !surface.contains(event.relatedTarget)) {
    keyboardRange.value = null
  }
}

watch(() => props.mode, (mode) => {
  if (mode !== 'day') dayGridOpen.value = false
})

watch([() => props.mode, () => props.selected, () => visibleHours.value.first, () => visibleHours.value.last, dayGridOpen], () => {
  clearPointer()
  keyboardRange.value = null
  focusSlots.value = {}
})

function eventLabel(event: PlannerEvent) {
  return `${activityName(event.activity)}，${clock(event.start)}–${clock(event.end)}${event.workException ? '，工作时段例外' : ''}`
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
                :class="activityToneClass(event.activity)"
              >{{ activityName(event.activity) }}</span>
              <span v-if="day.events.length > 2" class="month-extra">+{{ day.events.length - 2 }}</span>
            </span>
            <span class="month-dots" aria-hidden="true">
              <b v-for="tone in day.activityTones" :key="tone" class="tone-dot" :class="tone"></b>
            </span>
            <span v-if="day.date <= today && day.habits.length" class="month-checks">✓ {{ day.checkCount }}/{{ day.habits.length }}</span>
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
              <span v-if="day.date <= today && day.habits.length" class="day-check-count">✓ {{ day.checkCount }}/{{ day.habits.length }}</span>
            </button>
          </div>

          <div v-if="mode === 'day'" class="day-timeline-toggle">
            <button
              type="button"
              class="planner-button"
              :aria-expanded="dayGridOpen"
              aria-controls="day-timeline"
              @click="dayGridOpen = !dayGridOpen"
            >{{ dayGridOpen ? '收起时间格' : '按时间规划' }}</button>
          </div>

          <div
            v-show="mode === 'week' || dayGridOpen"
            :id="mode === 'day' ? 'day-timeline' : undefined"
            :class="mode === 'day' ? 'day-timeline' : 'week-timeline'"
          >
            <p id="timeline-planning-hint" class="timeline-planning-hint" aria-live="polite">
              <template v-if="selection">
                {{ dayLabel(selection.date) }} · {{ clock(selection.start) }}–{{ clock(selection.end) }}
              </template>
              <template v-else>
                点击时间格安排半小时，拖动可选择连续时段。
                <span v-if="mode === 'day'" class="touch-scroll-hint">沿左侧刻度滑动可滚动页面。</span>
              </template>
            </p>
            <span id="timeline-keyboard-hint" class="dp-sr-only">
              上下方向键移动，按住 Shift 扩展时段，按回车新增活动。
            </span>
            <div :class="mode === 'day' ? 'day-grid' : 'week-grid'" :style="timelineStyle">
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
                :data-date="day.date"
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
                <div
                  class="slot-layer"
                  :style="{ '--slot-count': slotStarts.length }"
                  @pointerdown="startSelection(day.date, $event)"
                  @pointermove="moveSelection"
                  @pointerup="finishSelection"
                  @pointercancel="clearPointer"
                  @lostpointercapture="clearPointer"
                  @focusout="clearKeyboard"
                >
                  <button
                    v-for="(start, index) in slotStarts"
                    :key="start"
                    type="button"
                    class="timeline-slot"
                    :data-slot-index="index"
                    :data-start="start"
                    :tabindex="index === (focusSlots[day.date] ?? 0) ? 0 : -1"
                    :aria-label="slotLabel(day.date, start)"
                    :title="slotLabel(day.date, start)"
                    aria-describedby="timeline-keyboard-hint"
                    @focus="focusSlots[day.date] = index"
                    @click="activateSlot(day.date, index, $event)"
                    @keydown="onSlotKey(day.date, index, $event)"
                  ></button>
                </div>
                <div
                  v-if="selection?.date === day.date"
                  class="slot-selection"
                  :style="blockStyle(selection.start, selection.end)"
                  aria-hidden="true"
                ></div>
                <button
                  v-for="{ event, style } in day.tiles"
                  :key="event.id"
                  type="button"
                  class="event-tile"
                  :class="activityToneClass(event.activity)"
                  :style="style"
                  :aria-label="eventLabel(event)"
                  :title="eventLabel(event)"
                  @click="emit('edit', event)"
                >
                  <span class="event-title">{{ activityName(event.activity) }}</span>
                  <span
                    v-if="event.end - event.start >= 60"
                    class="event-time"
                    :class="{ 'tile-exception': event.workException }"
                  >{{ event.workException ? '例外 · ' : '' }}{{ clock(event.start) }}</span>
                </button>
              </div>
            </div>
          </div>

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
              <span v-if="day.date <= today && day.habits.length" class="day-check-count">✓ {{ day.checkCount }}/{{ day.habits.length }}</span>
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
            :class="activityToneClass(event.activity)"
            @click="emit('edit', event)"
          >
            <span>
              <span class="agenda-name">{{ activityName(event.activity) }}</span>
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
          <span v-if="selectedDay.habits.length" class="habit-count" aria-live="polite">
            {{ selected > today ? '—' : `${selectedDay.checkCount} / ${selectedDay.habits.length}` }}
          </span>
        </div>
        <div v-if="selectedDay.habits.length" class="habit-progress" aria-hidden="true">
          <span v-for="index in selectedDay.habits.length" :key="index" :class="{ done: index <= selectedDay.checkCount }"></span>
        </div>
        <label v-for="habit in selectedDay.habits" :key="habit.id" class="habit-row">
          <span>
            <Footprints v-if="habit.id === 'steps'" :size="15" aria-hidden="true" />
            <BookOpen v-else-if="habit.id === 'reading'" :size="15" aria-hidden="true" />
            <CircleCheck v-else :size="15" aria-hidden="true" />
            {{ habit.name }}
          </span>
          <input
            type="checkbox"
            :checked="selectedChecks?.has(habit.id) ?? false"
            :disabled="selected > today || pendingHabits.includes(habit.id)"
            :aria-busy="pendingHabits.includes(habit.id)"
            @change="toggleHabit(habit.id, $event)"
          >
        </label>
        <p v-if="!selectedDay.habits.length" class="empty-agenda">这一天还没有打卡项目</p>
        <p v-else-if="selected > today" class="future-hint">到当天后可以打卡</p>
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
.day-timeline-toggle {
  padding: 6px 10px 10px;
}

.timeline-planning-hint {
  padding: 6px 9px;
  min-height: 28px;
  color: var(--dp-sub);
  font-size: 11px;
  border-block: 1px solid var(--dp-grid);
}

.touch-scroll-hint {
  display: none;
}

@media (pointer: coarse) {
  .touch-scroll-hint {
    display: inline;
  }
}

.day-grid {
  display: grid;
  grid-template-columns: max(var(--dp-axis), 54px) minmax(0, 1fr);
  height: calc(var(--dp-hour) * var(--dp-hours));
}

.slot-layer {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: repeat(var(--slot-count), minmax(0, 1fr));
  touch-action: none;
  user-select: none;
}

.timeline-slot {
  min-height: 0;
  padding: 0;
  border: 0;
  border-block-end: 1px solid color-mix(in srgb, var(--dp-sub) 13%, transparent);
  background: transparent;
}

.timeline-slot:nth-child(even) {
  border-block-end-color: transparent;
}

@media (hover: hover) {
  .timeline-slot:hover {
    background: color-mix(in srgb, var(--dp-accent) 13%, transparent);
  }
}

:global(#app) .timeline-slot:focus-visible {
  outline-offset: -2px;
}

.slot-selection {
  position: absolute;
  inset-inline: 1px;
  background: color-mix(in srgb, var(--dp-accent) 20%, transparent);
  border: 1px solid var(--dp-accent);
  border-radius: 3px;
  pointer-events: none;
}

.event-tile:focus-visible {
  z-index: 3;
}

.agenda-name,
.calendar-legend > span,
.compact-items > span,
.habit-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 560px) {
  .week-timeline {
    display: none;
  }
}
</style>
