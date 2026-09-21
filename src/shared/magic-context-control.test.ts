import assert from 'node:assert/strict'
import test from 'node:test'
import type { MagicContextCapabilities } from './ipc-contracts'
import { magicContextActionCommand, resolveCompactMode } from './magic-context-control'

const active: MagicContextCapabilities = {
  magicContext: true,
  ctxWrapup: true,
  ctxFlush: true,
  ctxDreamer: true,
  ctxMemory: true,
  ctxHistorian: true,
  ctxDashboardData: true,
  dbPath: 'context.db',
  configPaths: { user: 'user.jsonc', project: 'project.jsonc' },
}

test('uses exact current Magic Context command contracts', () => {
  assert.equal(magicContextActionCommand({ action: 'status' }), '/ctx-status')
  assert.equal(magicContextActionCommand({ action: 'wrapup', keep: 20 }), '/ctx-wrapup 20')
  assert.equal(magicContextActionCommand({ action: 'wrapup', keep: 50 }), '/ctx-wrapup 50')
  assert.equal(magicContextActionCommand({ action: 'flush' }), '/ctx-flush')
  assert.equal(magicContextActionCommand({ action: 'dream' }), '/ctx-dream')
  assert.equal(magicContextActionCommand({ action: 'dream', task: 'verify' }), '/ctx-dream verify')
})

test('never falls back to native compact while the session capability is active', () => {
  assert.equal(resolveCompactMode(active), 'magic-context')
  assert.equal(resolveCompactMode({ ...active, ctxWrapup: false }), 'magic-context')
  assert.equal(resolveCompactMode({ ...active, magicContext: false }), 'native')
  assert.equal(resolveCompactMode(null), 'native')
})
