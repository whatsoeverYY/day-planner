import { ref, shallowRef, watch, type Ref } from 'vue'
import type { CatalogRepository } from './catalogRepository'
import { defaultCatalog, validateItemName, type CatalogChange } from './catalog'
import { todayInBeijing } from './planner'

const migrationRequired = '请先在 Supabase 中运行活动和打卡项目的配置迁移。'

function missingMigration(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error &&
    (error.code === 'PGRST205' || error.code === '42P01')
}

export function useCatalog(repository: Ref<CatalogRepository | null>) {
  const data = shallowRef(defaultCatalog())
  const loading = ref(false)
  const error = ref('')
  const mutationError = ref('')
  const busy = ref(false)
  let readRequest = 0
  let pending: { change: CatalogChange; id: string; startDate: string } | null = null

  async function refresh(showLoading = true) {
    const source = repository.value
    const request = ++readRequest
    if (!source) {
      loading.value = false
      return
    }
    if (showLoading) {
      loading.value = true
      error.value = ''
    }
    try {
      const result = await source.read()
      if (request === readRequest) {
        data.value = result
        error.value = ''
      }
    } catch (cause) {
      if (request === readRequest) {
        error.value = missingMigration(cause) ? migrationRequired : '读取配置失败，请重试。'
      }
    } finally {
      if (request === readRequest) loading.value = false
    }
  }

  watch(repository, () => {
    data.value = defaultCatalog()
    error.value = ''
    mutationError.value = ''
    pending = null
    void refresh()
  }, { immediate: true })

  async function save(change: CatalogChange) {
    const source = repository.value
    if (!source || busy.value) return
    mutationError.value = validateItemName(change.name)
    if (mutationError.value) return

    const name = change.name.trim()
    const editing = Boolean(change.id)
    const samePending = pending?.change.kind === change.kind && pending.change.name === name &&
      (change.kind === 'habit' || (pending.change.kind === 'activity' && pending.change.tone === change.tone))
    const proposal = !editing && samePending && pending
      ? pending
      : { change: { ...change, name }, id: change.id ?? crypto.randomUUID(), startDate: todayInBeijing() }
    if (!editing) pending = proposal
    busy.value = true
    try {
      if (change.kind === 'activity') {
        const activity = { id: proposal.id, name, tone: change.tone }
        await source.saveActivity(activity, editing)
        if (source !== repository.value) return
        const activities = data.value.activities
        data.value = {
          ...data.value,
          activities: editing
            ? activities.map((item) => item.id === activity.id ? activity : item)
            : [...activities.filter((item) => item.id !== activity.id), activity],
        }
      } else {
        const current = data.value.habits.find((item) => item.id === proposal.id)
        const habit = { id: proposal.id, name, startDate: current?.startDate ?? proposal.startDate }
        await source.saveHabit(habit, editing)
        if (source !== repository.value) return
        const habits = data.value.habits
        data.value = {
          ...data.value,
          habits: editing
            ? habits.map((item) => item.id === habit.id ? habit : item)
            : [...habits.filter((item) => item.id !== habit.id), habit],
        }
      }
      if (!editing) pending = null
      void refresh(false)
    } catch (cause) {
      if (source === repository.value) {
        mutationError.value = missingMigration(cause) ? migrationRequired : '保存配置失败，请重试。'
      }
    } finally {
      busy.value = false
    }
  }

  return { data, loading, error, mutationError, busy, refresh, save }
}
