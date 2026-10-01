import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const at = (ms: number) => new Date(NOW + ms).toISOString()

const CONTEXT = { window: 200_000 }
const STARTED = NOW - HOUR

// What Claude Code passes to a ui.render hook for the band, apart from the app.
const BAND = {
  plugin: 'usage-line',
  component: 'AbovePrompt',
  viewport: { columns: 100, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// What the engine (or a mod after this one) would draw in the band.
const engineBand = () => ({ type: 'Text' as const, props: {}, children: ['drawn by Claude Code'] })

type Limits = { kind: string; percentUsed: number; resetsAt?: string }[]

// Stubs every engine answer the mod needs; `usage` is what $.session.usage() returns.
function engine(on: any, usage: { rateLimits: Limits; cost?: { usd: number } }) {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.usage', () => ({ value: { startedAt: STARTED, context: CONTEXT, ...usage } }))
  on('session.measure', ($: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', engineBand)
  return clock
}

// The innermost Text whose whole text is `text`: the styled run, not the line around it.
function runOf(node: any, text: string): any {
  if (node == null || typeof node === 'string') return undefined
  for (const child of node.children ?? []) {
    const found = runOf(child, text)
    if (found) return found
  }
  return node.type === 'Text' && textOf(node) === text ? node : undefined
}

// The plain text of every Text in a drawn tree, joined.
function textOf(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  return (node.children ?? []).map(textOf).join('')
}

describe('the band', () => {
  test('both windows draw one line, after what other mods draw', async ($, on) => {
    engine(on, {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23, resetsAt: at(2 * HOUR + 14 * MIN) },
        { kind: 'seven_day', percentUsed: 41, resetsAt: at(3 * 24 * HOUR) },
      ],
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      const engineLine = await ui.find({ type: 'Text', text: 'drawn by Claude Code' })
      expect(engineLine).toBeDefined()
      const root = await ui.find({ type: 'Box' })
      expect(textOf(root)).toBe('drawn by Claude Code5h 23% (2h14m) · 7d 41%')
      await ui.unmount()
    }
  })

  test('first paint before any reading draws nothing of its own', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 0 } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Box' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  })

  test('no rate limits falls back to the session cost', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 0.12 } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '$0.12' })).toBeDefined()
  })

  test('session.measure replaces the figures', async ($, on) => {
    engine(on, { rateLimits: [] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Box' })).toBeUndefined()

    await $.session.measure({
      context: CONTEXT,
      rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(37 * MIN) }],
      cost: { usd: 1 },
      changed: ['rateLimits', 'cost'],
    })
    const hot = runOf(await ui.find({ type: 'Box' }), '5h 91% (37m)')
    expect(hot).toBeDefined()
    expect(hot?.props).toEqual({ color: 'error' })
  })

  test('threshold colors: dim, warning, error', async ($, on) => {
    engine(on, {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 69 },
        { kind: 'seven_day', percentUsed: 70 },
        { kind: 'spend_limit', percentUsed: 90 },
      ],
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const root = await ui.find({ type: 'Box' })
    expect(runOf(root, '5h 69%')?.props).toEqual({ dimColor: true })
    expect(runOf(root, '7d 70%')?.props).toEqual({ color: 'warning' })
    expect(runOf(root, 'spend 90%')?.props).toEqual({ color: 'error' })
  })

  test('steps aside while a survey holds the band', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 23 }] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Text', text: '5h 23%' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  })

  test('the countdown moves while idle, and a passed reset drops the stale percent', async ($, on) => {
    const clock = engine(on, {
      rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: at(2 * MIN + 30_000) }],
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '5h 95% (2m)' })).toBeDefined()

    await clock.advance(MIN)
    expect(await ui.find({ type: 'Text', text: '5h 95% (1m)' })).toBeDefined()

    await clock.advance(2 * MIN)
    expect(await ui.find({ type: 'Text', text: '5h reset' })).toBeDefined()
  })

  test('once drawn, the minute timer asks for one redraw a minute', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: at(HOUR) }] })
    let redraws = 0
    on('ui.invalidate', () => {
      redraws += 1
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.ui.mount({ ...BAND, surface: 'terminal' })
    await clock.advance(5 * MIN)
    expect(redraws).toBe(5)
  })

  test('figures are read again after /clear', async ($, on) => {
    let reads = 0
    mock.clock(on, { now: NOW })
    on('session.usage', () => {
      reads += 1
      return { value: { startedAt: STARTED, context: CONTEXT, rateLimits: [{ kind: 'seven_day', percentUsed: 10 + reads }] } }
    })
    on('classic.SessionStart', () => ({}))
    on('ui.render', engineBand)
    await $.classic.SessionStart({ source: 'clear' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '7d 11%' })).toBeDefined()
  })
})

describe('where nothing draws', () => {
  test('claude -p: hooks run, nothing throws, the timer asks for no redraw', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: at(HOUR) }] })
    let redraws = 0
    on('ui.invalidate', () => {
      redraws += 1
      return { value: undefined }
    })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await $.session.measure({
      context: CONTEXT,
      rateLimits: [{ kind: 'five_hour', percentUsed: 24, resetsAt: at(HOUR) }],
      changed: ['rateLimits'],
    })
    await clock.advance(10 * MIN)
    expect(redraws).toBe(0)
  })

  test('the VS Code panel and the mobile app: session events only, no errors', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 50 }] })
    for (const surface of ['vscode', 'mobile'] as const) {
      const out = await $.session.start({ surface, isInteractive: true, cwd: '/work' })
      expect(out).toEqual({ cwd: '/work' })
    }
  })

  test('a failing usage read leaves the band empty, not broken', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.start', () => ({ cwd: '/work' }))
    on('session.usage', () => ({ deny: 'unavailable' }))
    on('ui.render', engineBand)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  })
})
