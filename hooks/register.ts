// usage-line: a one-line view of the Claude plan's usage, drawn in the band
// above the prompt.
//
// It only reads figures Claude Code already has ($.session.usage() and the
// session.measure event), keeps the latest in a module variable, and draws
// one line. No files, network, processes, environment or store.

import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { isTimeDependent, optionsOf, runsFor } from './format'
import type { Run, Usage } from './format'

// One redraw a minute keeps the countdown honest while the session is idle.
const TICK_MS = 60_000
// Cells the band keeps for its own collapse mark ([-]) at the end of the row.
const BAND_MARGIN = 4

// The latest figures, from session.measure or $.session.usage().
let latest: Usage | undefined
// Set once the band has been drawn at least once, so the timer never asks for
// redraws in a session where nothing draws (claude -p, the VS Code panel).
let drawn = false
// Set once a reply has finished in this process. Only then does an empty
// rateLimits mean "no plan" (an API key) rather than "no reading yet", as in
// a Desktop session reopened with its old cost: the cost fallback waits for it.
let answered = false

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

  // A reply finished: from now on, no rate limits means no plan.
  on('turn.complete', async ($, e, next) => {
    if (!answered) {
      answered = true
      if (drawn) $.ui.invalidate('ui.render')
    }
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

    const columns = e.props.bodyColumns > BAND_MARGIN ? e.props.bodyColumns - BAND_MARGIN : undefined
    const shown = answered || !latest ? latest : { rateLimits: latest.rateLimits }
    const runs = runsFor(shown, await $.clock.now(), columns, opts)
    if (runs.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const styled = (r: Run) =>
      r.tone === 'crit'
        ? Text({ color: 'error', children: [r.text] })
        : r.tone === 'warn'
          ? Text({ color: 'warning', children: [r.text] })
          : r.tone === 'dim'
            ? Text({ dimColor: true, children: [r.text] })
            : Text({ children: [r.text] })
    const line = Box({
      flexDirection: 'row',
      children: [Text({ wrap: 'truncate-end', children: runs.map(styled) })],
    })

    // Keep what other mods draw in the band, with our line under it.
    const others = await next(e)
    return Box({ flexDirection: 'column', children: [others, line] })
  })
}
