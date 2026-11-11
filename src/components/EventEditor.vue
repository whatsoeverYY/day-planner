<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ActivityDefinition } from '../catalog'
import { dayLabel, isDateKey, isWorkday, overlapsWork, weekday } from '../planner'
import type { Activity, EventDraft, PlannerEvent, TimeSelection } from '../planner'

const props = defineProps<{
  date: string
  event: PlannerEvent | null
  selection?: TimeSelection
  activities: ActivityDefinition[]
  events: PlannerEvent[]
  saving: boolean
  error: string
}>()

const emit = defineEmits<{
  save: [draft: EventDraft]
  remove: [id: string]
  close: []
  dateChange: [date: string]
}>()

const dialog = ref<HTMLDialogElement>()
const date = ref(props.event?.date ?? props.selection?.date ?? props.date)
const activity = ref<Activity>(props.event?.activity ?? props.activities[0]?.id ?? '')
const start = ref(props.event?.start ?? props.selection?.start ?? 18 * 60)
const end = ref(props.event?.end ?? props.selection?.end ?? 19 * 60)
const allowWork = ref(props.event?.workException ?? false)
const confirmingRemoval = ref(false)

const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const minutes = Array.from({ length: 60 }, (_, index) => index)
const hours = Array.from({ length: 25 }, (_, index) => index)
const timeFields = [
  { key: 'start', label: '开始时间', hours: hours.slice(0, -1) },
  { key: 'end', label: '结束时间', hours },
] as const
type TimeField = (typeof timeFields)[number]['key']

const validDate = computed(() => isDateKey(date.value))
const workday = computed(() => validDate.value && isWorkday(date.value))
const workConflict = computed(() => workday.value && overlapsWork(date.value, start.value, end.value))
const eventConflict = computed(() => props.events.some((item) =>
  item.id !== props.event?.id &&
  item.date === date.value &&
  item.start < end.value &&
  item.end > start.value,
))
const activityOptions = computed<ActivityDefinition[]>(() => {
  const previousId = props.event?.activity
  if (!previousId || props.activities.some(({ id }) => id === previousId)) return props.activities
  return [...props.activities, { id: previousId, name: '未命名活动', tone: 'purple' }]
})
const validActivity = computed(() => activityOptions.value.some(({ id }) => id === activity.value))
const canSave = computed(() => validActivity.value && validDate.value && endAllowed(end.value))
const timeParts = computed(() => ({
  start: { hour: Math.floor(start.value / 60), minute: start.value % 60 },
  end: { hour: Math.floor(end.value / 60), minute: end.value % 60 },
}))
const messages = computed(() => {
  if (!activityOptions.value.length) return ['请先在配置中新增活动类型。']
  if (!validActivity.value) return ['请选择活动类型。']
  if (!validDate.value) return ['请选择有效的日期。']
  if (end.value <= start.value) return ['请选择晚于开始时间的结束时间。']
  if (workConflict.value && !allowWork.value) {
    return ['与工作时段重叠。请调整时间或开启本次例外。']
  }
  const details: string[] = []
  if (workConflict.value) details.push('保存后，这条活动会标记为「工作时段例外」。')
  if (eventConflict.value) details.push('和已有活动时间重叠，可以继续保存。')
  if (!details.length && workday.value && !allowWork.value) details.push('可选时段已避开工作时间。')
  return details
})

function endAllowed(value: number, from = start.value) {
  return value > from && value <= 1440 &&
    (!workday.value || allowWork.value || !overlapsWork(date.value, from, value))
}

function timeAllowed(field: TimeField, value: number) {
  if (field === 'end') return endAllowed(value)
  return value < 1440 &&
    (!workday.value || allowWork.value || !overlapsWork(date.value, value, value + 1))
}

function allowedMinutes(field: TimeField, hour: number) {
  if (hour === 24) return endAllowed(1440) ? [0] : []
  return minutes.filter((minute) => timeAllowed(field, hour * 60 + minute))
}

function selectTime(field: TimeField, value: number) {
  if (!timeAllowed(field, value)) return
  if (field === 'end') {
    end.value = value
    return
  }
  const duration = Math.max(1, end.value - start.value)
  start.value = value
  let nextEnd = Math.min(1440, value + duration)
  while (nextEnd > value && !endAllowed(nextEnd)) nextEnd--
  end.value = nextEnd
}

function selectHour(field: TimeField, event: Event) {
  const hour = Number((event.target as HTMLSelectElement).value)
  const preferred = timeParts.value[field].minute
  const choices = allowedMinutes(field, hour)
  const minute = choices.find((candidate) => candidate >= preferred) ?? choices.at(-1)
  if (minute !== undefined) selectTime(field, hour * 60 + minute)
}

function selectMinute(field: TimeField, event: Event) {
  selectTime(field, timeParts.value[field].hour * 60 + Number((event.target as HTMLSelectElement).value))
}

function changeDate(event: Event) {
  const nextDate = (event.target as HTMLInputElement).value
  if (nextDate === date.value) return
  date.value = nextDate
  allowWork.value = false
  if (validDate.value) emit('dateChange', nextDate)
}

function save() {
  if (props.saving || !canSave.value) return
  emit('save', {
    date: date.value,
    activity: activity.value,
    start: start.value,
    end: end.value,
    workException: workConflict.value,
  })
}

function remove() {
  if (!props.event || props.saving) return
  if (confirmingRemoval.value) emit('remove', props.event.id)
  else confirmingRemoval.value = true
}

function close() {
  if (!props.saving) emit('close')
}

onMounted(() => {
  dialog.value?.showModal()
  if (validDate.value) emit('dateChange', date.value)
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="event-sheet" aria-labelledby="event-editor-heading" @cancel.prevent="close">
    <header class="sheet-heading">
      <div>
        <h2 id="event-editor-heading">{{ event ? '编辑活动' : '新增活动' }}</h2>
        <p class="sheet-subtitle">
          {{ validDate ? `${dayLabel(date)} · 周${weekdays[weekday(date)]}` : '请选择日期' }}
        </p>
      </div>
      <button type="button" class="planner-button icon-button" aria-label="关闭" :disabled="saving" @click="close">×</button>
    </header>
    <form :aria-busy="saving" @submit.prevent="save">
      <fieldset class="form-group" :disabled="saving">
        <legend>活动类型</legend>
        <div class="type-options">
          <label v-for="item in activityOptions" :key="item.id" class="type-option" :class="'tone-' + item.tone">
            <input v-model="activity" type="radio" name="activity" :value="item.id">
            <span><b class="tone-dot" aria-hidden="true"></b>{{ item.name }}</span>
          </label>
        </div>
      </fieldset>
      <label class="form-group">
        <span>日期</span>
        <input type="date" name="date" min="0001-01-01" max="9999-12-31" required :value="date" :disabled="saving" @change="changeDate">
      </label>
      <div class="time-fields">
        <div v-for="field in timeFields" :key="field.key" class="form-group" role="group" :aria-label="field.label">
          <span>{{ field.label }}</span>
          <div class="minute-picker">
            <select :aria-label="`${field.label}小时`" :name="`${field.key}-hour`" :value="timeParts[field.key].hour" :disabled="saving" @change="selectHour(field.key, $event)">
              <option v-for="hour in field.hours" :key="hour" :value="hour" :disabled="!allowedMinutes(field.key, hour).length">
                {{ String(hour).padStart(2, '0') }}
              </option>
            </select>
            <span aria-hidden="true">:</span>
            <select :aria-label="`${field.label}分钟`" :name="`${field.key}-minute`" :value="timeParts[field.key].minute" :disabled="saving || timeParts[field.key].hour === 24" @change="selectMinute(field.key, $event)">
              <option v-for="minute in minutes" :key="minute" :value="minute" :disabled="!timeAllowed(field.key, timeParts[field.key].hour * 60 + minute)">
                {{ String(minute).padStart(2, '0') }}
              </option>
            </select>
          </div>
        </div>
      </div>
      <div class="duration-row">
        <span>时长</span>
        <button v-for="duration in [30, 60]" :key="duration" type="button" class="planner-button" :disabled="saving || !endAllowed(start + duration)" @click="end = start + duration">
          {{ duration }} 分钟
        </button>
      </div>
      <label v-if="workday" class="exception-setting">
        <span><strong>本次允许占用工作时间</strong><small>09:30–11:30 / 13:00–18:00</small></span>
        <input v-model="allowWork" type="checkbox" name="exception" role="switch" :disabled="saving">
      </label>
      <p class="form-message" :class="{ warning: !canSave || workConflict || eventConflict }" role="status">{{ messages.join(' ') }}</p>
      <p v-if="error" class="form-message warning" role="alert">{{ error }}</p>
      <div class="sheet-actions">
        <button v-if="event" type="button" class="planner-button delete-button" :disabled="saving" @click="remove">
          {{ confirmingRemoval ? '确认删除' : '删除活动' }}
        </button>
        <button type="button" class="planner-button" :disabled="saving" @click="close">取消</button>
        <button type="submit" class="planner-button primary" :disabled="saving || !canSave">
          {{ saving ? '处理中…' : '保存活动' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
dialog.event-sheet {
  max-height: calc(100% - 20px);
  margin: auto;
  overflow: auto;
  color: var(--dp-ink);
}

dialog.event-sheet::backdrop {
  background: var(--dp-overlay);
}

.minute-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 3px;
  align-items: center;
}

.type-option {
  min-width: 0;
}

.type-option span {
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
