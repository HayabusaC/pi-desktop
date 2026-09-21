import assert from 'node:assert/strict'
import test from 'node:test'
import { getAgentInvoked, getCommandOutputText, shouldFinishWithoutAgent } from './rpc-lifecycle'

test('reads agentInvoked from prompt responses and prompt_result events', () => {
  assert.equal(getAgentInvoked({ type: 'response', data: { agentInvoked: false } }), false)
  assert.equal(getAgentInvoked({ type: 'prompt_result', agentInvoked: true }), true)
})

test('keeps legacy waiting behavior when agentInvoked is absent or malformed', () => {
  assert.equal(getAgentInvoked({ type: 'response', data: {} }), undefined)
  assert.equal(getAgentInvoked({ agentInvoked: 'false' }), undefined)
  assert.equal(getAgentInvoked(null), undefined)
})

test('reads command output from OMP and compatibility wire shapes', () => {
  assert.equal(getCommandOutputText({ type: 'command_output', text: 'ok' }), 'ok')
  assert.equal(getCommandOutputText({ type: 'command_output', data: { text: 'legacy' } }), 'legacy')
  assert.equal(getCommandOutputText({ type: 'command_output' }), undefined)
})

test('local-only slash commands finish while model prompts keep waiting', () => {
  for (const command of ['/mcp list', '/usage', '/context', '/tools', '/session info']) {
    assert.equal(
      shouldFinishWithoutAgent({ type: 'response', command: 'prompt', data: { agentInvoked: false } }),
      true,
      command
    )
  }
  assert.equal(shouldFinishWithoutAgent({ type: 'response', command: 'prompt' }), false, 'ordinary model prompt')
  assert.equal(shouldFinishWithoutAgent({ type: 'response', data: { agentInvoked: true } }), false, 'agent-backed command')
})
