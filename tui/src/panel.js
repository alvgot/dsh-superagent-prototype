/**
 * The Superagent side panel: a pure terminal surface for the management API.
 *
 * The host calls this component with its own React instance and a narrowed
 * `ui` kit (`TuiPanelProps`); every hook and element therefore goes through
 * `props.React` / `props.ui`, never through a second React copy. All state is
 * derived from loopback HTTP polls of `/orchestrator/api/`; the panel never
 * touches the orchestrator's files or credentials directly.
 */
import { age, accountsLine, clip, githubSource, healthErrors, line, loadLine, pad, problemText,
  serviceStatus, stageGlyph, stageLabel, stageTone } from './format.js'
import { failureText } from './api.js'

const VIEWS = ['tickets', 'overview', 'settings']
const HELP = [
  ['↑↓ / j k', 'move the selection'],
  ['enter', 'open the selected ticket'],
  ['esc', 'back (ticket → list)'],
  ['tab', 'switch tickets / overview / settings'],
  ['p', 'pause or resume the executor'],
  ['r', 'retry the selected ticket'],
  ['s', 'stop the selected ticket'],
  ['c', 're-run setup checks'],
  ['?', 'close this help'],
]

/** Build the panel component the plugin registers. */
export function createSuperagentPanel({ api, pollMs }) {
  return function SuperagentPanel(props) {
    const { React, ui, host, width, height, focused, visible } = props
    const h = React.createElement
    const { Box, Text, Markdown } = ui
    const [snapshot, setSnapshot] = React.useState({ state: undefined, tickets: undefined, detail: undefined, settings: undefined, error: undefined, at: 0 })
    const [view, setView] = React.useState('tickets')
    const [selected, setSelected] = React.useState(0)
    const [busy, setBusy] = React.useState('')
    const [flash, setFlash] = React.useState('')
    const [help, setHelp] = React.useState(false)
    const [nonce, setNonce] = React.useState(0)
    const tick = ui.useAnimationTime(visible ? pollMs : null)
    const refresh = () => setNonce(value => value + 1)

    // One poll per clock tick while the panel is visible: `state` and the open
    // tickets refresh together, and a failed request keeps the last good data
    // (the error line explains what is missing).
    React.useEffect(() => {
      if (!visible) return undefined
      let alive = true
      const statePromise = api.state()
      const ticketsPromise = api.tickets('open', 60)
      Promise.allSettled([statePromise, ticketsPromise]).then(([stateResult, ticketsResult]) => {
        if (!alive) return
        setSnapshot(previous => ({
          ...previous,
          state: stateResult.status === 'fulfilled' ? stateResult.value : previous.state,
          tickets: ticketsResult.status === 'fulfilled' ? ticketsResult.value : previous.tickets,
          error: stateResult.status === 'rejected' ? failureText(stateResult.reason) : undefined,
          at: Date.now(),
        }))
      })
      return () => { alive = false }
    }, [tick, nonce, visible])

    const rows = Array.isArray(snapshot.tickets?.items) ? snapshot.tickets.items : []
    const selectedRow = rows[selected]
    const selectedId = view === 'ticket' ? snapshot.detail?.id ?? selectedRow?.id : selectedRow?.id

    // Ticket detail is fetched only while its view is open (and refreshed with
    // the same clock tick as the list).
    React.useEffect(() => {
      if (!visible || view !== 'ticket' || typeof selectedId !== 'string') return undefined
      let alive = true
      api.ticket(selectedId).then(value => {
        if (!alive) return
        setSnapshot(previous => ({ ...previous, detail: value }))
      }, error => {
        if (!alive) return
        setSnapshot(previous => ({ ...previous, error: failureText(error) }))
      })
      return () => { alive = false }
    }, [visible, view, selectedId, tick])

    // Read-only settings are fetched when the view is opened.
    React.useEffect(() => {
      if (!visible || view !== 'settings') return undefined
      let alive = true
      api.settings().then(value => {
        if (!alive) return
        setSnapshot(previous => ({ ...previous, settings: value }))
      }, error => {
        if (!alive) return
        setSnapshot(previous => ({ ...previous, error: failureText(error) }))
      })
      return () => { alive = false }
    }, [visible, view, tick])

    // Keep the selection inside the list as tickets come and go.
    React.useEffect(() => {
      const count = rows.length
      if (count === 0) { if (selected !== 0) setSelected(0); return }
      if (selected > count - 1) setSelected(count - 1)
    }, [rows.length, selected])

    // The flash message lives one clock tick: no private timer is started.
    React.useEffect(() => { if (flash !== '') setFlash('') }, [tick])

    const run = (label, action) => {
      setBusy(label)
      setFlash('')
      action().then(() => { setFlash(`${label}: done`); refresh() }, error => { setFlash(`${label}: ${failureText(error)}`) })
        .finally(() => { setBusy('') })
    }
    const state = snapshot.state
    const status = serviceStatus({ state, error: snapshot.error })
    const personCount = rows.filter(row => row.stage === 'person').length

    // The side-panel badge follows the tickets that wait for a person; the
    // panel itself never steals focus.
    React.useEffect(() => {
      if (!host) return
      if (personCount > 0) host.notify('warning', personCount)
      else host.clearBadge()
    }, [host, personCount])

    // Keys arrive only while the panel is focused; `preventDefault()` stops the
    // host's fallback handling of the same key.
    const live = React.useRef({})
    live.current = { view, selected, rows, selectedId, state, help }
    React.useEffect(() => {
      if (!host) return undefined
      return host.onKey(event => {
        const current = live.current
        const key = event.key ?? {}
        const input = typeof event.input === 'string' ? event.input : ''
        const take = () => { if (typeof event.preventDefault === 'function') event.preventDefault() }
        if (key.upArrow || input === 'k') {
          take(); setSelected(value => Math.max(0, value - 1)); return
        }
        if (key.downArrow || input === 'j') {
          take(); setSelected(value => Math.min(Math.max(0, current.rows.length - 1), value + 1)); return
        }
        if (key.return) {
          if (current.view === 'tickets' && current.rows.length > 0) { take(); setView('ticket'); return }
          if (current.view === 'ticket') { take(); setView('tickets'); return }
          return
        }
        if (key.escape) {
          if (current.help) { take(); setHelp(false); return }
          if (current.view === 'ticket') { take(); setView('tickets'); return }
          return
        }
        if (key.tab) {
          take()
          const index = VIEWS.indexOf(current.view === 'ticket' ? 'tickets' : current.view)
          setView(VIEWS[(index + 1) % VIEWS.length])
          return
        }
        if (input === '?') { take(); setHelp(value => !value); return }
        if (input === 'p') {
          take()
          const paused = current.state?.paused === true
          run(paused ? 'resume' : 'pause', () => api.pause(!paused))
          return
        }
        if (input === 'c') { take(); run('setup check', () => api.checkSetup()); return }
        if (input === 'r') {
          if (typeof current.selectedId !== 'string') return
          take()
          run('retry', () => api.retry(current.selectedId))
          return
        }
        if (input === 's') {
          if (typeof current.selectedId !== 'string') return
          take()
          run('stop', () => api.stop(current.selectedId))
        }
      })
    }, [host])

    // ── rendering ────────────────────────────────────────────────────────────
    const inner = Math.max(8, width - 2)
    const chrome = help ? 1 : 0
    const bodyLines = Math.max(4, height - 7 - chrome)
    const tone = { success: 'success', warning: 'warning', error: 'error', dim: 'subtle', subtle: 'subtle', accent: 'accent' }
    const textLine = (content, options = {}) => h(Text, { wrap: 'truncate-end', ...options }, content)

    const header = [
      h(Box, { key: 'title', flexDirection: 'row', justifyContent: 'space-between' },
        h(Text, { bold: true, color: 'accent' }, 'Superagent'),
        h(Text, { color: tone[status.tone] ?? 'subtle' }, status.text)),
      textLine(clip(accountsLine(state), inner), { dimColor: true }),
      textLine(clip(loadLine(state), inner), { dimColor: true }),
      textLine('─'.repeat(Math.max(2, Math.min(inner, 64))), { color: 'subtle' }),
    ]

    const ticketList = () => {
      if (rows.length === 0) return [textLine('No open tickets. Human requests become tickets here.', { dimColor: true })]
      const head = Math.max(0, Math.min(rows.length - bodyLines, selected - Math.floor(bodyLines / 2)))
      const visibleRows = rows.slice(head, head + bodyLines)
      return visibleRows.map((row, index) => {
        const absolute = head + index
        const isSelected = absolute === selected
        const avatar = `${isSelected ? '▸' : ' '}${stageGlyph(row)}`
        const right = `${age(row.updatedAt ?? row.createdAt)}${row.stage === 'person' ? ' !' : ''}`
        const title = `${pad(avatar + ' ' + stageLabel(row), 18)} ${clip(row.title ?? row.id ?? 'ticket', Math.max(4, inner - 19 - right.length - 1))}`
        return textLine(line(title, right, inner), {
          key: String(row.id ?? absolute),
          color: isSelected ? 'accent' : tone[stageTone(row)] ?? 'text',
          bold: isSelected,
        })
      })
    }

    const overviewBody = () => {
      const out = []
      const problem = problemText(state)
      if (problem) out.push(textLine(`! setup: ${problem}`, { color: 'warning' }))
      if (state?.paused) out.push(textLine('! executor paused: no ticket is running', { color: 'warning' }))
      const issues = healthErrors(state?.health)
      for (const issue of issues.slice(0, Math.max(1, Math.floor(bodyLines / 2)))) {
        out.push(textLine(`! ${issue.name}: ${clip(issue.detail, Math.max(8, inner - issue.name.length - 4))}`, { color: 'error' }))
      }
      if (out.length === 0) out.push(textLine('No problems reported.', { color: 'success' }))
      out.push(textLine(''))
      out.push(textLine(`open tickets: ${rows.length} (${personCount} waiting for you)`, { bold: true }))
      out.push(textLine(`updated: ${age(new Date(snapshot.at).toISOString())} ago`, { dimColor: true }))
      out.push(textLine(''))
      out.push(textLine('Newest tickets:', { dimColor: true }))
      for (const row of rows.slice(0, Math.max(1, bodyLines - out.length + 4))) {
        out.push(textLine(`${stageGlyph(row)} ${clip(row.title ?? row.id ?? 'ticket', inner - 12)}  ${age(row.updatedAt ?? row.createdAt)}`,
          { color: tone[stageTone(row)] ?? 'text' }))
      }
      return out
    }

    const settingsBody = () => {
      const settings = snapshot.settings
      const github = githubSource(settings)
      const executor = settings?.blocks?.executor?.value ?? {}
      const policy = settings?.blocks?.policy?.value ?? {}
      const allowed = policy?.sources?.github?.allowed ?? policy?.allowed
      const list = Array.isArray(allowed) ? allowed.map(entry => entry?.id ?? entry).filter(Boolean) : []
      const lines = [
        ['repo', github?.value?.config?.repository ?? state?.setup?.accounts?.repository ?? '—'],
        ['agent', github?.value?.config?.cli ?? state?.setup?.accounts?.agent ?? '—'],
        ['model', executor.model ?? '—'],
        ['workers', String(executor.maxWorkers ?? state?.load?.maxWorkers ?? '—')],
        ['directory', executor.directory ?? settings?.environment?.root ?? '—'],
        ['allowed', list.length ? list.join(', ') : 'nobody (no request can become a ticket)'],
        ['rules', String(Array.isArray(policy.rules) ? policy.rules.length : 0)],
        ['policy', settings?.policyVersion ?? '—'],
        ['stateDir', state?.setup?.machine?.stateDir ?? '—'],
      ]
      return lines.map(([name, value]) => textLine(`${pad(name, 10)} ${clip(value, Math.max(4, inner - 11))}`, { wrap: 'truncate-end' }))
    }

    const detailBody = () => {
      const detail = snapshot.detail
      if (!detail || typeof detail !== 'object') return [textLine('Loading ticket…', { dimColor: true })]
      const out = []
      out.push(textLine(clip(detail.title ?? detail.id ?? 'ticket', inner), { bold: true }))
      const facts = [`stage ${stageLabel(detail)}`, detail.strength ? `strength ${detail.strength}` : '', detail.state ?? '']
        .filter(Boolean).join(' · ')
      out.push(textLine(clip(facts, inner), { color: tone[stageTone(detail)] ?? 'text' }))
      if (detail.directory) out.push(textLine(clip(`directory ${detail.directory}`, inner), { dimColor: true }))
      if (detail.sessionId) out.push(textLine(clip(`session ${detail.sessionId}`, inner), { dimColor: true }))
      if (detail.deliveryError) out.push(textLine(clip(`delivery error: ${detail.deliveryError}`, inner), { color: 'error' }))
      const actions = [detail.actions?.retry ? '[r] retry' : '', detail.actions?.stop ? '[s] stop' : ''].filter(Boolean).join('  ')
      out.push(textLine(actions === '' ? 'no action available' : actions, { color: 'accent' }))
      out.push(textLine(''))
      if (detail.attention?.question) {
        out.push(textLine('Question for a person:', { bold: true }))
        out.push(h(Markdown, { key: 'question' }, String(detail.attention.question)))
      } else if (detail.summary) {
        out.push(textLine('Latest report:', { bold: true }))
        out.push(h(Markdown, { key: 'summary' }, String(detail.summary)))
      } else {
        out.push(textLine('No report or question yet.', { dimColor: true }))
      }
      return out
    }

    const body = help
      ? HELP.map(([keys, description]) => textLine(`${pad(keys, 12)} ${description}`, { key: keys }))
      : view === 'ticket' ? detailBody() : view === 'overview' ? overviewBody() : view === 'settings' ? settingsBody() : ticketList()

    // Markdown blocks can be taller than the viewport; the body is clipped to
    // the panel height so the footer always stays visible.
    const shownBody = help ? body : body.slice(0, Math.max(1, height - 8))

    const footer = [
      textLine('─'.repeat(Math.max(2, Math.min(inner, 64))), { color: 'subtle' }),
      flash !== ''
        ? textLine(clip(flash, inner), { color: 'warning' })
        : busy !== ''
          ? textLine(clip(`${busy}…`, inner), { color: 'warning' })
          : textLine(clip('↑↓ · ↵ open · p pause · r retry · s stop · c check · tab view · ? help', inner), { dimColor: true }),
      textLine(clip(`[${view === 'ticket' ? 'ticket' : view}]  ${snapshot.error ? `error: ${snapshot.error}` : `${focused ? 'focused' : 'tab to focus'}`}`, inner),
        { dimColor: true, color: snapshot.error ? 'error' : 'subtle' }),
    ]

    return h(Box, { flexDirection: 'column', flexGrow: 1, width }, header, ...shownBody, ...footer)
  }
}
