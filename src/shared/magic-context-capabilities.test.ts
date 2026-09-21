import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMagicContextCapabilities } from './magic-context-capabilities'

const paths = { user: 'user.jsonc', project: 'project.jsonc' }

test('keeps Magic Context fully optional when commands are absent or disabled', () => {
  for (const commands of [new Set<string>(), new Set(['ctx-wrapup', 'ctx-flush'])]) {
    const result = buildMagicContextCapabilities(commands, 'context.db', paths)
    assert.equal(result.magicContext, false)
    assert.equal(result.ctxDashboardData, false)
    assert.equal(result.dbPath, null)
  }
})

test('derives each capability from the active session command catalog', () => {
  const result = buildMagicContextCapabilities(
    new Set(['ctx-status', 'ctx-wrapup', 'ctx-flush', 'ctx-dream']),
    'context.db',
    paths
  )
  assert.deepEqual({
    magicContext: result.magicContext,
    wrapup: result.ctxWrapup,
    flush: result.ctxFlush,
    dreamer: result.ctxDreamer,
    memory: result.ctxMemory,
    historian: result.ctxHistorian,
    dashboard: result.ctxDashboardData,
  }, { magicContext: true, wrapup: true, flush: true, dreamer: true, memory: true, historian: true, dashboard: true })
})

test('active extension without a discovered DB keeps commands but disables dashboard data', () => {
  const result = buildMagicContextCapabilities(new Set(['ctx-status', 'ctx-wrapup']), null, paths)
  assert.equal(result.magicContext, true)
  assert.equal(result.ctxWrapup, true)
  assert.equal(result.ctxMemory, false)
  assert.equal(result.ctxDashboardData, false)
})
