// Pure formatting for the usage line: no mods API, no clock, no I/O.
// register.ts feeds it the figures from session.measure / $.session.usage()
// and draws the runs it returns.

export type Level = 'normal' | 'warn' | 'crit'

// How a run of text is drawn: dim, the plain foreground, or a threshold color.
export type Tone = 'dim' | 'plain' | 'warn' | 'crit'

export type Run = { text: string; tone: Tone }

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  rateLimits: readonly RateLimit[]
  cost?: { usd: number }
}

export type Options = {
  showCountdown: boolean
  showCost: boolean
  warnAt: number
  critAt: number
}

export const DEFAULTS: Options = { showCountdown: true, showCost: true, warnAt: 70, critAt: 90 }

// Cells in each mini bar.
export const BAR_CELLS = 10

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Reads option values, falling back to the defaults when one is missing or
// out of range (a bad value must never hide the line).
export function optionsOf(raw: Readonly<Record<string, unknown>> | undefined): Options {
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const pct = (v: unknown, d: number) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 && n <= 1000 ? n : d
  }
  const warnAt = pct(raw?.warnAt, DEFAULTS.warnAt)
  const critAt = pct(raw?.critAt, DEFAULTS.critAt)
  return {
    showCountdown: bool(raw?.showCountdown, DEFAULTS.showCountdown),
    showCost: bool(raw?.showCost, DEFAULTS.showCost),
    warnAt: Math.min(warnAt, critAt),
    critAt: Math.max(warnAt, critAt),
  }
}

// Whole percent as shown; the color is judged on this same number so that
// "70%" is never drawn dim.
export function shownPercent(percentUsed: number): number {
  return Math.max(0, Math.round(percentUsed))
}

export function levelOf(percent: number, opts: Options): Level {
  if (percent >= opts.critAt) return 'crit'
  if (percent >= opts.warnAt) return 'warn'
  return 'normal'
}

// 3d4h, 2h05m, 37m, <1m
export function formatRemaining(ms: number): string {
  if (ms < MINUTE) return '<1m'
  if (ms >= DAY) {
    const d = Math.floor(ms / DAY)
    const h = Math.floor((ms % DAY) / HOUR)
    return `${d}d${h}h`
  }
  if (ms >= HOUR) {
    const h = Math.floor(ms / HOUR)
    const m = Math.floor((ms % HOUR) / MINUTE)
    return `${h}h${String(m).padStart(2, '0')}m`
  }
  return `${Math.floor(ms / MINUTE)}m`
}

export function formatCost(usd: number): string {
  return '$' + usd.toFixed(2)
}

// Filled cells for a percent: any use shows at least one, and a full bar
// means the window is full.
export function filledCells(percent: number): number {
  if (percent <= 0) return 0
  return Math.min(BAR_CELLS, Math.max(1, Math.round(percent / 10)))
}

// Milliseconds until `resetsAt`, or undefined when it is absent or unreadable.
export function remainingMs(resetsAt: string | undefined, now: number): number | undefined {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  return Number.isFinite(at) ? at - now : undefined
}

// One rate-limit window, read and judged, before it is laid out.
export type WindowView = {
  kind: string
  label: string
  short: string
  percent: number
  level: Level
  // Time to the reset, when it is worth showing.
  countdown?: string
  // The reset time has passed: the old percent no longer applies.
  isReset: boolean
}

const KINDS: Record<string, { label: string; short: string }> = {
  five_hour: { label: 'Session', short: '5h' },
  seven_day: { label: 'Week', short: '7d' },
  spend_limit: { label: 'Spend', short: 'spend' },
}
const ORDER = ['five_hour', 'seven_day', 'spend_limit']

export function windowsOf(usage: Usage | undefined, now: number, opts: Options = DEFAULTS): WindowView[] {
  if (!usage) return []
  return usage.rateLimits
    .filter((l) => KINDS[l.kind] !== undefined && Number.isFinite(l.percentUsed))
    .slice()
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    .map((l) => {
      const { label, short } = KINDS[l.kind] ?? { label: l.kind, short: l.kind }
      const left = remainingMs(l.resetsAt, now)
      const isReset = left !== undefined && left <= 0
      const percent = shownPercent(l.percentUsed)
      const level = isReset ? 'normal' : levelOf(percent, opts)
      // The session countdown is always useful; the weekly one only once the
      // week is running hot, to keep the line short.
      const wantsCountdown =
        opts.showCountdown &&
        left !== undefined &&
        !isReset &&
        (l.kind === 'five_hour' || (l.kind === 'seven_day' && level !== 'normal'))
      return {
        kind: l.kind,
        label,
        short,
        percent,
        level,
        countdown: wantsCountdown ? formatRemaining(left) : undefined,
        isReset,
      }
    })
}

const toneOf = (level: Level, otherwise: Tone): Tone =>
  level === 'crit' ? 'crit' : level === 'warn' ? 'warn' : otherwise

const GAP = '     '

// Session ▰▱▱▱▱▱▱▱▱▱  3% · resets in 4h20m     Week ▰▱▱▱▱▱▱▱▱▱  8%
function fullRuns(windows: readonly WindowView[], withBars: boolean): Run[] {
  return windows.flatMap((w, i) => {
    const runs: Run[] = i === 0 ? [] : [{ text: GAP, tone: 'dim' }]
    runs.push({ text: w.label + ' ', tone: 'dim' })
    if (w.isReset) {
      runs.push({ text: 'reset', tone: 'dim' })
      return runs
    }
    if (withBars) {
      const filled = filledCells(w.percent)
      if (filled > 0) runs.push({ text: '▰'.repeat(filled), tone: toneOf(w.level, 'plain') })
      if (filled < BAR_CELLS) runs.push({ text: '▱'.repeat(BAR_CELLS - filled), tone: 'dim' })
      runs.push({ text: ' ', tone: 'dim' })
    }
    runs.push({ text: `${w.percent}%`.padStart(withBars ? 3 : 0), tone: toneOf(w.level, 'plain') })
    if (w.countdown) runs.push({ text: ` · resets in ${w.countdown}`, tone: 'dim' })
    return runs
  })
}

// 5h 23% (2h14m) · 7d 41%
function compactRuns(windows: readonly WindowView[]): Run[] {
  return windows.flatMap((w, i) => {
    const runs: Run[] = i === 0 ? [] : [{ text: ' · ', tone: 'dim' }]
    if (w.isReset) {
      runs.push({ text: `${w.short} reset`, tone: 'dim' })
      return runs
    }
    runs.push({ text: `${w.short} ${w.percent}%`, tone: toneOf(w.level, 'dim') })
    if (w.countdown) runs.push({ text: ` (${w.countdown})`, tone: 'dim' })
    return runs
  })
}

export function textOf(runs: readonly Run[]): string {
  return runs.map((r) => r.text).join('')
}

// The layouts from richest to most compact; the first that fits wins.
export function layoutsOf(usage: Usage | undefined, now: number, opts: Options = DEFAULTS): Run[][] {
  const windows = windowsOf(usage, now, opts)
  if (windows.length > 0) return [fullRuns(windows, true), fullRuns(windows, false), compactRuns(windows)]

  const usd = usage?.cost?.usd
  if (opts.showCost && typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
    const cost = formatCost(usd)
    return [
      [
        { text: 'Session cost ', tone: 'dim' },
        { text: cost, tone: 'plain' },
      ],
      [{ text: cost, tone: 'dim' }],
    ]
  }
  return []
}

// The runs to draw in `columns` cells (all of the richest layout when the
// width is unknown); the most compact layout when nothing fits, which the
// band then truncates.
export function runsFor(usage: Usage | undefined, now: number, columns: number | undefined, opts: Options = DEFAULTS): Run[] {
  const layouts = layoutsOf(usage, now, opts)
  if (layouts.length === 0) return []
  if (columns === undefined) return layouts[0] ?? []
  return layouts.find((runs) => textOf(runs).length <= columns) ?? layouts[layouts.length - 1] ?? []
}

// Whether the drawing changes as time passes (a countdown or a pending reset),
// so the minute timer has something to refresh.
export function isTimeDependent(usage: Usage | undefined): boolean {
  return !!usage?.rateLimits.some((l) => KINDS[l.kind] !== undefined && !!l.resetsAt)
}
