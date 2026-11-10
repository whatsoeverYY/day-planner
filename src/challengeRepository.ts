import type { SupabaseClient } from '@supabase/supabase-js'
import { isDateKey, todayInBeijing } from './planner'
import { validateChallenge, type Challenge, type ChallengeData } from './challenges'

export interface ChallengeRepository {
  read(): Promise<ChallengeData>
  create(challenge: Challenge): Promise<void>
  remove(id: string): Promise<void>
  setCheckin(id: string, date: string, checked: boolean): Promise<void>
}

const localKey = 'day-planner.challenges.v1'
const pageSize = 500

function getLocalData(): ChallengeData {
  const stored = localStorage.getItem(localKey)
  if (!stored) return { challenges: [], checkins: [] }
  const data = JSON.parse(stored) as ChallengeData
  if (!Array.isArray(data.challenges) || !Array.isArray(data.checkins)) {
    throw new Error('无法读取本机的挑战数据。')
  }
  return data
}

function normalizedChallenge(challenge: Challenge) {
  const error = validateChallenge(challenge)
  if (error) throw new Error(error)
  return { ...challenge, title: challenge.title.trim() }
}

function validateCheckinDate(date: string) {
  if (!isDateKey(date)) throw new Error('请选择有效的打卡日期。')
  if (date > todayInBeijing()) throw new Error('到当天后可以打卡。')
}

export const localChallengeRepository: ChallengeRepository = {
  async read() {
    return getLocalData()
  },
  async create(challenge) {
    const normalized = normalizedChallenge(challenge)
    const data = getLocalData()
    if (data.challenges.some(({ id }) => id === normalized.id)) return
    data.challenges.push(normalized)
    localStorage.setItem(localKey, JSON.stringify(data))
  },
  async remove(id) {
    const data = getLocalData()
    data.challenges = data.challenges.filter((challenge) => challenge.id !== id)
    data.checkins = data.checkins.filter((checkin) => checkin.challengeId !== id)
    localStorage.setItem(localKey, JSON.stringify(data))
  },
  async setCheckin(id, date, checked) {
    validateCheckinDate(date)
    const data = getLocalData()
    const challenge = data.challenges.find((row) => row.id === id)
    if (checked) {
      if (!challenge) throw new Error('挑战已删除，请刷新后重试。')
      if (date < challenge.startDate) throw new Error('请选择挑战开始当天或之后的日期。')
    }
    data.checkins = data.checkins.filter((row) => row.challengeId !== id || row.date !== date)
    if (checked) data.checkins.push({ challengeId: id, date })
    localStorage.setItem(localKey, JSON.stringify(data))
  },
}

interface ChallengeRow {
  id: string
  title: string
  target_days: number
  start_date: string
}

interface CheckinRow {
  challenge_id: string
  checkin_date: string
}

async function collectRows<Row>(fetchPage: (after: Row | undefined) => PromiseLike<{
  data: Row[] | null
  error: unknown
}>) {
  const result: Row[] = []
  let cursor: Row | undefined
  while (true) {
    const { data, error } = await fetchPage(cursor)
    if (error) throw error
    if (!data?.length) return result
    result.push(...data)
    cursor = data.at(-1)
  }
}

export function cloudChallengeRepository(client: SupabaseClient, userId: string): ChallengeRepository {
  return {
    async read() {
      const [challenges, checkins] = await Promise.all([
        collectRows<ChallengeRow>((cursor) => {
          let query = client.from('planner_challenges')
            .select('id,title,target_days,start_date')
            .eq('user_id', userId)
            .order('id')
            .limit(pageSize)
          if (cursor) query = query.gt('id', cursor.id)
          return query
        }),
        collectRows<CheckinRow>((cursor) => {
          let query = client.from('planner_challenge_checkins')
            .select('challenge_id,checkin_date')
            .eq('user_id', userId)
            .order('challenge_id')
            .order('checkin_date')
            .limit(pageSize)
          if (cursor) {
            const { challenge_id: id, checkin_date: date } = cursor
            query = query.or(`challenge_id.gt.${id},and(challenge_id.eq.${id},checkin_date.gt.${date})`)
          }
          return query
        }),
      ])
      return {
        challenges: challenges.map((row) => ({
          id: row.id,
          title: row.title,
          targetDays: row.target_days,
          startDate: row.start_date,
        })),
        checkins: checkins.map((row) => ({ challengeId: row.challenge_id, date: row.checkin_date })),
      }
    },
    async create(challenge) {
      const { id, title, targetDays, startDate } = normalizedChallenge(challenge)
      const { error } = await client.from('planner_challenges').upsert({
        id, user_id: userId, title, target_days: targetDays, start_date: startDate,
      }, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
    },
    async remove(id) {
      const { error } = await client.from('planner_challenges').delete().eq('user_id', userId).eq('id', id)
      if (error) throw error
    },
    async setCheckin(id, date, checked) {
      validateCheckinDate(date)
      const table = client.from('planner_challenge_checkins')
      const { error } = checked
        ? await table.upsert({ user_id: userId, challenge_id: id, checkin_date: date }, {
            onConflict: 'user_id,challenge_id,checkin_date',
            ignoreDuplicates: true,
          })
        : await table.delete().eq('user_id', userId).eq('challenge_id', id).eq('checkin_date', date)
      if (error) throw error
    },
  }
}
