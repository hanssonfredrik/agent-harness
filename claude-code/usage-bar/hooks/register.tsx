import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { ModelWeek, UsageWindow } from '../types'

const STORE_KEY = 'isOn'
const LABEL_WIDTH = 14

const isOn = atom({ plugin: 'usage-bar', key: 'isOn' } as const, true)
const windows = atom({ plugin: 'usage-bar', key: 'windows' } as const, [])
const model = atom({ plugin: 'usage-bar', key: 'model' } as const, '')
const effort = atom({ plugin: 'usage-bar', key: 'effort' } as const, '')
const fable = atom({ plugin: 'usage-bar', key: 'fable' } as const, null)

/** $.store key holding the window kinds last received, to see what the engine really sends. */
const SEEN_KEY = 'seenKinds'
/** $.store key holding where the last Fable reading came from (or why there is none). */
const FABLE_SOURCE_KEY = 'fableSource'

/**
 * Where /usage reads the per-model weekly limits. The engine's own rate-limit windows
 * (`$.session.usage().rateLimits`) carry `five_hour` and `seven_day` only, never Fable's.
 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_HEADERS = { 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' }
/**
 * $.store key holding the last full reading (model, effort, windows, Fable), so tools outside
 * Claude Code (the Herdr layout's Usage panel) can show it without a credential of their own.
 */
const SNAPSHOT_KEY = 'snapshot'
/**
 * $.store key prefix for one session's context fill, followed by the Herdr terminal the session
 * runs in (HC_TERMINAL_ID), so the Herdr Usage panel can show the agent in its chat. Sessions
 * outside Herdr write none.
 */
const CONTEXT_PREFIX = 'context:'
/** A context reading older than this is removed at the next session start. */
const CONTEXT_MAX_AGE_MS = 24 * 60 * 60_000
/** The endpoint is rate limited: read it no more often than this. */
const FABLE_EVERY_MS = 5 * 60_000
/** A cached reading older than this is not shown. */
const CACHE_MAX_AGE_MS = 60 * 60_000
/** The window the Fable figure is shown on. */
const FABLE_ROW = 'seven_day'

const LEVELS = /\b(low|medium|high|xhigh|max)\b/i

let fableReadAt = 0
/** Where auto-compaction starts for `compactModel`; null when it is off or unknown. */
let compactAt: number | null = null
let compactModel: string | undefined
/** Set by a 429's retry-after: no request goes out before it, forced or not. */
let fableRetryAt = 0

function capitalize(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word
}

/** The label /usage would give a window: Session, Week, Spend limit. */
export function labelFor(kind: string): string {
  if (kind === 'five_hour') return 'Session'
  if (kind === 'seven_day') return 'Week'
  if (kind === 'spend_limit') return 'Spend limit'

  return kind.split('_').map(capitalize).join(' ')
}

function rank(kind: string): number {
  if (kind === 'five_hour') return 0
  if (kind === 'seven_day') return 1
  return 2
}

function toWindows(limits: readonly SessionRateLimit[]): UsageWindow[] {
  return limits
    .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind))
}

async function note($: EngineInterface, key: string, value: string): Promise<void> {
  try {
    if (value !== (await $.store.get(key))) await $.store.set(key, value)
  } catch {
    // Diagnostics only.
  }
}

/** Writes the current reading to $.store when it changed. Never fails the caller. */
async function publish($: EngineInterface): Promise<void> {
  try {
    const reading = {
      model: await read($, model),
      effort: await read($, effort),
      windows: await read($, windows),
      fable: await read($, fable),
    }
    if (!reading.model && reading.windows.length === 0) return
    const previous = await $.store.get(SNAPSHOT_KEY)
    const { at: _at, ...before } = isRecord(previous) ? previous : {}
    // The windows and Fable figure are the account's, not the session's: a session that has no
    // reading of them yet (just started or reloaded) keeps the last one any session saved.
    if (reading.windows.length === 0 && Array.isArray(before.windows)) reading.windows = before.windows
    if (!reading.fable && isRecord(before.fable)) reading.fable = before.fable as ModelWeek
    if (JSON.stringify(before) === JSON.stringify(reading)) return
    await $.store.set(SNAPSHOT_KEY, { ...reading, at: await $.clock.now() })
  } catch {
    // Outside readers only.
  }
}

/**
 * The token count auto-compaction starts at. It depends on the model only, so it is read once per
 * model, from the local `summary` breakdown, which sends no request.
 */
async function compactionThreshold($: EngineInterface): Promise<number | null> {
  const current = await read($, model)
  if (compactModel === current) return compactAt
  try {
    const breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    compactAt = breakdown?.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null
  } catch {
    compactAt = null
  }
  compactModel = current
  return compactAt
}

/** The store key of this session's context reading, or null outside a Herdr terminal. */
async function contextKey($: EngineInterface): Promise<string | null> {
  const terminal = await $.env.get('HC_TERMINAL_ID')
  return terminal ? `${CONTEXT_PREFIX}${terminal}` : null
}

/** Writes this session's context fill for the Herdr Usage panel. Never fails the caller. */
async function publishContext($: EngineInterface, context: SessionContextUsage): Promise<void> {
  try {
    const key = await contextKey($)
    if (!key) return
    await $.store.set(key, {
      tokens: context.tokens ?? null,
      window: context.window,
      compactAt: await compactionThreshold($),
      model: await read($, model),
      at: await $.clock.now(),
    })
  } catch {
    // Outside readers only.
  }
}

/** Removes context readings of sessions that ended long ago (a closed terminal leaves its own). */
async function pruneContexts($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now()
    for (const key of await $.store.keys()) {
      if (!key.startsWith(CONTEXT_PREFIX)) continue
      const value = await $.store.get(key)
      const at = isRecord(value) && typeof value.at === 'number' ? value.at : 0
      if (now - at > CONTEXT_MAX_AGE_MS) await $.store.delete(key)
    }
  } catch {
    // Housekeeping only.
  }
}

/** Stores the windows, and the kinds received in $.store so they can be checked from outside. */
async function setWindows($: EngineInterface, limits: readonly SessionRateLimit[]): Promise<void> {
  await update($, windows, () => toWindows(limits))
  await note($, SEEN_KEY, limits.map(l => `${l.kind}=${l.percentUsed}`).join(', '))
}

/** "in 2h 14m", "in 3d 4h", or "" when unknown or past. */
export function resetsIn(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.round(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `resets in ${days}d ${hours}h`
  if (hours > 0) return `resets in ${hours}h ${mins}m`
  return `resets in ${mins}m`
}

/** Percent left, one decimal at most, never below 0. */
function leftOf(percentUsed: number): number {
  return Math.max(0, Math.round((100 - percentUsed) * 10) / 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The Fable weekly limit in a /usage response:
 * `{ limits: [{ kind: "weekly_scoped", percent, scope: { model: { display_name: "Fable" } } }] }`.
 */
export function fableOf(body: unknown): ModelWeek | undefined {
  if (!isRecord(body) || !Array.isArray(body.limits)) return undefined
  for (const limit of body.limits) {
    if (!isRecord(limit) || limit.kind !== 'weekly_scoped' || typeof limit.percent !== 'number') continue
    const scope = limit.scope
    const name = isRecord(scope) && isRecord(scope.model) ? scope.model.display_name : undefined
    if (typeof name === 'string' && /fable/i.test(name)) {
      const week: ModelWeek = { name, percentUsed: limit.percent }
      if (typeof limit.resets_at === 'string') week.resetsAt = limit.resets_at
      return week
    }
  }
  return undefined
}

/** The effort level a `/effort` run set, read from what was typed or what the command printed. */
export function effortOf(args: string, text: string | undefined): string {
  const match = LEVELS.exec(args) ?? LEVELS.exec(text ?? '')
  return match ? match[1]!.toLowerCase() : ''
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The /usage endpoint, with the session's own credential (which stays on the host). */
async function fableFromApi($: EngineInterface): Promise<{ found?: ModelWeek; source: string }> {
  if ((await $.clock.now()) < fableRetryAt) return { source: 'api: waiting out a rate limit' }
  const auth = await $.session.authorize()
  if (!auth) return { source: 'api: no first-party login' }
  const response = await $.http.fetch(USAGE_URL, { headers: USAGE_HEADERS, auth: auth.handle })
  if (!response.ok) {
    const retry = Number(response.headers['retry-after'])
    if (response.status === 429) {
      fableRetryAt = (await $.clock.now()) + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : FABLE_EVERY_MS)
    }
    const detail = response.status === 429 ? `rate limited${retry > 0 ? `, retry in ${retry}s` : ''}` : response.text.slice(0, 120)
    return { source: `api: ${response.status} ${detail}`.trim() }
  }
  const found = fableOf(parse(response.text))
  return { found, source: found ? 'api' : 'api: no Fable limit in the response' }
}

/** The reading Claude Code itself last kept from that endpoint, in its global config. */
async function fableFromCache($: EngineInterface): Promise<ModelWeek | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return undefined
  const config = parse(await $.fs.read(`${home}/.claude.json`))
  const cached = isRecord(config) ? config.cachedUsageUtilization : undefined
  if (!isRecord(cached) || typeof cached.fetchedAtMs !== 'number') return undefined
  const age = (await $.clock.now()) - cached.fetchedAtMs
  return age >= 0 && age <= CACHE_MAX_AGE_MS ? fableOf(cached.utilization) : undefined
}

/** Re-reads the Fable weekly limit, at most every FABLE_EVERY_MS unless `force`. */
async function refreshFable($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  if (!force && now - fableReadAt < FABLE_EVERY_MS) return
  fableReadAt = now

  let found: ModelWeek | undefined
  let source: string
  try {
    ;({ found, source } = await fableFromApi($))
  } catch (error) {
    source = `api: ${error instanceof Error ? error.message : 'failed'}`
  }
  if (!found) {
    try {
      found = await fableFromCache($)
      source += found ? '; shown from the cached reading' : '; no cached reading'
    } catch {
      source += '; cached reading unreadable'
    }
  }
  if (found) {
    const next = found
    await update($, fable, () => next)
  }
  await note($, FABLE_SOURCE_KEY, `${source}${found ? ` (${found.name}=${found.percentUsed})` : ''}`)
}

async function setEffort($: EngineInterface, level: unknown): Promise<void> {
  const next = typeof level === 'string' || typeof level === 'number' ? String(level) : ''
  if (next && next !== (await read($, effort))) {
    await update($, effort, () => next)
    await publish($)
  }
}

function colorFor(percentUsed: number): string {
  if (percentUsed >= 80) return 'red'
  if (percentUsed >= 50) return 'yellow'
  return 'green'
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    await setWindows($, usage.rateLimits)
  } catch {
    // No reading yet: keep what we had.
  }
  await refreshModel($)
  await refreshFable($, true)
  await publish($)
}

/**
 * The engine raises no event when the model changes, so this re-reads it at the moments it can
 * have changed (a slash command such as /model, a turn, a response). Writes only on a change.
 */
async function refreshModel($: EngineInterface): Promise<void> {
  try {
    const current = await $.session.model()
    if (current !== (await read($, model))) {
      await update($, model, () => current)
      await publish($)
    }
  } catch {
    // Not readable here: keep what we had.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-bar',
      description: 'Toggle the plan usage bars (session, week with Fable) above the prompt',
    })

    const stored = await $.store.get(STORE_KEY)
    if (typeof stored === 'boolean') await update($, isOn, () => stored)

    const result = await next(e)
    await refresh($)
    await pruneContexts($)
    try {
      await publishContext($, (await $.session.usage()).context)
    } catch {
      // No reading yet.
    }
    return result
  })

  // An ended session's reading would show a stale fill for its terminal.
  on('session.end', async ($, e, next) => {
    try {
      const key = await contextKey($)
      if (key) await $.store.delete(key)
    } catch {
      // Housekeeping only.
    }
    return next(e)
  })

  // The effort the main loop's requests really ask for. Nothing is shown before the first one (or
  // a /effort): the settings do not say what the engine resolves per model, and a wrong level is
  // worse than none.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      try {
        await setEffort($, e.effort)
      } catch {
        // Keep what we had; never hold up the request.
      }
    }
    return yield* next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)
    await $.store.set(STORE_KEY, now)
    if (now) await refresh($)

    return { text: now ? 'Usage bar on.' : 'Usage bar off.' }
  })

  // Any other slash command: /model changes the model, /effort the effort, at once.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    if (e.command === 'effort') await setEffort($, effortOf(e.args, result.text))
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    await refreshModel($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('rateLimits')) {
      await setWindows($, e.rateLimits)
      await refreshFable($)
      await publish($)
    }
    await refreshModel($)
    if (e.changed.includes('context')) await publishContext($, e.context)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)

    const list = await read($, windows)
    const current = await read($, model)
    const level = await read($, effort)
    const scoped = await read($, fable)
    if (list.length === 0 && !current) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const barWidth = Math.max(10, Math.min(40, e.props.bodyColumns - LABEL_WIDTH - 34))

    return (
      <Box flexDirection="column">
        {current ? (
          <Text wrap="truncate-end">
            <Text bold>{'Model'.padEnd(LABEL_WIDTH)}</Text>
            {current}
            {level ? <Text dimColor>{`  · effort ${level}`}</Text> : null}
          </Text>
        ) : null}
        {list.map(w => {
          const used = Math.min(100, Math.max(0, w.percentUsed))
          const filled = Math.round((used / 100) * barWidth)
          const reset = resetsIn(w.resetsAt, now)
          const inRow = w.kind === FABLE_ROW ? scoped : null

          return (
            <Text wrap="truncate-end">
              <Text bold>{labelFor(w.kind).padEnd(LABEL_WIDTH)}</Text>
              <Text color={colorFor(w.percentUsed)}>{'█'.repeat(filled)}</Text>
              <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
              {`  ${leftOf(w.percentUsed)}%`}
              {inRow ? (
                <Text color={colorFor(inRow.percentUsed)}>
                  {` (${leftOf(inRow.percentUsed)}% ${inRow.name.toLowerCase()})`}
                </Text>
              ) : null}
              {' left'}
              {reset ? <Text dimColor>{`  · ${reset}`}</Text> : null}
            </Text>
          )
        })}
      </Box>
    )
  })
}
