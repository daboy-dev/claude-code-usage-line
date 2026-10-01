import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULTS,
  filledCells,
  formatRemaining,
  isTimeDependent,
  layoutsOf,
  levelOf,
  optionsOf,
  runsFor,
  textOf,
  windowsOf,
} from '../hooks/format'
import type { Usage } from '../hooks/format'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (ms: number) => new Date(NOW + ms).toISOString()

// The three layouts' plain text: full with bars, full without, compact.
const layouts = (usage: Usage, opts = DEFAULTS) => layoutsOf(usage, NOW, opts).map(textOf)

const BOTH: Usage = {
  rateLimits: [
    { kind: 'seven_day', percentUsed: 8.2, resetsAt: at(3 * DAY) },
    { kind: 'five_hour', percentUsed: 3.4, resetsAt: at(4 * HOUR + 20 * MIN) },
  ],
}

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

describe('bars', () => {
  test('any use shows a cell, and the bar never overflows', async () => {
    expect([0, 3, 8, 15, 75, 92, 100, 112].map(filledCells)).toEqual([0, 1, 1, 2, 8, 9, 10, 10])
  })
})

describe('layouts', () => {
  test('both windows, richest to most compact', async () => {
    expect(layouts(BOTH)).toEqual([
      'Session ▰▱▱▱▱▱▱▱▱▱  3% · resets in 4h20m     Week ▰▱▱▱▱▱▱▱▱▱  8%',
      'Session 3% · resets in 4h20m     Week 8%',
      '5h 3% (4h20m) · 7d 8%',
    ])
  })

  test('the widest layout that fits is chosen', async () => {
    expect(textOf(runsFor(BOTH, NOW, 120))).toBe('Session ▰▱▱▱▱▱▱▱▱▱  3% · resets in 4h20m     Week ▰▱▱▱▱▱▱▱▱▱  8%')
    expect(textOf(runsFor(BOTH, NOW, 50))).toBe('Session 3% · resets in 4h20m     Week 8%')
    expect(textOf(runsFor(BOTH, NOW, 30))).toBe('5h 3% (4h20m) · 7d 8%')
    expect(textOf(runsFor(BOTH, NOW, 10))).toBe('5h 3% (4h20m) · 7d 8%')
    expect(textOf(runsFor(BOTH, NOW, undefined))).toContain('Session ▰')
  })

  test('only the session window', async () => {
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 5, resetsAt: at(37 * MIN) }] }
    expect(layouts(usage)[0]).toBe('Session ▰▱▱▱▱▱▱▱▱▱  5% · resets in 37m')
  })

  test('only the weekly window, with no countdown while it is cool', async () => {
    const usage = { rateLimits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: at(2 * DAY) }] }
    expect(layouts(usage)[0]).toBe('Week ▰▱▱▱▱▱▱▱▱▱ 12%')
  })

  test('hot windows: colors on bar and percent, weekly countdown appears', async () => {
    const usage = {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 75, resetsAt: at(HOUR + 5 * MIN) },
        { kind: 'seven_day', percentUsed: 92, resetsAt: at(2 * DAY + 3 * HOUR) },
      ],
    }
    const [full] = layoutsOf(usage, NOW)
    expect(textOf(full ?? [])).toBe('Session ▰▰▰▰▰▰▰▰▱▱ 75% · resets in 1h05m     Week ▰▰▰▰▰▰▰▰▰▱ 92% · resets in 2d3h')
    const toned = (full ?? []).filter((r) => r.tone === 'warn' || r.tone === 'crit')
    expect(toned).toEqual([
      { text: '▰▰▰▰▰▰▰▰', tone: 'warn' },
      { text: '75%', tone: 'warn' },
      { text: '▰▰▰▰▰▰▰▰▰', tone: 'crit' },
      { text: '92%', tone: 'crit' },
    ])
  })

  test('a window without resetsAt has no countdown', async () => {
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 50 }] }
    expect(layouts(usage)[2]).toBe('5h 50%')
    expect(isTimeDependent(usage)).toBe(false)
  })

  test('countdown can be turned off', async () => {
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: at(HOUR) }] }
    expect(layouts(usage, optionsOf({ showCountdown: false }))[1]).toBe('Session 23%')
  })

  test('a reset in the past drops the stale percent', async () => {
    const usage = {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 95, resetsAt: at(-MIN) },
        { kind: 'seven_day', percentUsed: 41, resetsAt: at(DAY) },
      ],
    }
    expect(layouts(usage)).toEqual([
      'Session reset     Week ▰▰▰▰▱▱▱▱▱▱ 41%',
      'Session reset     Week 41%',
      '5h reset · 7d 41%',
    ])
    expect(windowsOf(usage, NOW)[0]?.level).toBe('normal')
  })

  test('spend limit past 100 is shown as is, in red, with a full bar', async () => {
    const usage = { rateLimits: [{ kind: 'spend_limit', percentUsed: 112.5 }] }
    const [full] = layoutsOf(usage, NOW)
    expect(textOf(full ?? [])).toBe('Spend ▰▰▰▰▰▰▰▰▰▰ 113%')
    expect(full?.find((r) => r.text === '113%')?.tone).toBe('crit')
  })

  test('all three windows in a fixed order', async () => {
    const usage = {
      rateLimits: [
        { kind: 'spend_limit', percentUsed: 10 },
        { kind: 'seven_day', percentUsed: 41 },
        { kind: 'five_hour', percentUsed: 23 },
      ],
    }
    expect(layouts(usage)[2]).toBe('5h 23% · 7d 41% · spend 10%')
  })

  test('unknown window kinds are ignored', async () => {
    const usage = { rateLimits: [{ kind: 'mystery', percentUsed: 99 }], cost: { usd: 0.5 } }
    expect(layouts(usage)).toEqual(['Session cost $0.50', '$0.50'])
  })
})

describe('fallbacks', () => {
  test('no rate limits: the session cost', async () => {
    expect(layouts({ rateLimits: [], cost: { usd: 0.1234 } })).toEqual(['Session cost $0.12', '$0.12'])
  })
  test('cost fallback can be turned off', async () => {
    expect(layoutsOf({ rateLimits: [], cost: { usd: 3 } }, NOW, optionsOf({ showCost: false }))).toEqual([])
  })
  test('nothing available: nothing drawn', async () => {
    expect(runsFor({ rateLimits: [] }, NOW, 80)).toEqual([])
    expect(runsFor({ rateLimits: [], cost: { usd: 0 } }, NOW, 80)).toEqual([])
    expect(runsFor(undefined, NOW, 80)).toEqual([])
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
      (p) => windowsOf({ rateLimits: [{ kind: 'seven_day', percentUsed: p }] }, NOW)[0]?.level,
    )
    expect(levels).toEqual(['normal', 'warn', 'warn', 'crit'])
  })
  test('custom thresholds, and swapped ones are put in order', async () => {
    expect(optionsOf({ warnAt: 50, critAt: 80 })).toMatchObject({ warnAt: 50, critAt: 80 })
    expect(optionsOf({ warnAt: 95, critAt: 60 })).toMatchObject({ warnAt: 60, critAt: 95 })
    expect(optionsOf({ warnAt: 'junk', critAt: -3 })).toMatchObject({ warnAt: 70, critAt: 90 })
  })
})
