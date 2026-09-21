import assert from 'node:assert/strict'
import test from 'node:test'
import { isBrowserAgentAction } from './browser-agent-action'

test('accepts valid browser agent actions', () => {
  assert.equal(isBrowserAgentAction({ action: 'tabs' }), true)
  assert.equal(isBrowserAgentAction({ action: 'newTab', url: 'https://example.com' }), true)
  assert.equal(isBrowserAgentAction({ action: 'navigate', tabId: 'browser-1', url: 'example.com' }), true)
  assert.equal(isBrowserAgentAction({ action: 'click', tabId: 'browser-1', x: 4, y: 8 }), true)
  assert.equal(isBrowserAgentAction({ action: 'type', tabId: 'browser-1', text: 'hello', submit: true }), true)
})

test('rejects incomplete and non-finite browser agent actions', () => {
  assert.equal(isBrowserAgentAction({ action: 'navigate', tabId: 'browser-1' }), false)
  assert.equal(isBrowserAgentAction({ action: 'click', tabId: 'browser-1' }), false)
  assert.equal(isBrowserAgentAction({ action: 'click', tabId: 'browser-1', x: Number.NaN, y: 2 }), false)
  assert.equal(isBrowserAgentAction({ action: 'type', tabId: 'not-browser', text: 'hello' }), false)
  assert.equal(isBrowserAgentAction({ action: 'evaluate', tabId: 'browser-1', expression: 'x'.repeat(100_001) }), false)
})
