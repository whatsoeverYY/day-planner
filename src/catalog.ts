export const ACTIVITY_TONES = {
  purple: '淡紫',
  blue: '淡蓝',
  orange: '浅橙',
  pink: '淡粉',
  teal: '浅青',
  green: '浅绿',
  yellow: '浅黄',
} as const

export type ActivityTone = keyof typeof ACTIVITY_TONES
export const MAX_ITEM_NAME_LENGTH = 80

export interface ActivityDefinition {
  id: string
  name: string
  tone: ActivityTone
}

export interface HabitDefinition {
  id: string
  name: string
  startDate: string
}

export interface PlannerCatalog {
  activities: ActivityDefinition[]
  habits: HabitDefinition[]
}

export type CatalogChange =
  | { kind: 'activity'; id?: string; name: string; tone: ActivityTone }
  | { kind: 'habit'; id?: string; name: string }

export function defaultCatalog(): PlannerCatalog {
  return {
    activities: [
      { id: 'piano', name: '钢琴课', tone: 'purple' },
      { id: 'practice', name: '钢琴练习', tone: 'blue' },
      { id: 'strength', name: '无氧训练', tone: 'orange' },
    ],
    habits: [
      { id: 'steps', name: '6000 步', startDate: '0001-01-01' },
      { id: 'reading', name: '阅读', startDate: '0001-01-01' },
    ],
  }
}

export function validateItemName(name: string) {
  const length = [...name.trim()].length
  return length >= 1 && length <= MAX_ITEM_NAME_LENGTH
    ? ''
    : `名称须为 1–${MAX_ITEM_NAME_LENGTH} 个字符。`
}

export function isActivityTone(tone: string): tone is ActivityTone {
  return Object.hasOwn(ACTIVITY_TONES, tone)
}
