// Pure formatting for the usage line: no mods API, no clock, no I/O.
// register.ts feeds it the figures from session.measure / $.session.usage().

export type Level = 'normal' | 'warn' | 'crit'

export type Segment = { text: string; level: Level }

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

export const SEPARATOR = ' · '

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Reads the plugin's userConfig values, falling back to the defaults when one
// is missing or out of range (a bad value must never hide the line).
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

// Milliseconds until `resetsAt`, or undefined when it is absent or unreadable.
export function remainingMs(resetsAt: string | undefined, now: number): number | undefined {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  return Number.isFinite(at) ? at - now : undefined
}

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const ORDER = ['five_hour', 'seven_day', 'spend_limit']

function windowSegment(limit: RateLimit, now: number, opts: Options): Segment {
  const label = LABELS[limit.kind] ?? limit.kind
  const left = remainingMs(limit.resetsAt, now)
  // The window already reset: the old percent no longer applies, and the new
  // figure arrives with the next response.
  if (left !== undefined && left <= 0) return { text: `${label} reset`, level: 'normal' }

  const percent = shownPercent(limit.percentUsed)
  const level = levelOf(percent, opts)
  let text = `${label} ${percent}%`
  // The 5h countdown is always useful; the 7d one only once the week is
  // running hot, to keep the line short.
  const wantsCountdown =
    opts.showCountdown && left !== undefined && (limit.kind === 'five_hour' || (limit.kind === 'seven_day' && level !== 'normal'))
  if (wantsCountdown) text += ` (${formatRemaining(left)})`
  return { text, level }
}

// The line as styled segments; empty when there is nothing worth showing.
export function segmentsOf(usage: Usage | undefined, now: number, opts: Options = DEFAULTS): Segment[] {
  if (!usage) return []
  const known = usage.rateLimits
    .filter((l) => LABELS[l.kind] !== undefined && Number.isFinite(l.percentUsed))
    .slice()
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  if (known.length > 0) return known.map((l) => windowSegment(l, now, opts))

  const usd = usage.cost?.usd
  if (opts.showCost && typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
    return [{ text: formatCost(usd), level: 'normal' }]
  }
  return []
}

export function lineOf(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join(SEPARATOR)
}

// Whether the drawing changes as time passes (a countdown or a pending reset),
// so the minute timer has something to refresh.
export function isTimeDependent(usage: Usage | undefined): boolean {
  return !!usage?.rateLimits.some((l) => LABELS[l.kind] !== undefined && !!l.resetsAt)
}
