import type { SupabaseClient } from '@supabase/supabase-js'
import {
  defaultCatalog,
  isActivityTone,
  validateItemName,
  type ActivityDefinition,
  type ActivityTone,
  type HabitDefinition,
  type PlannerCatalog,
} from './catalog'
import { todayInBeijing } from './planner'

export interface CatalogRepository {
  read(): Promise<PlannerCatalog>
  saveActivity(definition: ActivityDefinition, editing: boolean): Promise<void>
  saveHabit(definition: HabitDefinition, editing: boolean): Promise<void>
}

const localKey = 'day-planner.catalog.v1'

function getLocalCatalog(): PlannerCatalog {
  const stored = localStorage.getItem(localKey)
  if (!stored) return defaultCatalog()
  const catalog = JSON.parse(stored) as PlannerCatalog
  if (!catalog || !Array.isArray(catalog.activities) || !Array.isArray(catalog.habits)) {
    throw new Error('无法读取本机的项目配置。')
  }
  return catalog
}

function validatedName(name: string) {
  const error = validateItemName(name)
  if (error) throw new Error(error)
  return name.trim()
}

function validatedTone(tone: ActivityTone) {
  if (!isActivityTone(tone)) throw new Error('请选择活动颜色。')
  return tone
}

function saveLocalItem<Item extends { id: string }>(
  items: Item[],
  definition: Item,
  editing: boolean,
  applyEdit: (previous: Item) => Item,
) {
  const index = items.findIndex(({ id }) => id === definition.id)
  if (editing) {
    if (index === -1) throw new Error('找不到这个项目，请刷新后重试。')
    items[index] = applyEdit(items[index])
  } else if (index === -1) {
    items.push(definition)
  }
}

export const localCatalogRepository: CatalogRepository = {
  async read() {
    return getLocalCatalog()
  },
  async saveActivity(definition, editing) {
    const name = validatedName(definition.name)
    const tone = validatedTone(definition.tone)
    const catalog = getLocalCatalog()
    saveLocalItem(catalog.activities, { ...definition, name, tone }, editing, (item) => ({ ...item, name, tone }))
    localStorage.setItem(localKey, JSON.stringify(catalog))
  },
  async saveHabit(definition, editing) {
    const name = validatedName(definition.name)
    const catalog = getLocalCatalog()
    const habit = { id: definition.id, name, startDate: todayInBeijing() }
    saveLocalItem(catalog.habits, habit, editing, (item) => ({ ...item, name }))
    localStorage.setItem(localKey, JSON.stringify(catalog))
  },
}

interface CatalogRow {
  id: string
  name: string
  created_at: string
}

interface ActivityRow extends CatalogRow {
  tone: ActivityTone
}

interface HabitRow extends CatalogRow {
  start_date: string
}

async function collectRows<Row extends CatalogRow>(
  fetchPage: (after: string | undefined) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  defaults: { id: string }[],
) {
  const result: Row[] = []
  let cursor: string | undefined
  while (true) {
    const { data, error } = await fetchPage(cursor)
    if (error) throw error
    if (!data?.length) break
    result.push(...data)
    cursor = data.at(-1)?.id
  }
  const defaultOrder = new Map(defaults.map(({ id }, index) => [id, index]))
  return result.sort((a, b) =>
    (defaultOrder.get(a.id) ?? defaults.length) - (defaultOrder.get(b.id) ?? defaults.length)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id),
  )
}

export function cloudCatalogRepository(client: SupabaseClient, userId: string): CatalogRepository {
  return {
    async read() {
      const defaults = defaultCatalog()
      const [activities, habits] = await Promise.all([
        collectRows<ActivityRow>((cursor) => {
          let query = client.from('planner_activity_types')
            .select('id,name,tone,created_at')
            .eq('user_id', userId)
            .order('id')
            .limit(500)
          if (cursor) query = query.gt('id', cursor)
          return query
        }, defaults.activities),
        collectRows<HabitRow>((cursor) => {
          let query = client.from('planner_habit_types')
            .select('id,name,start_date,created_at')
            .eq('user_id', userId)
            .order('id')
            .limit(500)
          if (cursor) query = query.gt('id', cursor)
          return query
        }, defaults.habits),
      ])
      return {
        activities: activities.map(({ id, name, tone }) => ({ id, name, tone })),
        habits: habits.map(({ id, name, start_date }) => ({ id, name, startDate: start_date })),
      }
    },
    async saveActivity({ id, name, tone }, editing) {
      const details = { name: validatedName(name), tone: validatedTone(tone) }
      const table = client.from('planner_activity_types')
      const { error, data } = editing
        ? await table.update(details).eq('user_id', userId).eq('id', id).select('id').maybeSingle()
        : await table.upsert({ user_id: userId, id, ...details }, { onConflict: 'user_id,id', ignoreDuplicates: true })
      if (error) throw error
      if (editing && !data) throw new Error('找不到这个活动，请刷新后重试。')
    },
    async saveHabit({ id, name }, editing) {
      const details = { name: validatedName(name) }
      const table = client.from('planner_habit_types')
      const { error, data } = editing
        ? await table.update(details).eq('user_id', userId).eq('id', id).select('id').maybeSingle()
        : await table.upsert({ user_id: userId, id, ...details }, { onConflict: 'user_id,id', ignoreDuplicates: true })
      if (error) throw error
      if (editing && !data) throw new Error('找不到这个打卡项目，请刷新后重试。')
    },
  }
}
