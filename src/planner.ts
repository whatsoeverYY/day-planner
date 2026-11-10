export type Activity = string
export type Habit = string
export type CalendarMode = 'day' | 'week' | 'month'
export type PlannerMode = CalendarMode | 'records' | 'challenges' | 'catalog'

export interface TimeSelection {
  date: string
  start: number
  end: number
}

export interface EventDraft {
  date: string
  activity: Activity
  start: number
  end: number
  workException: boolean
}

export interface PlannerEvent extends EventDraft {
  id: string
}

export interface Checkin {
  date: string
  habit: Habit
}

export interface DateRange {
  start: string
  end: string
}

export interface RecordQuery extends DateRange {
  kind: 'activity' | 'habit'
  item: string
}

export interface PlannerData {
  events: PlannerEvent[]
  checkins: Checkin[]
}

export const WORK_BLOCKS = [[570, 690], [780, 1080]] as const
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

const dayMs = 86_400_000
const beijingDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function dateFrom(key: string) {
  return new Date(key + 'T00:00:00Z')
}

function dateKey(date: Date) {
  return date.toISOString().split('T')[0]
}

export function todayInBeijing(now = new Date()) {
  const parts = beijingDate.formatToParts(now)
  return ['year', 'month', 'day']
    .map((unit) => parts.find((part) => part.type === unit)!.value.padStart(unit === 'year' ? 4 : 2, '0'))
    .join('-')
}

export function isDateKey(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith('0000')) return false
  const date = dateFrom(key)
  return Number.isFinite(date.getTime()) && dateKey(date) === key
}

export function weekday(key: string) {
  return dateFrom(key).getUTCDay()
}

export function shiftDay(key: string, offset: number) {
  return dateKey(new Date(dateFrom(key).getTime() + offset * dayMs))
}

export function shiftMonth(key: string, offset: number) {
  const date = dateFrom(key)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + offset)
  const last = new Date(date)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  date.setUTCDate(Math.min(day, last.getUTCDate()))
  return dateKey(date)
}

export function dayCount(start: string, end: string) {
  return Math.round((dateFrom(end).getTime() - dateFrom(start).getTime()) / dayMs) + 1
}

export function weekDays(key: string) {
  const monday = shiftDay(key, -((weekday(key) + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index)).filter(isDateKey)
}

export function monthDays(key: string) {
  const first = key.slice(0, 7) + '-01'
  const lastDay = dateFrom(first)
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0)
  const start = weekDays(first)[0]
  const end = weekDays(dateKey(lastDay)).at(-1)!
  return Array.from({ length: dayCount(start, end) }, (_, index) => shiftDay(start, index))
}

export function dayLabel(key: string) {
  const date = dateFrom(key)
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`
}

export function clock(minutes: number) {
  return [Math.floor(minutes / 60), minutes % 60]
    .map((number) => String(number).padStart(2, '0'))
    .join(':')
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return `${remainder} 分钟`
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`
}

export function isWorkday(key: string) {
  const day = weekday(key)
  return day >= 1 && day <= 5
}

export function overlapsWork(date: string, start: number, end: number) {
  return end > start && isWorkday(date) && WORK_BLOCKS.some(([from, to]) => start < to && end > from)
}

export function validateEvent(draft: EventDraft) {
  if (!isDateKey(draft.date)) return '请选择有效日期。'
  if (!draft.activity.trim()) return '请选择活动类型。'
  if (!Number.isInteger(draft.start) || !Number.isInteger(draft.end) ||
      draft.start < 0 || draft.end > 1440 || draft.end <= draft.start) {
    return '请选择当天的有效起止时间。'
  }
  if (overlapsWork(draft.date, draft.start, draft.end) !== draft.workException) {
    return '请调整时间或开启本次工作时段例外。'
  }
  return ''
}
