import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { effectScope, nextTick, shallowRef } from 'vue'
import { usePlanner } from '../src/composables/usePlanner.ts'
import { defaultCatalog } from '../src/domain/catalog.ts'
import { shiftDay, type DateRange, type Habit, type PlannerData, type RecordQuery } from '../src/domain/planner.ts'
import type { PlannerRepository } from '../src/repositories/plannerRepository.ts'

function pendingRead(query: DateRange | RecordQuery) {
  let resolve!: (value: PlannerData) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<PlannerData>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { query, promise, resolve, reject }
}

function setup(t: TestContext) {
  const reads: ReturnType<typeof pendingRead>[] = []
  const writes: { date: string; habit: Habit; checked: boolean }[] = []
  const repository: PlannerRepository = {
    read(query) {
      const request = pendingRead(query)
      reads.push(request)
      return request.promise
    },
    async saveEvent() {},
    async deleteEvent() {},
    async setCheckin(date, habit, checked) {
      writes.push({ date, habit, checked })
    },
  }
  const source = shallowRef<PlannerRepository | null>(repository)
  const scope = effectScope()
  t.after(() => scope.stop())
  const planner = scope.run(() => usePlanner(source, shallowRef(defaultCatalog())))!
  return { planner, repository, source, reads, writes }
}

test('check-ins require a successful range read and stay usable during a same-range refresh', async (t) => {
  const { planner, reads, writes } = setup(t)
  assert.equal(planner.checkinsReady.value, false)
  await planner.changeCheckin('steps', true)
  assert.deepEqual(writes, [])

  reads[0].reject(new Error('offline'))
  await nextTick()
  assert.match(planner.readError.value, /读取日程失败/)
  assert.equal(planner.checkinsReady.value, false)
  await planner.changeCheckin('steps', true)
  assert.deepEqual(writes, [])

  const retry = planner.refresh()
  reads[1].resolve({ events: [], checkins: [] })
  await retry
  assert.equal(planner.checkinsReady.value, true)

  const date = planner.selected.value
  await planner.changeCheckin('steps', true)
  assert.deepEqual(writes, [{ date, habit: 'steps', checked: true }])
  assert.equal(planner.checkinsReady.value, true)
  assert.deepEqual(planner.shownCheckins.value, [{ date, habit: 'steps' }])

  reads[2].reject(new Error('offline again'))
  await nextTick()
  assert.equal(planner.checkinsReady.value, true)
  assert.deepEqual(planner.shownCheckins.value, [{ date, habit: 'steps' }])

  await planner.changeCheckin('steps', false)
  assert.deepEqual(writes.at(-1), { date, habit: 'steps', checked: false })
  reads[3].resolve({ events: [], checkins: [] })
  await nextTick()
})

test('late reads and a replacement repository cannot make the current range ready', async (t) => {
  const { planner, repository, source, reads, writes } = setup(t)
  const originalDate = planner.selected.value
  planner.navigate(-1)
  await nextTick()
  const date = planner.selected.value
  assert.notEqual(date, originalDate)

  reads[0].resolve({ events: [], checkins: [{ date: originalDate, habit: 'steps' }] })
  await nextTick()
  assert.equal(planner.checkinsReady.value, false)
  assert.deepEqual(planner.shownCheckins.value, [])
  await planner.changeCheckin('steps', true)
  assert.deepEqual(writes, [])

  reads[1].resolve({ events: [], checkins: [{ date, habit: 'steps' }] })
  await nextTick()
  assert.equal(planner.checkinsReady.value, true)
  assert.deepEqual(planner.shownCheckins.value, [{ date, habit: 'steps' }])

  const sameWeek = reads[1].query
  planner.selectDay(date === sameWeek.start ? sameWeek.end : sameWeek.start)
  await nextTick()
  assert.equal(planner.checkinsReady.value, true)
  assert.equal(reads.length, 2)

  source.value = { ...repository }
  assert.equal(planner.checkinsReady.value, false)
  await nextTick()
  reads[2].resolve({ events: [], checkins: [] })
  await nextTick()
  assert.equal(planner.checkinsReady.value, true)
})

test('saving an activity outside the current calendar range reads the new range once', async (t) => {
  const { planner, reads } = setup(t)
  reads[0].resolve({ events: [], checkins: [] })
  await nextTick()
  const date = shiftDay(planner.selected.value, -7)
  planner.openEditor()
  await planner.changeEvent({ date, activity: 'practice', start: 1080, end: 1140, workException: false })
  await nextTick()
  assert.equal(planner.selected.value, date)
  assert.equal(reads.length, 2)
  assert.ok(date >= reads[1].query.start && date <= reads[1].query.end)
  reads[1].resolve({ events: [], checkins: [] })
  await nextTick()
})
