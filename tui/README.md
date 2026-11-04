# dsh-superagent-tui

A terminal surface for [dsh-superagent](../README.md): the same overview,
tickets, settings and controls the web panel offers, rendered inside
[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — no browser, no second
window, no page to keep open.

dsh-superagent still runs as its own DSH profile (`superagent`) and answers only
on loopback. This plugin lives in the profile the person actually looks at
(`dsh-tui`) and talks to that loopback API:

```text
dsh-tui process ──HTTP──▶ 127.0.0.1:3082 /orchestrator/api/
   (this plugin)                 (dsh-superagent profile)
```

The two profiles stay separate on purpose: dsh-superagent rewrites process-wide
PATH/git settings for its `gh` wrapper, so it must not share a process with the
profile you work in.

## What it adds

- **Side panel `Superagent`** — three views on `tab`:
  - *tickets*: open tickets with stage, age and executor; `enter` opens one;
  - *overview*: service health, executor load, active problems;
  - *settings*: the saved source, policy and executor blocks (read-only here —
    writes belong to the Management API and the web panel).
- **Footer field** — one cell in the prompt footer, refreshed every 10 s:
  `sa setup`, `sa paused`, `sa 1/3`, `sa 2/3+5 !`, `sa off`. Hovering shows the
  detail; clicking opens the panel.
- **Shortcuts** — `alt+a` (and `ctrl+shift+s` where the terminal reports the
  shift bit) opens the panel. `alt+s` is deliberately avoided: dsh-TUI binds it
  to its own *star the repo* action.

Inside the panel: `↑↓`/`j k` move, `enter` opens a ticket, `esc` goes back,
`tab` switches views, `p` pauses/resumes the executor, `r` retries, `s` stops,
`c` re-runs setup checks, `?` shows help.

## Install

```sh
dsh plugin --profile dsh-tui add "link:$PWD"     # from this directory
```

Then restart dsh-tui. A running process keeps the module it loaded at start:
DSH does not watch linked plugin sources.

The bundle patch (`cordis.patch.yml`) inserts one row:

```yaml
- id: superagent-tui
  name: dsh-superagent-tui
  config:
    url: http://127.0.0.1:3082    # the superagent profile's --url
    pollMs: 5000                  # panel refresh; the footer uses 10 s
```

## Contract and limits

- Loopback only, with the management API's `x-orchestrator-request: 1` header;
  the client never sends credentials anywhere and never reads the
  orchestrator's files.
- The panel never takes focus, and the footer field stays out of the way below
  60 columns (`minColumns`).
- Each host seam is awaited with `ctx.inject`; a host without `tuiPanels`,
  `tuiStatus` or `tuiShortcuts` keeps the others instead of failing the profile.
- A reserved or duplicate shortcut is refused by the host with a silent no-op
  disposer, so registration is confirmed against `shortcuts.list()` and a
  refusal is logged once.

## Development

Plain ESM JavaScript with no dependencies, so the profile needs no install step
beyond the link. The host passes its own React instance and a narrowed
`ui` kit to the panel component: hooks and elements must go through
`props.React` / `props.ui`, never through a second React copy.

| File | Role |
| --- | --- |
| `src/index.js` | activation: panel, footer field, shortcuts (`ctx.inject`) |
| `src/panel.js` | the panel component (tickets / overview / settings / ticket) |
| `src/format.js` | pure formatting, clipping and tone selection |
| `src/api.js` | loopback client for `/orchestrator/api/` with a 4 s timeout |

`dsh-plugin.json` declares the host facet; `check-manifest.mjs` from the
[dsh-tui plugin template](https://github.com/dsh-tui-ecosystem/plugin-template)
accepts it offline.
