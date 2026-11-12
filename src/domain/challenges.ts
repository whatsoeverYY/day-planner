import { isDateKey, shiftDay } from './planner.ts'

export const MAX_CHALLENGE_DAYS = 3650
export const MAX_CHALLENGE_TITLE_LENGTH = 80

export interface ChallengeDraft {
  title: string
  targetDays: number
  startDate: string
}

export interface Challenge extends ChallengeDraft {
  id: string
}

export interface ChallengeCheckin {
  challengeId: string
  date: string
}

export interface ChallengeData {
  challenges: Challenge[]
  checkins: ChallengeCheckin[]
}

export function validateChallenge(draft: ChallengeDraft) {
  const titleLength = [...draft.title.trim()].length
  if (!titleLength || titleLength > MAX_CHALLENGE_TITLE_LENGTH) {
    return `挑战名称须为 1–${MAX_CHALLENGE_TITLE_LENGTH} 个字符。`
  }
  if (!Number.isInteger(draft.targetDays) || draft.targetDays < 1 || draft.targetDays > MAX_CHALLENGE_DAYS) {
    return `目标天数须为 1–${MAX_CHALLENGE_DAYS} 的整数。`
  }
  if (!isDateKey(draft.startDate)) return '请选择有效的开始日期。'
  return ''
}

export function challengeProgress(challenge: Challenge, dates: readonly string[], today: string) {
  const completed = [...new Set(dates)]
    .filter((date) => date >= challenge.startDate && date <= today && isDateKey(date))
    .sort()
  let previous = ''
  let streak = 0
  let longest = 0
  for (const date of completed) {
    streak = previous && shiftDay(previous, 1) === date ? streak + 1 : 1
    longest = Math.max(longest, streak)
    previous = date
  }
  // A user can still complete today's check-in before midnight in Beijing.
  const current = previous === today || previous === shiftDay(today, -1) ? streak : 0
  return { current, longest, complete: longest >= challenge.targetDays }
}
