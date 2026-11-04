/**
 * Loopback client for the dsh-superagent management API.
 *
 * The API contract is the one the web panel uses (`src/app/api.ts`,
 * documented in `docs/006-deployment.md`); this client only removes the
 * browser: absolute loopback URLs and the `x-orchestrator-request` header the
 * host's same-origin check requires. The service answers on 127.0.0.1 only, so
 * no credential ever leaves the machine and no page is involved.
 */

const TIMEOUT_MS = 4000
/** Errors carry the host's structured setup problem when there is one. */
export class ApiFailure extends Error {
  constructor(message, { status = 0, unreachable = false, setup } = {}) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.unreachable = unreachable
    this.setup = setup
  }
}
/** Human text for any thrown value, including the API's SetupProblem payload. */
export function failureText(error) {
  if (error instanceof ApiFailure) return error.setup?.detail ?? error.setup?.code ?? error.message
  return error instanceof Error ? error.message : String(error)
}

export function createApi(baseUrl) {
  const origin = String(baseUrl ?? '').replace(/\/+$/u, '')
  if (!origin) throw new Error('dsh-superagent-tui: config.url is required')
  const root = `${origin}/orchestrator/api/`

  async function call(path, { method = 'GET', body } = {}) {
    const headers = { 'x-orchestrator-request': '1' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new ApiFailure(`dsh-superagent is not reachable at ${origin}`, { unreachable: true })
    }
    let text = ''
    try {
      text = await response.text()
    } catch {
      // A body that cannot be read is handled like an empty one below.
    }
    let value
    try {
      value = text ? JSON.parse(text) : {}
    } catch {
      value = undefined
    }
    if (!response.ok) {
      const failure = value !== null && typeof value === 'object' ? value : {}
      const message = typeof failure.error === 'string' ? failure.error
        : failure.setup?.detail ?? failure.setup?.code ?? `request failed (${response.status})`
      throw new ApiFailure(message, {
        status: response.status,
        setup: failure.setup,
        // The DSH web server answers an empty 404 while the bundle routes are unmounted.
        unreachable: !text && response.status === 404,
      })
    }
    return value
  }

  return {
    origin,
    /** `GET state`: setup, executor load, paused flag and component health. */
    state: () => call('state'),
    /** `GET tickets?state=…`: ticket rows for one stage filter. */
    tickets: (state = 'open', limit = 40) =>
      call(`tickets?state=${encodeURIComponent(state)}&limit=${encodeURIComponent(String(limit))}`),
    /** `GET tickets/:id`: full ticket page (summary, mandate, threads, environment). */
    ticket: id => call(`tickets/${encodeURIComponent(id)}`),
    /** `GET settings`: settings blocks, source configuration and execution root. */
    settings: () => call('settings'),
    /** `POST executor/pause`: pause or resume the executor. */
    pause: paused => call('executor/pause', { method: 'POST', body: { paused } }),
    /** `POST tickets/:id/retry`: retry a blocked or failed ticket. */
    retry: id => call(`tickets/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
    /** `POST tickets/:id/stop`: stop a live ticket. */
    stop: id => call(`tickets/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
    /** `POST setup/check`: re-run setup checks; the bundle restarts when they change. */
    checkSetup: () => call('setup/check', { method: 'POST' }),
  }
}
