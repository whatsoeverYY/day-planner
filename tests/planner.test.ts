import assert from 'node:assert/strict'
import test from 'node:test'
import { monthDays, overlapsWork, shiftMonth, todayInBeijing, validateEvent, weekDays } from '../src/domain/planner.ts'

test('only positive intersections with Monday–Friday work windows need an exception', () => {
  const monday = '2026-11-09'
  assert.equal(overlapsWork(monday, 540, 570), false)
  assert.equal(overlapsWork(monday, 570, 571), true)
  assert.equal(overlapsWork(monday, 690, 780), false)
  assert.equal(overlapsWork(monday, 765, 795), true)
  assert.equal(overlapsWork(monday, 1080, 1140), false)
  assert.equal(overlapsWork('2026-11-14', 780, 840), false)
  const draft = { date: monday, activity: 'piano' as const, start: 765, end: 795, workException: false }
  assert.match(validateEvent(draft), /工作时段例外/)
  assert.equal(validateEvent({ ...draft, workException: true }), '')
})

test('calendar date math uses Beijing dates and Monday starts across month boundaries', () => {
  assert.equal(todayInBeijing(new Date('2026-11-09T16:00:00Z')), '2026-11-10')
  assert.equal(weekDays('2026-11-01')[0], '2026-10-26')
  const month = monthDays('2026-11-10')
  assert.equal(month[0], '2026-10-26')
  assert.equal(month.at(-1), '2026-12-06')
  assert.equal(shiftMonth('2028-01-31', 1), '2028-02-29')
})
