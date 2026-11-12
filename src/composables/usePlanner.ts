import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { PlannerCatalog } from '../domain/catalog'
import {
  isDateKey, monthDays, shiftDay, shiftMonth, todayInBeijing, validateEvent, weekDays,
  type DateRange, type EventDraft, type Habit, type PlannerData, type PlannerEvent,
  type PlannerMode, type RecordQuery, type TimeSelection,
} from '../domain/planner.ts'
import type { PlannerRepository } from '../repositories/plannerRepository'

export function usePlanner(
  repository: Readonly<Ref<PlannerRepository | null>>,
  catalog: Readonly<Ref<PlannerCatalog>>,
) {
  const today = ref(todayInBeijing())
  const selected = ref(today.value)
  const mode = ref<PlannerMode>('week')
  const calendarVisible = computed(() => mode.value === 'day' || mode.value === 'week' || mode.value === 'month')
  const recordQuery = ref<RecordQuery>({
    kind: 'activity', item: 'practice', start: shiftDay(today.value, -6), end: today.value,
  })
  const calendarRange = computed<DateRange>(() => {
    const days = mode.value === 'month' ? monthDays(selected.value) : weekDays(selected.value)
    return { start: days[0], end: days[days.length - 1] }
  })
  const range = computed(() => {
    if (mode.value === 'records') return recordQuery.value
    return calendarVisible.value ? calendarRange.value : null
  })
  const rangeKey = computed(() => JSON.stringify(range.value))
  const data = ref<PlannerData>({ events: [], checkins: [] })
  const loadedQuery = shallowRef<{ source: PlannerRepository; key: string } | null>(null)
  const checkinsReady = computed(() =>
    calendarVisible.value && loadedQuery.value !== null &&
    loadedQuery.value.source === repository.value && loadedQuery.value.key === rangeKey.value,
  )
  const loading = ref(false)
  const readError = ref('')
  const writeError = ref('')
  let readRequest = 0

  async function refresh(showLoading = true) {
    const request = ++readRequest
    const source = repository.value
    const query = range.value
    const key = rangeKey.value
    readError.value = ''
    if (source && showLoading) loading.value = true
    if (!source || !query || !isDateKey(query.start) || !isDateKey(query.end) || query.start > query.end) {
      loading.value = false
      return
    }
    const isCurrentRead = () => request === readRequest && source === repository.value && key === rangeKey.value
    try {
      const result = await source.read(query)
      if (isCurrentRead()) {
        data.value = result
        loadedQuery.value = { source, key }
      }
    } catch {
      if (isCurrentRead()) readError.value = '读取日程失败。请检查网络后重试。'
    } finally {
      if (isCurrentRead()) loading.value = false
    }
  }

  watch([repository, rangeKey], () => {
    loadedQuery.value = null
    data.value = { events: [], checkins: [] }
    writeError.value = ''
    void refresh()
  }, { immediate: true })

  function selectDay(date: string) {
    if (isDateKey(date)) selected.value = date
  }

  function openDay(date: string) {
    selectDay(date)
    mode.value = 'day'
  }

  function navigate(offset: number) {
    const next = mode.value === 'month'
      ? shiftMonth(selected.value, offset)
      : shiftDay(selected.value, offset * (mode.value === 'week' ? 7 : 1))
    selectDay(next)
  }

  const editor = shallowRef<{ id: string; event: PlannerEvent | null; selection?: TimeSelection } | null>(null)
  const editorEvents = shallowRef<PlannerEvent[] | null>(null)
  const editorError = ref('')
  const saving = ref(false)
  let editorRequest = 0

  function openEditor(event: PlannerEvent | null = null, selection?: TimeSelection) {
    if (editor.value) return
    editorEvents.value = null
    editorError.value = ''
    editor.value = { id: event?.id ?? crypto.randomUUID(), event, selection }
  }

  function planSelection(selection: TimeSelection) {
    selectDay(selection.date)
    openEditor(null, selection)
  }

  function closeEditor() {
    editorRequest++
    editor.value = null
  }

  async function loadEditorDate(date: string) {
    const request = ++editorRequest
    editorEvents.value = null
    const source = repository.value
    if (!source || !isDateKey(date) || (date >= calendarRange.value.start && date <= calendarRange.value.end)) return
    try {
      const result = await source.read({ start: date, end: date })
      if (request === editorRequest) editorEvents.value = result.events
    } catch {
      // Work-hour validation still applies when other events cannot be loaded.
    }
  }

  async function changeEvent(draft: EventDraft | null) {
    const source = repository.value
    const currentEditor = editor.value
    if (!source || !currentEditor || saving.value) return
    editorError.value = draft ? validateEvent(draft) : ''
    if (draft && !catalog.value.activities.some((item) => item.id === draft.activity)) {
      editorError.value = '请选择已配置的活动类型。'
    }
    if (editorError.value) return
    saving.value = true
    try {
      if (draft) {
        const event = { ...draft, id: currentEditor.id }
        await source.saveEvent(event, Boolean(currentEditor.event))
        if (source !== repository.value) return
        data.value.events = data.value.events.filter((row) => row.id !== event.id).concat(event)
      } else {
        await source.deleteEvent(currentEditor.id)
        if (source !== repository.value) return
        data.value.events = data.value.events.filter((row) => row.id !== currentEditor.id)
      }
      const previousRange = rangeKey.value
      if (draft) selectDay(draft.date)
      closeEditor()
      if (rangeKey.value === previousRange) void refresh(false)
    } catch (error) {
      if (source !== repository.value) return
      editorError.value = error instanceof Error && error.message.startsWith('这条活动')
        ? error.message
        : draft ? '保存活动失败，请重试。' : '删除活动失败，请重试。'
    } finally {
      saving.value = false
    }
  }

  const pendingChecks = ref(new Map<string, { date: string; habit: Habit; checked: boolean; token: symbol }>())
  const pendingHabits = computed(() =>
    [...pendingChecks.value.values()].filter(({ date }) => date === selected.value).map(({ habit }) => habit),
  )
  const shownCheckins = computed(() => {
    const items = data.value.checkins.filter((row) => !pendingChecks.value.has(row.date + ':' + row.habit))
    for (const { date, habit, checked } of pendingChecks.value.values()) {
      if (checked) items.push({ date, habit })
    }
    return items
  })

  async function changeCheckin(habit: Habit, checked: boolean) {
    const source = repository.value
    const date = selected.value
    const pendingKey = date + ':' + habit
    if (!source || !checkinsReady.value || date > today.value || pendingChecks.value.has(pendingKey)) return
    if (!catalog.value.habits.some((item) => item.id === habit && item.startDate <= date)) return
    writeError.value = ''
    const update = { date, habit, checked, token: Symbol() }
    pendingChecks.value.set(pendingKey, update)
    try {
      await source.setCheckin(date, habit, checked)
      if (source !== repository.value) return
      data.value.checkins = data.value.checkins.filter((row) => row.date !== date || row.habit !== habit)
      if (checked) data.value.checkins.push({ date, habit })
      void refresh(false)
    } catch {
      if (source === repository.value) writeError.value = '打卡保存失败，请重试。'
    } finally {
      if (pendingChecks.value.get(pendingKey)?.token === update.token) pendingChecks.value.delete(pendingKey)
    }
  }

  watch(repository, () => pendingChecks.value.clear())

  function updateToday() {
    today.value = todayInBeijing()
  }

  return {
    today, selected, mode, calendarVisible, recordQuery,
    data, loading, readError, writeError, checkinsReady, pendingHabits, shownCheckins,
    editor, editorEvents, editorError, saving,
    refresh, updateToday, selectDay, openDay, navigate,
    openEditor, planSelection, closeEditor, loadEditorDate, changeEvent, changeCheckin,
  }
}
