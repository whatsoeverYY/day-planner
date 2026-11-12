import { ref, shallowRef, watch, type Ref } from 'vue'
import type { Challenge, ChallengeData, ChallengeDraft } from '../domain/challenges'
import type { ChallengeRepository } from '../repositories/challengeRepository'

const emptyData = (): ChallengeData => ({ challenges: [], checkins: [] })

function missingMigration(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'PGRST205' || error.code === '42P01'
}

export function useChallenges(repository: Ref<ChallengeRepository | null>, visible: Ref<boolean>) {
  const data = shallowRef(emptyData())
  const loading = ref(false)
  const error = ref('')
  const mutationError = ref('')
  const busy = ref(false)
  let readRequest = 0
  let pendingCreate: Challenge | null = null

  async function refresh(showLoading = true) {
    const source = repository.value
    const request = ++readRequest
    if (!source || !visible.value) {
      loading.value = false
      return
    }
    if (showLoading) loading.value = true
    error.value = ''
    try {
      const result = await source.read()
      if (request === readRequest) data.value = result
    } catch (cause) {
      if (request !== readRequest) return
      error.value = missingMigration(cause)
        ? '请先在 Supabase 中运行挑战功能的数据库迁移。'
        : '读取挑战失败，请重试。'
    } finally {
      if (request === readRequest) loading.value = false
    }
  }

  watch(repository, () => {
    data.value = emptyData()
    mutationError.value = ''
    pendingCreate = null
  })
  watch([repository, visible], () => void refresh(), { immediate: true })

  async function mutate(
    perform: (source: ChallengeRepository) => Promise<void>,
    update: (previous: ChallengeData) => ChallengeData,
    failureMessage: string,
  ) {
    const source = repository.value
    if (!source || busy.value) return false
    busy.value = true
    mutationError.value = ''
    try {
      await perform(source)
      if (source !== repository.value) return false
      data.value = update(data.value)
      void refresh(false)
      return true
    } catch (cause) {
      if (source === repository.value) {
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
    if (busy.value || !repository.value) return
    const title = draft.title.trim()
    const retry = pendingCreate?.title === title && pendingCreate.startDate === draft.startDate &&
      pendingCreate.targetDays === draft.targetDays
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
