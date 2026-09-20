import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSessionCostBreakdown, withSessionCostBreakdown } from './session-cost-breakdown'

test('aggregates raw token and cost buckets without estimating missing prices', () => {
  const breakdown = buildSessionCostBreakdown(
    {
      tokens: { input: 100, output: 50, cacheRead: 20, cacheWrite: 10 },
      cost: 0.42,
    },
    [
      {
        role: 'assistant',
        usage: {
          reasoningTokens: 12,
          cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.37 },
        },
      },
      {
        role: 'assistant',
        usage: {
          reasoningTokens: 3,
          cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0.02, total: 0.05 },
        },
      },
    ]
  )

  assert.deepEqual(breakdown, {
    input: { tokens: 100, cost: 0.11 },
    output: { tokens: 50, cost: 0.22 },
    cacheRead: { tokens: 20, cost: 0.03 },
    cacheWrite: { tokens: 10, cost: 0.06 },
    reasoning: { tokens: 15 },
    finalCost: 0.42,
  })
  assert.equal('preDiscountCost' in (breakdown ?? {}), false)
  assert.equal('discountRate' in (breakdown ?? {}), false)
})

test('passes through explicitly reported discount fields', () => {
  const breakdown = buildSessionCostBreakdown(
    { tokens: {}, cost: 0.8 },
    [{
      role: 'assistant',
      usage: {
        discountRate: 0.2,
        cost: { preDiscountTotal: 1, total: 0.8 },
      },
    }]
  )
  assert.deepEqual(breakdown, {
    preDiscountCost: 1,
    discountRate: 0.2,
    finalCost: 0.8,
  })
})

test('augments successful stats envelopes and preserves native breakdowns', () => {
  const stats = { success: true, data: { tokens: { input: 1 }, cost: 0.1 } }
  const messages = { success: true, data: { messages: [{ role: 'assistant', usage: { cost: { input: 0.1 } } }] } }
  assert.deepEqual(withSessionCostBreakdown(stats, messages), {
    success: true,
    data: {
      tokens: { input: 1 },
      cost: 0.1,
      costBreakdown: { input: { tokens: 1, cost: 0.1 }, finalCost: 0.1 },
    },
  })

  const native = { success: true, data: { costBreakdown: { finalCost: 7 } } }
  assert.equal(withSessionCostBreakdown(native, messages), native)
})
