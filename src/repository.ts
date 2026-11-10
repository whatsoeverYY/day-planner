import type { SupabaseClient } from '@supabase/supabase-js'
import { localCatalogRepository } from './catalogRepository'
import {
  isDateKey,
  todayInBeijing,
  validateEvent,
  type DateRange,
  type EventDraft,
  type Habit,
  type PlannerData,
  type PlannerEvent,
  type RecordQuery,
} from './planner'

export interface PlannerRepository {
  read(range: DateRange | RecordQuery): Promise<PlannerData>
  saveEvent(event: PlannerEvent, editing: boolean): Promise<void>
  deleteEvent(id: string): Promise<void>
  setCheckin(date: string, habit: Habit, checked: boolean): Promise<void>
}

const localKey = 'day-planner.local.v1'
const pageSize = 500

function inRange(date: string, range: DateRange) {
  return date >= range.start && date <= range.end
}

function validateDraft(event: EventDraft) {
  const error = validateEvent(event)
  if (error) throw new Error(error)
}

function validateCheckin(date: string) {
  if (!isDateKey(date)) throw new Error('请选择有效的打卡日期。')
  if (date > todayInBeijing()) throw new Error('到当天后可以打卡。')
}

function getLocalData(): PlannerData {
  const stored = localStorage.getItem(localKey)
  if (!stored) return { events: [], checkins: [] }
  const data = JSON.parse(stored) as PlannerData
  if (!Array.isArray(data.events) || !Array.isArray(data.checkins)) {
    throw new Error('无法读取本机的日程数据。')
  }
  return data
}

export const localRepository: PlannerRepository = {
  async read(range) {
    const data = getLocalData()
    const query = 'kind' in range ? range : undefined
    return {
      events: data.events.filter((event) =>
        inRange(event.date, range) && (!query || (query.kind === 'activity' && event.activity === query.item)),
      ),
      checkins: data.checkins.filter((checkin) =>
        inRange(checkin.date, range) && (!query || (query.kind === 'habit' && checkin.habit === query.item)),
      ),
    }
  },
  async saveEvent(event, editing) {
    validateDraft(event)
    const { activities } = await localCatalogRepository.read()
    if (!activities.some(({ id }) => id === event.activity)) throw new Error('活动类型不存在。')
    const data = getLocalData()
    if (editing && !data.events.some((existing) => existing.id === event.id)) {
      throw new Error('这条活动已删除，请关闭表单后重试。')
    }
    data.events = data.events.filter((existing) => existing.id !== event.id).concat(event)
    localStorage.setItem(localKey, JSON.stringify(data))
  },
  async deleteEvent(id) {
    const data = getLocalData()
    data.events = data.events.filter((event) => event.id !== id)
    localStorage.setItem(localKey, JSON.stringify(data))
  },
  async setCheckin(date, habit, checked) {
    if (checked) {
      validateCheckin(date)
      const { habits } = await localCatalogRepository.read()
      if (!habits.some((item) => item.id === habit && item.startDate <= date)) {
        throw new Error('该项目在所选日期尚未开始。')
      }
    }
    const data = getLocalData()
    data.checkins = data.checkins.filter((row) => row.date !== date || row.habit !== habit)
    if (checked) data.checkins.push({ date, habit })
    localStorage.setItem(localKey, JSON.stringify(data))
  },
}

interface EventRow {
  id: string
  event_date: string
  activity: PlannerEvent['activity']
  start_minute: number
  end_minute: number
  work_exception: boolean
}

interface CheckinRow {
  checkin_date: string
  habit: Habit
}

async function collectRows<Row>(fetch: (offset: number) => PromiseLike<{
  data: Row[] | null
  error: unknown
}>) {
  const result: Row[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetch(offset)
    if (error) throw error
    if (!data) return result
    result.push(...data)
    if (data.length < pageSize) return result
  }
}

export function cloudRepository(client: SupabaseClient, userId: string): PlannerRepository {
  return {
    async read(range) {
      const selection = 'kind' in range ? range : undefined
      const eventRows = !selection || selection.kind === 'activity'
        ? collectRows<EventRow>((offset) => {
            let query = client.from('planner_events')
              .select('id,event_date,activity,start_minute,end_minute,work_exception')
              .eq('user_id', userId)
              .gte('event_date', range.start)
              .lte('event_date', range.end)
            if (selection) query = query.eq('activity', selection.item)
            return query.order('event_date').order('id').range(offset, offset + pageSize - 1)
          })
        : []
      const checkinRows = !selection || selection.kind === 'habit'
        ? collectRows<CheckinRow>((offset) => {
            let query = client.from('planner_checkins')
              .select('checkin_date,habit')
              .eq('user_id', userId)
              .gte('checkin_date', range.start)
              .lte('checkin_date', range.end)
            if (selection) query = query.eq('habit', selection.item)
            return query.order('checkin_date').order('habit').range(offset, offset + pageSize - 1)
          })
        : []
      const [events, checkins] = await Promise.all([eventRows, checkinRows])
      return {
        events: events.map((row) => ({
          id: row.id,
          date: row.event_date,
          activity: row.activity,
          start: row.start_minute,
          end: row.end_minute,
          workException: row.work_exception,
        })),
        checkins: checkins.map((row) => ({ date: row.checkin_date, habit: row.habit })),
      }
    },
    async saveEvent(event, editing) {
      validateDraft(event)
      const fields = {
        event_date: event.date,
        activity: event.activity,
        start_minute: event.start,
        end_minute: event.end,
        work_exception: event.workException,
      }
      if (!editing) {
        const { error } = await client.from('planner_events')
          .insert({ id: event.id, user_id: userId, ...fields })
        if (!error) return
        // A connection can drop after an insert reaches the database.
        if (error.code !== '23505') throw error
      }
      const { data, error } = await client.from('planner_events')
        .update(fields)
        .eq('user_id', userId)
        .eq('id', event.id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('这条活动已删除，请关闭表单后重试。')
    },
    async deleteEvent(id) {
      const { error } = await client.from('planner_events').delete().eq('user_id', userId).eq('id', id)
      if (error) throw error
    },
    async setCheckin(date, habit, checked) {
      if (checked) validateCheckin(date)
      const table = client.from('planner_checkins')
      const { error } = checked
        ? await table.upsert({ user_id: userId, checkin_date: date, habit }, {
            onConflict: 'user_id,checkin_date,habit',
            ignoreDuplicates: true,
          })
        : await table.delete().eq('user_id', userId).eq('checkin_date', date).eq('habit', habit)
      if (error) throw error
    },
  }
}
