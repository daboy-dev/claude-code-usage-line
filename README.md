# usage-line

**Install it once and your Claude plan usage is always on screen in Claude Code. There's no setup command, no `settings.json` edit and no restart script.** It's a [mod](https://code.claude.com/docs/en/plugins/mods/overview): a plugin whose code runs inside Claude Code. It needs **Claude Code v2.1.287 or later**.

It draws one small, dim line just above the prompt:

```text
                                                  5h 23% (2h14m) · 7d 41%
```

* **`5h`**: how much of your rolling 5-hour window you've used, and the time left until it resets
* **`7d`**: your weekly window. Its reset countdown appears once it reaches the warning level, as in `7d 75% (3d4h)`.
* **`spend`**: shown too if you use Claude through a gateway that has a spend limit, as in `spend 40%`
* **Colors**: a window turns your theme's warning color (yellow) at **70%** and its error color (red) at **90%**
* **Before the first reading**: nothing is drawn until Claude Code has rate-limit figures. That covers API-key users, and the time before your first response. If there's a session cost by then, it shows that instead, such as `$0.12`.
* **After a reset**: when a window's reset time has passed, it shows `5h reset` until the next response brings the new figure

The countdown keeps moving while you're idle: the line is refreshed once a minute.

## Install

```bash
claude plugin marketplace add daboy-dev/claude-code-usage-line
```

```bash
claude plugin install usage-line@daboy-dev
```

That's it. Your next Claude Code session shows the line. If a session is already open, run `/reload-plugins` in it. To check that it loaded, run `/plugin`: the dim line under the tabs reads `1 mod active · usage-line` (or names it among your other mods).

If your Claude Code is older than v2.1.287, the plugin still installs but does nothing. Update with `claude update`.

### Where it shows

| Where you run Claude Code | Line shown |
| :- | :- |
| `claude` in a terminal, including an editor's terminal | Yes |
| The Desktop app's Code tab | Yes |
| The VS Code extension's chat panel, `claude -p`, cloud sessions | No. Mods draw nothing there, and the mod stays quiet. |

It shares the band above the prompt with other mods, and their content stays. When a survey appears there, the line steps aside. If you have your own `statusLine`, it's unaffected: that draws under the prompt, and this line is above it.

## What it can access

A mod runs with your permissions, so here's exactly what this one does. `claude plugin validate` reads it from the source without running it:

```text
❯ ./register.ts hooks: session.start, classic.SessionStart{source=clear|resume|fork}, session.measure, ui.render{component=AbovePrompt}
❯ ./register.ts calls: $.clock.every, $.clock.now, $.session.usage (via refresh), $.ui.invalidate, $.ui.resolve
```

In plain words, it reads the usage figures Claude Code already has (`$.session.usage()` and the `session.measure` event), keeps the latest in memory, and draws one line. A one-minute timer asks for a redraw so the countdown stays current.

It does **not** read or write files, make network requests, start processes, read environment variables or settings, call a model, submit prompts, or touch tool calls. There's also nothing to configure and nothing stored on disk. Check it yourself:

```bash
claude plugin validate ./usage-line
```

The whole mod is two short files: [`hooks/register.ts`](hooks/register.ts) and [`hooks/format.ts`](hooks/format.ts).

## Turn it off

* **Remove it**: `claude plugin uninstall usage-line@daboy-dev`, or disable it in `/plugin` → **Installed**
* **Collapse the band for now**: ctrl+x ctrl+a
* **Organization policy**: `disableAllHooks`, `allowManagedHooksOnly`, `allowManagedModsOnly`, `--safe-mode` and `--bare` all keep the mod from loading. You just won't see the line.

## Options

There are none, on purpose. Plugin options (`userConfig`) make Claude Code ask you to configure them at install time, even when every option has a default, and that's the extra step this plugin avoids. The thresholds are fixed at 70% and 90%, and the colors follow your theme.

## Develop

```bash
claude --plugin-dir ./usage-line
```

```bash
claude plugin test ./usage-line
```

```bash
claude plugin validate ./usage-line/.claude-plugin/plugin.json --strict
```

Loading the directory once with `--plugin-dir` writes the type declarations for your Claude Code version into `.claude-plugin/types/` (git-ignored). After that, `tsc -p ./usage-line` type-checks the mod and its tests.

## License

MIT. See [LICENSE](LICENSE).
