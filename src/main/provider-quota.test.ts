import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProviderQuotaOutput } from './provider-quota'

test('projects native OAuth usage reports into compact quota windows', () => {
  const result = parseProviderQuotaOutput(JSON.stringify({
    generatedAt: 2_000,
    reports: [{
      provider: 'openai-codex',
      fetchedAt: 1_500,
      metadata: { email: 'private@example.com' },
      limits: [
        {
          id: 'openai-codex:primary',
          label: 'ChatGPT 5 Hour',
          scope: { provider: 'openai-codex', windowId: '5h', tier: 'chat' },
          window: { id: '5h', label: '5 Hour', durationMs: 18_000_000, resetsAt: 9_000 },
          amount: { usedFraction: 0.25, unit: 'percent' },
          status: 'ok',
        },
        {
          id: 'openai-codex:secondary',
          label: 'ChatGPT 7 Day',
          scope: { provider: 'openai-codex', windowId: '7d' },
          window: { id: '7d', label: '7 Day', resetsAt: 99_000 },
          amount: { used: 40, limit: 100, unit: 'requests' },
        },
      ],
      raw: { accessToken: 'must-not-cross-ipc' },
    }],
  }), 'openai-codex')

  assert.deepEqual(result, {
    provider: 'openai-codex',
    fetchedAt: 2_000,
    windows: [
      {
        id: 'openai-codex:primary',
        label: '5h',
        tier: 'chat',
        durationMs: 18_000_000,
        resetsAt: 9_000,
        unit: 'percent',
        usedFraction: 0.25,
        remainingFraction: 0.75,
        status: 'ok',
      },
      {
        id: 'openai-codex:secondary',
        label: '7d',
        resetsAt: 99_000,
        used: 40,
        limit: 100,
        unit: 'requests',
        usedFraction: 0.4,
        remainingFraction: 0.6,
      },
    ],
  })
  assert.equal(JSON.stringify(result).includes('private@example.com'), false)
  assert.equal(JSON.stringify(result).includes('accessToken'), false)
})

test('ignores reports for another provider and malformed text', () => {
  assert.equal(parseProviderQuotaOutput('{"reports":[]}', 'anthropic'), null)
  assert.equal(parseProviderQuotaOutput('{not-json', 'anthropic'), null)
})
