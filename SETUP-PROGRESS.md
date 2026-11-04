# dsh-superagent Setup — Progress Log

Environment: Ubuntu 24.04 container (root), DSH `0.2.1-rc.2`, operator profile `dsh-tui`.
Started: 2026-11-04 (UTC), from the checkout at `/root/dsh-superagent-prototype`.
Follows `SETUP.md`; every decision below was confirmed by the operator.

## 1. Environment probe (SETUP.md §1)

| Check | Found | Requirement | OK? |
| --- | --- | --- | --- |
| Node.js | v24.21.0 | 22.19+ or 24+ | yes |
| pnpm | 11.7.0 | present | yes |
| git | 2.43.0 | 2.32+ | yes |
| tmux | 3.4 | present | yes |
| Python 3 | 3.12.3 | 3.8+ | yes |
| GitHub CLI | installed during setup | 2.48+ | yes |
| DSH | 0.2.1-rc.2 | `^0.2.1-alpha.2` (`engines.dsh`) | yes |
| lark-cli | missing | Feishu only | n/a (GitHub only) |
| Existing `dsh-superagent` profile | none | — | fresh install |

## 2. Operator decisions (SETUP.md §2, one question per message)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Sources | GitHub only (no Feishu) |
| 2 | Repository | New repo **`alvgot/superagent-sandbox`** (operator's personal account; the first answer — this checkout — was retracted) |
| 3 | Agent account | New dedicated GitHub account **`dsh-superagent-alv`** (availability checked via public API; `dsh-superagent` is taken) |
| 4 | Feishu chats | n/a (no Feishu) |
| 5 | Who may ask on GitHub | Only **`alvgot`** |
| 6 | Who may ask on Feishu | n/a |
| 7 | Ticket checkout | Fresh clone under **`/root/src/superagent-sandbox`** |
| 8 | Commit identity | The agent account (`dsh-superagent-alv`) |
| 9 | Auto-merge | No — people merge |

Operator login resolved: `alvgot` (confirmed from repo `alvgot/puralvos`).

**Later instruction (highest priority):** "you have to port this for dsh-tui no web
browser we stay in terminal" — the operator has no browser, so the web panel had to
be replaced by a terminal surface. The bundle work lives in the operator's fork
`alvgot/dsh-superagent-prototype` (this checkout, `origin` now points there).

## 3. Confirmed plan (operator confirmed 2026-11-04)

- **Install:** GitHub CLI; `pnpm install` + `pnpm check`; separate DSH profile `superagent` (copy of the Web profile), port **3082**, state dir `/root/.dsh/state/superagent`; install the bundle into that profile and start it.
- **Accounts:** new repo `alvgot/superagent-sandbox`; new agent account `dsh-superagent-alv` with write access.
- **Operator steps:** create the agent account; sign in to `gh-agent`; create the repo and grant the agent account write access (accept the invitation as the agent account if offered).
- **Settings:** GitHub source `alvgot/superagent-sandbox` acting as `dsh-superagent-alv`; policy allows only `alvgot`; fresh clone per ticket under `/root/src/superagent-sandbox`; prompts: commits authored as the agent account, no auto-merge; defaults: branch prefix `agent/`, accept mode `observe`.
- **Terminal port (added later):** plugin `dsh-superagent-tui` in `tui/`, installed into the `dsh-tui` profile, so the panel and status live in the terminal.
- **Verify:** `scripts/dsh-superagent status` exits 0; hourly self-repair check; handover.

## 4. Done

1. Read `SETUP.md`, `docs/000-philosophy.md` and `docs/006-deployment.md`; ran the probe.
2. Collected all nine answers; presented the plan; operator confirmed.
3. Installed GitHub CLI; wrote `~/.local/bin/gh-agent` (isolated `GH_CONFIG_DIR=~/.config/gh-agent`).
4. Created the SSH keypair for the fork; operator added it as a deploy key. `git ls-remote` against `git@github.com:alvgot/dsh-superagent-prototype.git` works (`Hi alvgot/puralvos`).
5. Created the `superagent` profile (web template, `webserver` on 3082, `stateDir /root/.dsh/state/superagent`) and linked this checkout into it.
6. **Started the service**: `tmux` session `dsh-superagent`, pid 501189, answering on `127.0.0.1:3082`; it waits for setup (`repositoryUnset`) until the GitHub Source is saved.
7. Wrote the terminal port in `tui/` (panel, footer field, shortcuts, loopback client) and installed it into the `dsh-tui` profile as a `link:`.
8. Operator created `dsh-superagent-alv` and `alvgot/superagent-sandbox`, signed `gh-agent` in and invited the agent; I accepted the invitation as the agent (`push: true`, `triage: true`).
9. Cloned the base checkout to `/root/src/superagent-sandbox` (the prepare command adds one worktree per Ticket from it).
10. Saved all four settings blocks through the Management API: `source:github` (`alvgot/superagent-sandbox`, CLI `/root/.local/bin/gh-agent`), `policy` (allowed: `alvgot`), `executor` (`/root/src` + worktree prepare command), `prompts` (commit author `dsh-superagent-alv`, auto-merge paragraph removed).
11. **Setup resolved**: `state.setup.problem` is `null`, accounts read `alvgot/superagent-sandbox` → `dsh-superagent-alv`, the GitHub Source reports `ready` ("0 notifications; next poll ≥ 60s"), and `scripts/dsh-superagent status` exits 0.
12. Installed the hourly check as a cron job (17 * * * *): exit 0/2/3 do nothing but are logged to `.artifacts/hourly-check.log`; only exit 1 runs `--respect-stop restart`.

## 5. Defects found while getting the gate green (all fixed)

`pnpm check` (typecheck + 1197 tests + build) is the gate before starting the service. It failed for environment and code reasons, not just missing setup:

1. **`NODE_ENV=production` in this shell breaks every jsdom `.tsx` suite** — Vite externalizes `node:` builtins to a bare `__vite-browser-external` stub in production mode and Vitest maps it back to the invalid specifier `node:`. Not a repo defect: run tests as `NODE_ENV=test pnpm check`. (Diagnosed from the Vite client warning and an ESM trace; a Vite 7 pin was tried and reverted.)
2. **Leftover `tests/tmp-bisect.spec.tsx`** from the earlier diagnosis made `tests/docs.spec.ts` fail (undocumented test file). Removed.
3. **Feishu consumer race** (`src/sources/feishu-loops.ts`): stdout and stderr are separate pipes, so a run's `[event] ready` line could be read *after* an event line that failed to parse and overwrite the error with "ready". A `failed` flag now keeps the error for the rest of the run.
4. **`scripts/dsh-superagent` could not see its own service**: it matched the `ps` `comm` column against `node`/`dsh`, but this Node build names its main thread, so the column reads `MainThread`. `status` reported no PIDs and `start` timed out after starting the service. Process detection now matches the command line (`node …/dsh`, or `dsh`) instead.
5. **The TUI plugin was a silent no-op on a cold start** (`tui/src/index.js`): a profile plugin is composed before the TUI host registers `tuiPanels` / `tuiStatus` / `tuiShortcuts`, so `ctx.get(name, false)` returned `undefined` at `apply` time and the plugin registered nothing. It now waits for each seam with `ctx.inject`, so the bodies run when the service exists (and re-run if it is replaced).
6. **`alt+s` is dsh-TUI's own "star the repo" action** — the host refuses a reserved combo with a silent no-op disposer. The panel shortcut is now `alt+a` (plus `ctrl+shift+s` where the terminal reports the shift bit), and registration is confirmed against `shortcuts.list()`.

## 6. The terminal port, verified

Verified in an isolated copy of the `dsh-tui` profile (`dsh --profile tui-probe`, its own process and state), not by restarting the operator's session:

- the side panel registers and opens (`alt+a`): header `Superagent — setup needed`, `no repository configured`, `workers 0/3 · queued 0 · executor running`, ticket list, footer hint `Esc chat · ←/→ panels · z zoom · +/- width`;
- the footer field renders `sa setup` in the prompt footer (and would show `sa 1/3`, `sa paused`, `sa off`);
- the plugin's loopback client reaches the running service (the state it renders comes from `/orchestrator/api/state`).

The fix only reaches the operator's own `dsh-tui` process on its next start: the
running process keeps the module it loaded before the fix (DSH does not watch
linked plugin sources).

## 7. Verification log

| Check | Result |
| --- | --- |
| `NODE_ENV=test pnpm check` | exit 0 — typecheck, 1197 tests / 59 files, build |
| `python3 scripts/dsh-superagent status` | exit 0 — `setup: null`, no part errors, GitHub Source `ready` |
| `GET state` | `accounts.repository alvgot/superagent-sandbox`, `accounts.agent dsh-superagent-alv` |
| `GET sources` | `state: ready`, "0 notifications; next poll ≥ 60s" |
| `gh-agent api /notifications` | 200 with a classic token (403 before: an App user token cannot read notifications) |
| `dsh --profile dsh-tui --dump-config` | contains `- id: superagent-tui` with `url` and `pollMs` |
| plugin manifest (template checker) | PASS |
| terminal probe | panel opens, footer field renders, API data shown |
| hourly cron | installed, dry-run under cron's minimal env exits 0 |
| `git push origin main` | 4 commits pushed to `alvgot/dsh-superagent-prototype` over the deploy key |

## 8. First end-to-end run (passed)

A deliberately small, rule-matching request, so the whole path could be checked once:

- **Request** (by `alvgot`, comment on `alvgot/superagent-sandbox#1`): fix the typo in `docs/greeting.md`.
  The file was seeded with `Weclome` so the request matched the enabled *Copy fixes* rule.
- **Source**: the mention arrived through the agent account's notifications; the poll reported
  `1 notifications`, `filtered: 0`.
- **Ticket** `3b212a3f…`: stage `working`, strength *explicit*, one assignment, worktree
  `/root/src/fix-greeting-typo-3b212a3f01ef` on branch `agent/fix-greeting-typo-3b212a3f01ef`.
- **Delivery**: commit `fd322a6` authored by `dsh-superagent-alv`, branch pushed, PR #2 opened with a
  one-line diff and a reply on the issue; the ticket moved to stage `person`.
- **Human merge** by `alvgot` (`20ef488`): the next poll saw it, closed the ticket (stage `ended`,
  threads dormant) and `main` now carries the fix.
- **Timings**: comment 17:36:27 → ticket 17:37:22 (one poll cycle) → PR 17:37:58; merge 17:43 → ticket
  ended 17:44.
- **Terminal surface**: the panel showed the ticket in `person`, then the empty list and `sa 0/3`; the
  footer cell tracked the service throughout.

The port is documented in `docs/009-tui.md` (linked from `README.md`) and in `tui/README.md`.

## 9. Pending

1. **Rotate the classic token**: it was pasted into the chat transcript, so treat it as exposed. It only
   reaches `alvgot/superagent-sandbox` (dedicated account), but rotating is cheap: create a new classic
   token with `repo`, `notifications`, `read:org` and run `printf '%s' '<token>' |
   ~/.local/bin/gh-agent auth login --hostname github.com --with-token`.
2. **Give it a real task** when ready: a slightly larger request in the sandbox, then judge the PR scope
   and wording; tune the prompts before widening the allowed list or turn on proactive work.

## 10. Notes


- Run the test suite with `NODE_ENV=test` in this environment; the ambient
  `NODE_ENV=production` is what breaks jsdom, not the repository.
- `dsh` and `pnpm` in this container are recent Node 24 builds; the service script's
  process detection was adjusted for the `MainThread` thread name.
- Authentication: `gh`'s device flow through the CLI's app issued a GitHub-App user
  token (`ghu_`), which cannot read `/notifications`; the GitHub Source therefore
  failed until a classic token (`ghp_`, scopes `repo` + `notifications`) replaced it.
  `gh auth login --with-token` refuses a token without `read:org`, so the token was
  written into `~/.config/gh-agent/hosts.yml` directly; `gh auth status` shows that
  scope as a warning, and nothing here needs it.
- Generated artifacts live in `.artifacts/` (git-ignored): service logs, control
  markers and `hourly-check.log`.
