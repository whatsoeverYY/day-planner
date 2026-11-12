<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen, CircleCheck, Footprints } from '@lucide/vue'
import type { HabitDefinition } from '../domain/catalog'
import { WORK_BLOCKS, clock, dayLabel, isWorkday, type Activity, type Habit, type PlannerEvent } from '../domain/planner'

const props = defineProps<{
  day: {
    date: string
    weekLabel: string
    events: PlannerEvent[]
    habits: HabitDefinition[]
    checks?: Set<Habit>
    checkCount: number
  }
  today: string
  checkinsReady: boolean
  pendingHabits: Habit[]
  activityName: (id: Activity) => string
  activityToneClass: (id: Activity) => string
}>()

const emit = defineEmits<{
  edit: [event: PlannerEvent]
  check: [habit: Habit, checked: boolean]
}>()

const dayPanel = ref<HTMLElement | null>(null)
const dayHeading = ref<HTMLHeadingElement | null>(null)

function focusHeading() {
  dayHeading.value?.focus()
}

function scrollIntoView() {
  dayPanel.value?.scrollIntoView({ block: 'nearest' })
}

defineExpose({ focusHeading, scrollIntoView })

function toggleHabit(habit: Habit, event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const checked = input.checked
  input.checked = props.day.checks?.has(habit) ?? false
  emit('check', habit, checked)
}
</script>

<template>
  <aside ref="dayPanel" class="day-panel" aria-labelledby="selected-day-title">
    <header class="day-heading">
      <span class="day-caption">{{ day.date === today ? '今天 · ' : '' }}{{ day.weekLabel }}</span>
      <h2 id="selected-day-title" ref="dayHeading" tabindex="-1">{{ dayLabel(day.date) }}</h2>
    </header>

    <section class="day-section" aria-labelledby="day-agenda-title">
      <div class="section-heading">
        <h3 id="day-agenda-title">当天日程</h3>
        <span class="agenda-count">{{ day.events.length }} 项</span>
      </div>
      <div class="agenda">
        <button
          v-for="event in day.events"
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
        <p v-if="!day.events.length" class="empty-agenda">这一天还没有活动</p>
      </div>
    </section>

    <section class="day-section habit-section" aria-labelledby="day-habits-title">
      <div class="section-heading">
        <h3 id="day-habits-title">当日打卡</h3>
        <span v-if="day.habits.length" class="habit-count" aria-live="polite">
          {{ day.date > today || !checkinsReady ? '—' : `${day.checkCount} / ${day.habits.length}` }}
        </span>
      </div>
      <div v-if="day.habits.length && checkinsReady" class="habit-progress" aria-hidden="true">
        <span v-for="index in day.habits.length" :key="index" :class="{ done: index <= day.checkCount }"></span>
      </div>
      <label v-for="habit in day.habits" :key="habit.id" class="habit-row">
        <span>
          <Footprints v-if="habit.id === 'steps'" :size="15" aria-hidden="true" />
          <BookOpen v-else-if="habit.id === 'reading'" :size="15" aria-hidden="true" />
          <CircleCheck v-else :size="15" aria-hidden="true" />
          {{ habit.name }}
        </span>
        <input
          type="checkbox"
          :checked="checkinsReady && (day.checks?.has(habit.id) ?? false)"
          :indeterminate="day.date <= today && !checkinsReady"
          :disabled="day.date > today || !checkinsReady || pendingHabits.includes(habit.id)"
          :aria-busy="pendingHabits.includes(habit.id)"
          @change="toggleHabit(habit.id, $event)"
        >
      </label>
      <p v-if="!day.habits.length" class="empty-agenda">这一天还没有打卡项目</p>
      <p v-else-if="day.date > today" class="future-hint">到当天后可以打卡</p>
      <p v-else-if="!checkinsReady" class="future-hint">打卡状态暂不可用</p>
    </section>

    <section v-if="isWorkday(day.date)" class="phone-work" aria-labelledby="day-work-title">
      <div class="section-heading"><h3 id="day-work-title">工作时段</h3><span>默认避开</span></div>
      <div class="work-pills">
        <span v-for="[start, end] in WORK_BLOCKS" :key="start">{{ clock(start) }}–{{ clock(end) }}</span>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.agenda-name,
.habit-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
