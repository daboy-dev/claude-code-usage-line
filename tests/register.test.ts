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
  on('turn.complete', () => ({ text: '' }))
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

// The text of the line this mod drew, without what the engine drew beside it.
async function lineOf(ui: { find: (q: { type: 'Box' }) => Promise<unknown> }): Promise<string> {
  return textOf(await ui.find({ type: 'Box' })).replace('drawn by Claude Code', '')
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
      expect(textOf(root)).toBe('drawn by Claude CodeSession ▰▰▱▱▱▱▱▱▱▱ 23% · resets in 2h14m     Week ▰▰▰▰▱▱▱▱▱▱ 41%')
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

  test('no rate limits after a reply falls back to the session cost', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 0.12 } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' })
    expect(await lineOf(ui)).toBe('Session cost $0.12')
  })

  test('a reopened session with an old cost shows nothing until a reply finishes', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 4.2 } })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await lineOf(ui)).toBe('')

    // A subscriber's first reply brings the plan figures: no cost line at all.
    await $.session.measure({
      context: CONTEXT,
      rateLimits: [{ kind: 'five_hour', percentUsed: 4, resetsAt: at(4 * HOUR) }],
      cost: { usd: 4.3 },
      changed: ['rateLimits', 'cost'],
    })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' })
    expect(await lineOf(ui)).toBe('Session ▰▱▱▱▱▱▱▱▱▱  4% · resets in 4h00m')
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
    expect(await lineOf(ui)).toBe('Session ▰▰▰▰▰▰▰▰▰▱ 91% · resets in 37m')
    const root = await ui.find({ type: 'Box' })
    expect(runOf(root, '▰▰▰▰▰▰▰▰▰')?.props).toEqual({ color: 'error' })
    expect(runOf(root, '91%')?.props).toEqual({ color: 'error' })
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
    expect(runOf(root, '69%')).toBeDefined()
    expect(runOf(root, '69%')?.props?.color).toBeUndefined()
    expect(runOf(root, '69%')?.props?.dimColor).toBeUndefined()
    expect(runOf(root, '70%')?.props).toEqual({ color: 'warning' })
    expect(runOf(root, '90%')?.props).toEqual({ color: 'error' })
    expect(runOf(root, 'Session ')?.props).toEqual({ dimColor: true })
  })

  test('a narrow band gets the shorter layouts', async ($, on) => {
    engine(on, {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23, resetsAt: at(2 * HOUR + 14 * MIN) },
        { kind: 'seven_day', percentUsed: 41, resetsAt: at(3 * 24 * HOUR) },
      ],
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const narrow = (bodyColumns: number) => ({ ...BAND, surface: 'terminal' as const, props: { ...BAND.props, bodyColumns } })
    let ui = await $.ui.mount(narrow(60))
    expect(await lineOf(ui)).toBe('Session 23% · resets in 2h14m     Week 41%')
    await ui.unmount()
    ui = await $.ui.mount(narrow(40))
    expect(await lineOf(ui)).toBe('5h 23% (2h14m) · 7d 41%')
  })

  test('steps aside while a survey holds the band', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 23 }] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
    expect(await lineOf(ui)).toBe('')
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  })

  test('the countdown moves while idle, and a passed reset drops the stale percent', async ($, on) => {
    const clock = engine(on, {
      rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: at(2 * MIN + 30_000) }],
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await lineOf(ui)).toBe('Session ▰▰▰▰▰▰▰▰▰▰ 95% · resets in 2m')

    await clock.advance(MIN)
    expect(await lineOf(ui)).toBe('Session ▰▰▰▰▰▰▰▰▰▰ 95% · resets in 1m')

    await clock.advance(2 * MIN)
    expect(await lineOf(ui)).toBe('Session reset')
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
    expect(await lineOf(ui)).toBe('Week ▰▱▱▱▱▱▱▱▱▱ 11%')
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
