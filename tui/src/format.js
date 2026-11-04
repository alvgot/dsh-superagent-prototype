/**
 * Pure formatting for the terminal panel: every screen line is built here as a
 * plain string so the panel body can truncate deterministically to the panel
 * width (ink only truncates text whose container has a definite width).
 */

/** Tones accepted by `tuiStatus.setField` and by the theme-aware Text. */
export const TONES = { ready: 'success', attention: 'warning', error: 'error', idle: 'dim' }

/** Clip `text` to at most `cells` characters, appending an ellipsis when cut. */
export function clip(text, cells) {
  const value = String(text ?? '').replaceAll(/\s+/gu, ' ').trim()
  const limit = Math.max(1, Math.trunc(cells))
  const chars = [...value]
  if (chars.length <= limit) return value
  if (limit <= 1) return '…'
  return `${chars.slice(0, limit - 1).join('')}…`
}

/** Right-pad `text` with spaces to exactly `cells` characters (never truncates). */
export function pad(text, cells) {
  const value = String(text ?? '')
  const chars = [...value]
  return chars.length >= cells ? chars.slice(0, cells).join('') : value + ' '.repeat(cells - chars.length)
}

/** Fixed-width one-line row: `left` padded, then the right side clipped and right aligned. */
export function line(left, right, cells) {
  const width = Math.max(4, Math.trunc(cells))
  const leftText = clip(left, width)
  const rightText = clip(right, width)
  const leftCells = [...leftText].length
  const rightCells = [...rightText].length
  if (leftCells + rightCells + 1 > width) return clip(`${leftText} ${rightText}`, width)
  return `${leftText}${' '.repeat(width - leftCells - rightCells)}${rightText}`
}

/** Relative age of an ISO timestamp: `12s`, `5m`, `3h`, `2d`, `—`. */
export function age(iso, now = Date.now()) {
  if (typeof iso !== 'string' || iso === '') return '—'
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '—'
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

const STAGE_LABELS = {
  'working': 'working',
  'person': 'person',
  'idle': 'idle',
  'ended': 'ended',
}
const ACTION_LABELS = {
  'queued': 'queued',
  'delivery': 'delivery',
  'answer': 'question',
  'review': 'review',
  'blocked': 'blocked',
  'failed': 'failed',
}
/** One ticket's stage as `working/queued`, `person/review`, `idle`, … */
export function stageLabel(row) {
  if (!row || typeof row !== 'object') return 'unknown'
  const stage = STAGE_LABELS[row.stage] ?? row.stage ?? 'unknown'
  const action = ACTION_LABELS[row.action] ?? row.action
  return action ? `${stage}/${action}` : stage
}

/** Theme color for a ticket row; `error`-toned only when the row reports a failure. */
export function stageTone(row) {
  if (!row || typeof row !== 'object') return 'subtle'
  if (row.action === 'failed' || row.action === 'blocked' || row.deliveryError) return 'error'
  if (row.stage === 'person') return 'warning'
  if (row.stage === 'working') return 'accent'
  if (row.stage === 'idle') return 'success'
  return 'subtle'
}

/** Stage-glyph for compact rows (`●` working, `◆` person, `○` idle, `·` ended). */
export function stageGlyph(row) {
  if (!row || typeof row !== 'object') return '·'
  if (row.stage === 'working') return '●'
  if (row.stage === 'person') return '◆'
  if (row.stage === 'idle') return '○'
  return '·'
}

/**
 * Header status for the whole service.
 * @param {{state?: unknown, error?: string, offline?: boolean}} input
 * @returns {{text: string, tone: string}}
 */
export function serviceStatus({ state, error, offline } = {}) {
  if (offline) return { text: 'offline', tone: 'error' }
  if (error) return { text: 'unreachable', tone: 'error' }
  if (!state || typeof state !== 'object') return { text: 'starting', tone: 'dim' }
  if (state.setup?.problem) return { text: 'setup needed', tone: 'warning' }
  if (state.paused) return { text: 'paused', tone: 'warning' }
  const load = state.load ?? {}
  const errors = healthErrors(state.health)
  if (errors.length) return { text: 'attention', tone: 'warning' }
  return { text: 'ready', tone: 'success' }
}

/** Executor line: `workers 1/3 · queued 2 · executor running|paused`. */
export function loadLine(state) {
  if (!state || typeof state !== 'object') return 'executor —'
  const load = state.load ?? {}
  const running = Number(load.running ?? 0)
  const max = Number(load.maxWorkers ?? 0)
  const queued = Number(load.queued ?? 0)
  const paused = state.paused ? 'paused' : 'running'
  return `workers ${running}/${max} · queued ${queued} · executor ${paused}`
}

/** Non-ready health entries as `name: detail` lines. */
export function healthErrors(health) {
  if (!health || typeof health !== 'object') return []
  return Object.entries(health)
    .filter(([, value]) => value && typeof value === 'object' && value.state !== 'ready')
    .map(([name, value]) => ({ name, state: value.state ?? 'error', detail: String(value.detail ?? '') }))
}

/** Setup problem text (or `''`). */
export function problemText(state) {
  const problem = state?.setup?.problem
  if (!problem || typeof problem !== 'object') return ''
  return String(problem.detail ?? problem.code ?? 'setup is incomplete')
}

/** Source/account line: `repo owner/name · agent login`. */
export function accountsLine(state) {
  const accounts = state?.setup?.accounts
  if (!accounts || typeof accounts !== 'object') return 'no repository configured'
  const repo = accounts.repository ?? '—'
  const agent = accounts.agent ?? '—'
  return `repo ${repo} · agent ${agent}`
}

/** Footer text/detail for `tuiStatus.setField`, derived from state + person count. */
export function footerField(state, personCount = 0, error) {
  if (error) return { text: 'sa off', tone: 'error', detail: `dsh-superagent is unreachable: ${error}` }
  if (!state || typeof state !== 'object') return { text: 'sa …', tone: 'dim', detail: 'waiting for the service' }
  if (state.setup?.problem) {
    return { text: 'sa setup', tone: 'warning', detail: `Setup is incomplete: ${problemText(state)}` }
  }
  if (state.paused) return { text: 'sa paused', tone: 'warning', detail: 'The executor is paused; no ticket runs.' }
  const load = state.load ?? {}
  const running = Number(load.running ?? 0)
  const max = Number(load.maxWorkers ?? 0)
  const queued = Number(load.queued ?? 0)
  const wait = personCount > 0 ? ` · ${personCount} waiting for you` : ''
  const text = `sa ${running}/${max}${queued > 0 ? `+${queued}` : ''}${personCount > 0 ? ' !' : ''}`
  const tone = personCount > 0 || queued > 0 ? 'warning' : 'success'
  return { text, tone, detail: `dsh-superagent ready: workers ${running}/${max}, queued ${queued}${wait}` }
}

/** Read the GitHub source block out of a settings view. */
export function githubSource(settings) {
  const sources = Array.isArray(settings?.sources) ? settings.sources : []
  return sources.find(source => source?.kind === 'github') ?? sources[0]
}
