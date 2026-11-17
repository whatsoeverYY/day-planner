import { ref, shallowRef, watch, type Ref } from 'vue'
import type { ChallengeData, ChallengeDraft, NewChallenge } from '../domain/challenges'
import type { ChallengeRepository } from '../repositories/challengeRepository'
import type { PlannerRepository } from '../repositories/plannerRepository'

interface ChallengeSources {
  challenges: ChallengeRepository
  planner: Pick<PlannerRepository, 'read'>
}

const emptyData = (): ChallengeData => ({ challenges: [], checkins: [] })

function missingMigration(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'PGRST205' || error.code === '42P01' ||
    error.code === 'PGRST204' || error.code === '42703'
}

async function readChallengeData(source: ChallengeSources, today: string): Promise<ChallengeData> {
  const { challenges, checkins: manualCheckins } = await source.challenges.read()
  const startByHabit = new Map<string, string>()
  const legacyIds = new Set<string>()
  for (const { id, habitId, startDate } of challenges) {
    if (!habitId) {
      legacyIds.add(id)
      continue
    }
    const earliest = startByHabit.get(habitId)
    if (startDate <= today && (!earliest || startDate < earliest)) startByHabit.set(habitId, startDate)
  }

  const dailyCheckins = new Map(await Promise.all([...startByHabit].map(async ([habitId, start]) => {
    const { checkins } = await source.planner.read({ kind: 'habit', item: habitId, start, end: today })
    return [habitId, checkins] as const
  })))

  const checkins = manualCheckins.filter(({ challengeId }) => legacyIds.has(challengeId))
  for (const { id, habitId, startDate } of challenges) {
    if (!habitId) continue
    for (const { date } of dailyCheckins.get(habitId) ?? []) {
      if (date >= startDate) checkins.push({ challengeId: id, date })
    }
  }
  return { challenges, checkins }
}

export function useChallenges(
  repositories: Readonly<Ref<ChallengeSources | null>>,
  visible: Readonly<Ref<boolean>>,
  today: Readonly<Ref<string>>,
  checkinRevision: Readonly<Ref<number>>,
) {
  const data = shallowRef(emptyData())
  const loading = ref(false)
  const error = ref('')
  const mutationError = ref('')
  const busy = ref(false)
  let readRequest = 0
  let pendingCreate: NewChallenge | null = null

  async function refresh(showLoading = true) {
    const source = repositories.value
    const request = ++readRequest
    if (!source || !visible.value) {
      loading.value = false
      return
    }
    if (showLoading) loading.value = true
    error.value = ''
    const isCurrent = () => request === readRequest && source === repositories.value && visible.value
    try {
      const result = await readChallengeData(source, today.value)
      if (isCurrent()) data.value = result
    } catch (cause) {
      if (!isCurrent()) return
      error.value = missingMigration(cause)
        ? '请先在 Supabase 中运行挑战功能的数据库迁移。'
        : '读取挑战失败，请重试。'
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  watch(repositories, () => {
    data.value = emptyData()
    mutationError.value = ''
    pendingCreate = null
  })
  watch([repositories, visible], () => void refresh(), { immediate: true })
  watch([today, checkinRevision], () => {
    if (visible.value) void refresh(false)
  })

  async function mutate(
    perform: (source: ChallengeRepository) => Promise<void>,
    update: (previous: ChallengeData) => ChallengeData,
    failureMessage: string,
  ) {
    const source = repositories.value
    if (!source || busy.value) return false
    busy.value = true
    mutationError.value = ''
    try {
      await perform(source.challenges)
      if (source !== repositories.value) return false
      data.value = update(data.value)
      void refresh(false)
      return true
    } catch (cause) {
      if (source === repositories.value) {
        mutationError.value = missingMigration(cause)
          ? '请先在 Supabase 中运行挑战功能的数据库迁移。'
          : failureMessage
      }
      return false
    } finally {
      busy.value = false
    }
  }

  async function create(draft: ChallengeDraft) {
    if (busy.value || !repositories.value) return
    const title = draft.title.trim()
    const retry = pendingCreate?.habitId === draft.habitId && pendingCreate.title === title &&
      pendingCreate.startDate === draft.startDate && pendingCreate.targetDays === draft.targetDays
    const challenge = retry && pendingCreate
      ? pendingCreate
      : { ...draft, title, id: crypto.randomUUID() }
    pendingCreate = challenge
    const saved = await mutate(
      (source) => source.create(challenge),
      (previous) => ({
        ...previous,
        challenges: [challenge, ...previous.challenges.filter((row) => row.id !== challenge.id)],
      }),
      '创建挑战失败，请重试。',
    )
    if (saved) pendingCreate = null
  }

  function remove(id: string) {
    return mutate(
      (source) => source.remove(id),
      (previous) => ({
        challenges: previous.challenges.filter((row) => row.id !== id),
        checkins: previous.checkins.filter((row) => row.challengeId !== id),
      }),
      '删除挑战失败，请重试。',
    )
  }

  function check(id: string, date: string, checked: boolean) {
    if (!data.value.challenges.some((row) => row.id === id && !row.habitId)) return
    return mutate(
      (source) => source.setCheckin(id, date, checked),
      (previous) => {
        const checkins = previous.checkins.filter((row) => row.challengeId !== id || row.date !== date)
        if (checked) checkins.push({ challengeId: id, date })
        return { ...previous, checkins }
      },
      '保存挑战打卡失败，请重试。',
    )
  }

  return { data, loading, error, mutationError, busy, refresh, create, remove, check }
}
