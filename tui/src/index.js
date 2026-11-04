/**
 * dsh-superagent-tui — a terminal (dsh-tui) surface for dsh-superagent.
 *
 * dsh-superagent itself runs as a DSH service profile (`dsh --profile
 * superagent --no-open`): its orchestrator answers on
 * `http://127.0.0.1:3082/orchestrator/api/` with no browser attached. This
 * plugin lives in the profile the person actually looks at (dsh-tui) and
 * replaces the web panel with terminal surfaces:
 *
 * - a side panel (`ctx.tuiPanels`) with tickets, overview, settings and the
 *   per-ticket actions (retry, stop, pause/resume, setup check);
 * - one footer field (`ctx.tuiStatus.setField`) that is always visible: a
 *   one-cell status chip, the live worker load, and an `onClick` that opens
 *   the panel in fullscreen mouse mode;
 * - two shortcuts that open the panel.
 *
 * Each seam is awaited with `ctx.inject` instead of read with `ctx.get`: a
 * profile plugin is composed *before* the TUI host registers its own services
 * on a cold start, so a plain `ctx.get` at apply time would find nothing and
 * the plugin would stay a no-op until the next reload. Injection also means a
 * host without one of the three services keeps the other two, and a service
 * that is replaced re-runs only the body that depends on it.
 */

import { createApi, failureText } from './api.js'
import { footerField } from './format.js'
import { createSuperagentPanel } from './panel.js'

export const name = 'dsh-superagent-tui'

const PANEL_ID = 'superagent'
const DEFAULT_URL = 'http://127.0.0.1:3082'
const DEFAULT_POLL_MS = 5000
const FOOTER_MS = 10_000
/** `alt+a` is free on every shipped keymap; `ctrl+shift+s` only arrives on terminals that report the shift bit. */
const SHORTCUTS = ['alt+a', 'ctrl+shift+s']

function pollInterval(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_MS
  return Math.max(1_000, Math.min(60_000, Math.round(parsed)))
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{url?: string, pollMs?: number}} [config]
 */
export function apply(ctx, config = {}) {
  const api = createApi(String(config.url ?? DEFAULT_URL))
  const pollMs = pollInterval(config.pollMs ?? DEFAULT_POLL_MS)
  /** The panel service and the final (host-prefixed) id, shared with the shortcut bodies. */
  const panel = { service: undefined, id: undefined }

  /** Open this plugin's own panel; a refused/failed open is not an error. */
  const openPanel = () => {
    if (!panel.service || panel.id === undefined) return false
    try {
      return panel.service.open(panel.id) === true
    } catch (error) {
      ctx.logger.warn('dsh-superagent-tui: opening the panel failed: %s', failureText(error))
      return false
    }
  }

  // ── side panel ─────────────────────────────────────────────────────────────
  ctx.inject(['tuiPanels'], (ctx) => {
    const panels = ctx.get('tuiPanels')
    const dispose = panels.register({
      apiVersion: 1,
      id: PANEL_ID,
      title: 'Superagent',
      icon: 'S',
      minColumns: 32,
      order: 40,
      component: createSuperagentPanel({ api, pollMs }),
    }, ctx)
    if (dispose === undefined) {
      ctx.logger.warn('dsh-superagent-tui: this host refused the Superagent panel')
      return
    }
    panel.service = panels
    // The host prefixes plugin contributions with the activation's plugin id;
    // `open()` needs that final id.
    panel.id = panels.list().find(item => String(item.id).endsWith(`:${PANEL_ID}`))?.id
    if (panel.id === undefined) ctx.logger.warn('dsh-superagent-tui: the host did not list the Superagent panel')
    ctx.effect(() => () => {
      panel.service = undefined
      panel.id = undefined
      try {
        dispose()
      } catch {
        // A host cleanup failure must not fail the other seams.
      }
    }, 'dsh-superagent-tui panel')
  })

  // ── footer field ───────────────────────────────────────────────────────────
  ctx.inject(['tuiStatus'], (ctx) => {
    const status = ctx.get('tuiStatus')
    let clearField
    const writeField = (state, personCount, error) => {
      const field = footerField(state, personCount, error)
      const options = {
        slot: 'right-head',
        tone: field.tone,
        maxCells: 24,
        minColumns: 60,
        detail: field.detail,
      }
      if (panel.id !== undefined) options.onClick = () => { openPanel() }
      clearField = status.setField('superagent', field.text, options, ctx)
    }
    const tick = async () => {
      try {
        const state = await api.state()
        let personCount = 0
        try {
          const list = await api.tickets('person', 1)
          personCount = Number(list?.total ?? 0)
        } catch {
          // The person count is decoration; a failed list must not hide the state.
        }
        writeField(state, personCount, undefined)
      } catch (error) {
        writeField(undefined, 0, failureText(error))
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, FOOTER_MS)
    ctx.effect(() => () => {
      clearInterval(timer)
      if (typeof clearField === 'function') clearField()
    }, 'dsh-superagent-tui footer field')
  })

  // ── shortcuts ──────────────────────────────────────────────────────────────
  ctx.inject(['tuiShortcuts'], (ctx) => {
    const shortcuts = ctx.get('tuiShortcuts')
    for (const combo of SHORTCUTS) {
      const dispose = shortcuts.register(combo, {
        description: 'Open the Superagent panel',
        handler: () => { openPanel() },
      }, ctx)
      // A reserved or duplicate combo is refused with a no-op disposer, so the
      // registry itself is the only way to tell success from rejection.
      if (!shortcuts.list().some(entry => entry.combo === combo)) {
        ctx.logger.warn('dsh-superagent-tui: the host reserved the %s shortcut', combo)
        continue
      }
      if (typeof dispose === 'function') {
        ctx.effect(() => () => {
          try {
            dispose()
          } catch {
            // A host cleanup failure must not fail the other registrations.
          }
        }, `dsh-superagent-tui shortcut ${combo}`)
      }
    }
  })
}
