import { describe, expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { effortOf, fableOf, labelFor, resetsIn } from './register'

const NOW = Date.parse('2026-10-03T10:00:00Z')

// What the engine really reports: the session and week windows, never a per-model one.
const usage: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 21, resetsAt: '2026-10-06T14:00:00Z' },
    { kind: 'five_hour', percentUsed: 62, resetsAt: '2026-10-03T12:14:00Z' },
  ],
}

// The /usage endpoint's body, cut down from a real reading.
const usageBody = (fablePercent: number) => ({
  five_hour: null,
  seven_day: { utilization: 22, resets_at: '2026-11-19T07:00:00.996326+01:00' },
  seven_day_opus: null,
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 22, scope: null, is_active: false },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: fablePercent,
      resets_at: '2026-11-19T06:59:59.996505+01:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      is_active: true,
    },
  ],
})

const runToggle = {
  command: 'usage-bar',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const bandProps = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

describe('labels, resets and readings', () => {
  test('names the windows as /usage does', () => {
    expect(labelFor('five_hour')).toBe('Session')
    expect(labelFor('seven_day')).toBe('Week')
    expect(labelFor('spend_limit')).toBe('Spend limit')
  })

  test('formats the time to reset', () => {
    expect(resetsIn('2026-10-03T12:14:00Z', NOW)).toBe('resets in 2h 14m')
    expect(resetsIn('2026-10-06T14:00:00Z', NOW)).toBe('resets in 3d 4h')
    expect(resetsIn('2026-10-03T09:00:00Z', NOW)).toBe('')
    expect(resetsIn(undefined, NOW)).toBe('')
  })

  test('finds the Fable weekly limit in a /usage response', () => {
    expect(fableOf(usageBody(60))).toEqual({
      name: 'Fable',
      percentUsed: 60,
      resetsAt: '2026-11-19T06:59:59.996505+01:00',
    })
    expect(fableOf({ limits: [{ kind: 'weekly_all', percent: 22, scope: null }] })).toBeUndefined()
    expect(fableOf({ seven_day: { utilization: 22 } })).toBeUndefined()
    expect(fableOf(undefined)).toBeUndefined()
  })

  test('reads the level /effort set', () => {
    expect(effortOf('', 'Set effort level to medium (saved as your default for new sessions): Balanced')).toBe(
      'medium',
    )
    expect(effortOf('xhigh', undefined)).toBe('xhigh')
    expect(effortOf('', undefined)).toBe('')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: bars, Fable in the Week row, live model and effort, and /usage-bar hides them`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: usage }))
    let current = 'claude-fable-5-2'
    on('session.model', () => ({ value: current }))
    on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
    const asked: string[] = []
    on('http.fetch', ($, e) => {
      asked.push(`${e.url} ${e.init?.auth}`)
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(usageBody(60)) } }
    })
    // The engine's own /model and /effort, which the test has to stand in for.
    on('command.run', { command: 'model' }, () => ({ text: '' }))
    on('command.run', { command: 'effort' }, () => ({
      text: 'Set effort level to medium (saved as your default for new sessions): Balanced approach',
    }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine band</Text>
    })

    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    expect(asked[0]).toBe('https://api.anthropic.com/api/oauth/usage h')

    const mount = () => $.ui.mount({ plugin: 'usage-bar', surface, component: 'AbovePrompt', props: bandProps })
    const band = await mount()
    const rows = (await band.findAll({ type: 'Text', text: /^(Session|Week).*left/ })).map(el => el.text)
    expect(rows.length).toBe(2)
    expect(rows[0]).toMatch(/^Session/)
    expect(rows[0]).toContain('38% left')
    expect(rows[0]).toContain('resets in 2h 14m')
    expect(rows[1]).toMatch(/^Week\s/)
    expect(rows[1]).toContain('79% (40% fable) left')
    // No level is claimed before a request or /effort has given one.
    expect((await band.find({ type: 'Text', text: /^Model/ }))?.text).toMatch(/^Model\s+claude-fable-5-2$/)

    // /effort shows at once, before any request is made at the new level.
    await $.command.run({ ...runToggle, command: 'effort' })
    expect((await (await mount()).find({ type: 'Text', text: /^Model/ }))?.text).toMatch(/· effort medium$/)

    // A reload runs session.start again: the live level stays.
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    expect((await (await mount()).find({ type: 'Text', text: /^Model/ }))?.text).toMatch(/· effort medium$/)

    // /model runs as a slash command; the band shows the new model once it has run.
    current = 'claude-sonnet-5-5'
    await $.command.run({ ...runToggle, command: 'model', args: 'sonnet' })
    expect((await (await mount()).find({ type: 'Text', text: /^Model/ }))?.text).toMatch(/claude-sonnet-5-5/)

    expect((await $.command.run(runToggle)).text).toBe('Usage bar off.')
    const hidden = await mount()
    expect(await hidden.find({ text: /% left/ })).toBeUndefined()
    expect(await hidden.find({ text: 'engine band' })).toBeDefined()
  })
}

test('falls back to the cached reading when the endpoint refuses, and to no figure without one', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usage }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  let config = JSON.stringify({ numStartups: 3 })
  const read: string[] = []
  on('fs.read', ($, e) => {
    read.push(e.path)
    return { value: config }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  const mount = () =>
    $.ui.mount({ plugin: 'usage-bar', surface: 'terminal', component: 'AbovePrompt', props: bandProps })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(read.length).toBe(1)
  expect(read[0]?.replaceAll('\\', '/')).toBe('C:/Users/me/.claude.json')
  expect((await (await mount()).find({ type: 'Text', text: /^Week\s/ }))?.text).toContain('79% left')

  config = JSON.stringify({
    cachedUsageUtilization: { fetchedAtMs: NOW - 2 * 3_600_000, utilization: usageBody(30) },
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect((await (await mount()).find({ type: 'Text', text: /^Week\s/ }))?.text).toContain('79% left')

  config = JSON.stringify({
    cachedUsageUtilization: { fetchedAtMs: NOW - 60_000, utilization: usageBody(30) },
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect((await (await mount()).find({ type: 'Text', text: /^Week\s/ }))?.text).toContain('79% (70% fable) left')
})
