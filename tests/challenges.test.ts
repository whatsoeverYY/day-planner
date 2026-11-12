import assert from 'node:assert/strict'
import test from 'node:test'
import { challengeProgress, validateChallenge } from '../src/domain/challenges.ts'

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
