<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { placeTimelineEvents } from './calendarLayout'
import {
  WORK_BLOCKS, clock, dayLabel, isWorkday, overlapsWork,
  type Activity, type PlannerEvent, type TimeSelection,
} from '../domain/planner'

const props = defineProps<{
  mode: 'day' | 'week'
  selected: string
  days: readonly { date: string; events: PlannerEvent[] }[]
  activityName: (id: Activity) => string
  activityToneClass: (id: Activity) => string
}>()

const emit = defineEmits<{
  edit: [event: PlannerEvent]
  plan: [selection: TimeSelection]
}>()

const dayGridOpen = ref(false)
const slotMinutes = 30
const hourHeight = computed(() => props.mode === 'day' ? 48 : 35)

const visibleHours = computed(() => {
  let first = 9
  let last = 21
  for (const day of props.days) {
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

const timeline = computed(() => {
  const timelineEnd = offsetAt(visibleHours.value.last * 60)
  return props.days.map(({ date, events }) => ({
    date,
    workday: isWorkday(date),
    tiles: placeTimelineEvents(events, offsetAt, timelineEnd),
  }))
})

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
  return `${props.activityName(event.activity)}，${clock(event.start)}–${clock(event.end)}${event.workException ? '，工作时段例外' : ''}`
}

onBeforeUnmount(() => clearPointer())
</script>

<template>
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

#app .timeline-slot:focus-visible {
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

@media (max-width: 560px) {
  .week-timeline {
    display: none;
  }
}
</style>
