// usage-line: a one-line view of the Claude plan's usage, drawn in the band
// above the prompt.
//
// It only reads figures Claude Code already has ($.session.usage() and the
// session.measure event), keeps the latest in a module variable, and draws
// one line. No files, network, processes, environment or store.

import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { SEPARATOR, isTimeDependent, optionsOf, segmentsOf } from './format'
import type { Segment, Usage } from './format'

// One redraw a minute keeps the countdown honest while the session is idle.
const TICK_MS = 60_000

// The latest figures, from session.measure or $.session.usage().
let latest: Usage | undefined
// Set once the band has been drawn at least once, so the timer never asks for
// redraws in a session where nothing draws (claude -p, the VS Code panel).
let drawn = false

// Seeds the line from the figures Claude Code already holds.
async function refresh($: EngineInterface): Promise<void> {
  try {
    latest = await $.session.usage()
  } catch {
    // Keep whatever we had; the next session.measure brings fresh figures.
  }
}

export function register(on: On, options: PluginOptions): void {
  const opts = optionsOf(options)

  // Before the first prompt, and again after a reload of this plugin.
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(TICK_MS, () => {
      if (drawn && isTimeDependent(latest)) $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  // session.start does not fire again after /clear, /resume or /branch.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await refresh($)
    if (drawn) $.ui.invalidate('ui.render')
    return next(e)
  })

  // After each turn, and whenever a rate-limit window moves a whole point.
  on('session.measure', async ($, e, next) => {
    latest = { rateLimits: e.rateLimits, cost: e.cost }
    if (drawn) $.ui.invalidate('ui.render')
    return next(e)
  })

  // The band above the prompt: terminal and Desktop only.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey holds the band: step aside.
    if (e.props.hasSurvey) return next(e)
    drawn = true

    const segments = segmentsOf(latest, await $.clock.now(), opts)
    if (segments.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const styled = (s: Segment) =>
      s.level === 'crit'
        ? Text({ color: 'error', children: [s.text] })
        : s.level === 'warn'
          ? Text({ color: 'warning', children: [s.text] })
          : Text({ dimColor: true, children: [s.text] })
    const parts = segments.flatMap((s, i) =>
      i === 0 ? [styled(s)] : [Text({ dimColor: true, children: [SEPARATOR] }), styled(s)],
    )
    const line = Box({
      flexDirection: 'row',
      justifyContent: 'flex-end',
      children: [Text({ wrap: 'truncate-start', children: parts })],
    })

    // Keep what other mods draw in the band, with our line under it.
    const others = await next(e)
    return Box({ flexDirection: 'column', children: [others, line] })
  })
}
