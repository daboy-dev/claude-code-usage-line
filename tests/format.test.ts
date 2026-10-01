import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULTS,
  formatRemaining,
  isTimeDependent,
  levelOf,
  lineOf,
  optionsOf,
  segmentsOf,
} from '../hooks/format'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (ms: number) => new Date(NOW + ms).toISOString()

describe('reset formatting', () => {
  test('days and hours past a day', async () => {
    expect(formatRemaining(3 * DAY + 4 * HOUR + 59 * MIN)).toBe('3d4h')
  })
  test('hours and minutes past an hour', async () => {
    expect(formatRemaining(2 * HOUR + 14 * MIN + 30_000)).toBe('2h14m')
    expect(formatRemaining(1 * HOUR + 5 * MIN)).toBe('1h05m')
  })
  test('minutes under an hour', async () => {
    expect(formatRemaining(37 * MIN + 59_000)).toBe('37m')
  })
  test('under a minute', async () => {
    expect(formatRemaining(10_000)).toBe('<1m')
  })
})

describe('windows', () => {
  test('both windows: 5h with countdown, 7d without', async () => {
    const usage = {
      rateLimits: [
        { kind: 'seven_day', percentUsed: 41.2, resetsAt: at(3 * DAY) },
        { kind: 'five_hour', percentUsed: 23.4, resetsAt: at(2 * HOUR + 14 * MIN) },
      ],
    }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('5h 23% (2h14m) · 7d 41%')
    expect(segmentsOf(usage, NOW).map((s) => s.level)).toEqual(['normal', 'normal'])
  })

  test('only the 5-hour window', async () => {
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 5, resetsAt: at(37 * MIN) }] }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('5h 5% (37m)')
  })

  test('only the weekly window', async () => {
    const usage = { rateLimits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: at(2 * DAY) }] }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('7d 12%')
  })

  test('a hot weekly window shows its countdown', async () => {
    const usage = { rateLimits: [{ kind: 'seven_day', percentUsed: 75, resetsAt: at(3 * DAY + 4 * HOUR) }] }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('7d 75% (3d4h)')
  })

  test('a window without resetsAt has no countdown', async () => {
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 50 }] }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('5h 50%')
    expect(isTimeDependent(usage)).toBe(false)
  })

  test('countdown can be turned off', async () => {
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: at(HOUR) }] }
    const opts = optionsOf({ showCountdown: false })
    expect(lineOf(segmentsOf(usage, NOW, opts))).toBe('5h 23%')
  })

  test('a reset in the past drops the stale percent', async () => {
    const usage = {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 95, resetsAt: at(-MIN) },
        { kind: 'seven_day', percentUsed: 41, resetsAt: at(DAY) },
      ],
    }
    const segments = segmentsOf(usage, NOW)
    expect(lineOf(segments)).toBe('5h reset · 7d 41%')
    expect(segments[0]?.level).toBe('normal')
  })

  test('spend limit past 100 is shown as is, in red', async () => {
    const usage = { rateLimits: [{ kind: 'spend_limit', percentUsed: 112.5 }] }
    const segments = segmentsOf(usage, NOW)
    expect(lineOf(segments)).toBe('spend 113%')
    expect(segments[0]?.level).toBe('crit')
  })

  test('all three windows in a fixed order', async () => {
    const usage = {
      rateLimits: [
        { kind: 'spend_limit', percentUsed: 10 },
        { kind: 'seven_day', percentUsed: 41 },
        { kind: 'five_hour', percentUsed: 23 },
      ],
    }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('5h 23% · 7d 41% · spend 10%')
  })

  test('unknown window kinds are ignored', async () => {
    const usage = { rateLimits: [{ kind: 'mystery', percentUsed: 99 }], cost: { usd: 0.5 } }
    expect(lineOf(segmentsOf(usage, NOW))).toBe('$0.50')
  })
})

describe('fallbacks', () => {
  test('no rate limits: the session cost', async () => {
    expect(lineOf(segmentsOf({ rateLimits: [], cost: { usd: 0.1234 } }, NOW))).toBe('$0.12')
  })
  test('cost fallback can be turned off', async () => {
    const opts = optionsOf({ showCost: false })
    expect(segmentsOf({ rateLimits: [], cost: { usd: 3 } }, NOW, opts)).toEqual([])
  })
  test('nothing available: nothing drawn', async () => {
    expect(segmentsOf({ rateLimits: [] }, NOW)).toEqual([])
    expect(segmentsOf({ rateLimits: [], cost: { usd: 0 } }, NOW)).toEqual([])
    expect(segmentsOf(undefined, NOW)).toEqual([])
  })
})

describe('thresholds', () => {
  test('boundaries at 69, 70, 89, 90', async () => {
    expect(levelOf(69, DEFAULTS)).toBe('normal')
    expect(levelOf(70, DEFAULTS)).toBe('warn')
    expect(levelOf(89, DEFAULTS)).toBe('warn')
    expect(levelOf(90, DEFAULTS)).toBe('crit')
  })
  test('the color follows the shown, rounded percent', async () => {
    const levels = [69.4, 69.5, 89.4, 89.5].map(
      (p) => segmentsOf({ rateLimits: [{ kind: 'seven_day', percentUsed: p }] }, NOW)[0]?.level,
    )
    expect(levels).toEqual(['normal', 'warn', 'warn', 'crit'])
  })
  test('custom thresholds, and swapped ones are put in order', async () => {
    expect(optionsOf({ warnAt: 50, critAt: 80 })).toMatchObject({ warnAt: 50, critAt: 80 })
    expect(optionsOf({ warnAt: 95, critAt: 60 })).toMatchObject({ warnAt: 60, critAt: 95 })
    expect(optionsOf({ warnAt: 'junk', critAt: -3 })).toMatchObject({ warnAt: 70, critAt: 90 })
  })
})
