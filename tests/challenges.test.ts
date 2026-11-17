import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref, shallowRef } from 'vue'
import { useChallenges } from '../src/composables/useChallenges.ts'
import { challengeProgress, validateChallenge } from '../src/domain/challenges.ts'
import type { DateRange, RecordQuery } from '../src/domain/planner.ts'

const challenge = { id: 'test', title: '每天练琴', targetDays: 3, startDate: '2026-11-01' }

test('consecutive days can reach the goal after a missed day and count today when checked', () => {
  const dates = ['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05']
  assert.deepEqual(challengeProgress(challenge, dates, '2026-11-05'), {
    current: 3, longest: 3, complete: true,
  })
  assert.deepEqual(challengeProgress(challenge, dates, '2026-11-07'), {
    current: 0, longest: 3, complete: true,
  })
})

test('today may continue yesterday’s streak, and duplicates or out-of-range dates do not count', () => {
  const dates = ['2026-10-31', '2026-11-01', '2026-11-01', '2026-11-02', '2026-11-04']
  assert.deepEqual(challengeProgress(challenge, dates, '2026-11-03'), {
    current: 2, longest: 2, complete: false,
  })
  assert.deepEqual(challengeProgress(challenge, dates, '2026-11-04'), {
    current: 1, longest: 2, complete: false,
  })
})

test('challenge target is a positive integer and start date is valid', () => {
  assert.equal(validateChallenge(challenge), '')
  assert.ok(validateChallenge({ ...challenge, targetDays: 0 }))
  assert.ok(validateChallenge({ ...challenge, targetDays: 2.5 }))
  assert.ok(validateChallenge({ ...challenge, startDate: '2026-02-29' }))
})

test('linked challenges use the selected habit history and refresh after a daily check-in changes', async (t) => {
  const today = ref('2026-11-17')
  const revision = ref(0)
  const linked = { ...challenge, id: 'linked', habitId: 'reading' }
  const later = { ...linked, id: 'later', startDate: '2026-11-17' }
  const future = { ...linked, id: 'future', habitId: 'steps', startDate: '2026-11-18' }
  const daily = [
    { date: '2026-10-31', habit: 'reading' },
    { date: '2026-11-01', habit: 'reading' },
    { date: '2026-11-02', habit: 'reading' },
    { date: '2026-11-16', habit: 'steps' },
    { date: '2026-11-17', habit: 'reading' },
  ]
  const queries: (DateRange | RecordQuery)[] = []
  const sources = shallowRef({
    challenges: {
      async read() {
        return {
          challenges: [challenge, linked, later, future],
          checkins: [
            { challengeId: challenge.id, date: '2026-11-16' },
            { challengeId: linked.id, date: '2026-11-16' },
          ],
        }
      },
      async create() {},
      async remove() {},
      async setCheckin() {},
    },
    planner: {
      async read(query: DateRange | RecordQuery) {
        queries.push(query)
        return {
          events: [],
          checkins: daily.filter(({ date, habit }) =>
            'kind' in query && habit === query.item && date >= query.start && date <= query.end,
          ),
        }
      },
    },
  })
  const scope = effectScope()
  t.after(() => scope.stop())
  const model = scope.run(() => useChallenges(sources, ref(true), today, revision))!
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.deepEqual(queries, [{ kind: 'habit', item: 'reading', start: linked.startDate, end: today.value }])
  assert.deepEqual(model.data.value.checkins, [
    { challengeId: challenge.id, date: '2026-11-16' },
    { challengeId: linked.id, date: '2026-11-01' },
    { challengeId: linked.id, date: '2026-11-02' },
    { challengeId: linked.id, date: '2026-11-17' },
    { challengeId: later.id, date: '2026-11-17' },
  ])

  daily.pop()
  revision.value++
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(queries.length, 2)
  assert.ok(model.data.value.checkins.every(({ date }) => date !== '2026-11-17'))
})
