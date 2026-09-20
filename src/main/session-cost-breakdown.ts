import type { SessionCostBreakdown, SessionCostLine } from '../shared/ipc-contracts'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function firstFinite(source: UnknownRecord | null, keys: readonly string[]): number | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = finite(source[key])
    if (value !== undefined) return value
  }
  return undefined
}

function add(sum: number | undefined, value: number | undefined): number | undefined {
  return value === undefined ? sum : (sum ?? 0) + value
}

function line(tokens: number | undefined, cost: number | undefined): SessionCostLine | undefined {
  return tokens === undefined && cost === undefined
    ? undefined
    : {
        ...(tokens === undefined ? {} : { tokens }),
        ...(cost === undefined ? {} : { cost }),
      }
}

function reportedDiscountRate(usage: UnknownRecord, cost: UnknownRecord | null): number | undefined {
  const fractional = firstFinite(cost, ['discountRate']) ?? firstFinite(usage, ['discountRate'])
  if (fractional !== undefined && fractional >= 0 && fractional <= 1) return fractional
  const percent = firstFinite(cost, ['discountPercent']) ?? firstFinite(usage, ['discountPercent'])
  return percent !== undefined && percent >= 0 && percent <= 100 ? percent / 100 : undefined
}

/**
 * Aggregate only fields already returned by session/provider usage payloads.
 * Pricing is never looked up and absent buckets stay absent.
 */
export function buildSessionCostBreakdown(
  stats: unknown,
  messages: unknown[]
): SessionCostBreakdown | undefined {
  const statsRecord = record(stats)
  if (!statsRecord) return undefined
  const statsTokens = record(statsRecord.tokens)

  let inputCost: number | undefined
  let outputCost: number | undefined
  let cacheReadCost: number | undefined
  let cacheWriteCost: number | undefined
  let reasoningTokens: number | undefined
  let reasoningCost: number | undefined
  let preDiscountCost: number | undefined
  const discountRates = new Set<number>()

  for (const value of messages) {
    const message = record(value)
    if (!message || message.role !== 'assistant') continue
    const usage = record(message.usage)
    if (!usage) continue
    const cost = record(usage.cost)

    inputCost = add(inputCost, finite(cost?.input))
    outputCost = add(outputCost, finite(cost?.output))
    cacheReadCost = add(cacheReadCost, finite(cost?.cacheRead))
    cacheWriteCost = add(cacheWriteCost, finite(cost?.cacheWrite))
    reasoningTokens = add(reasoningTokens, firstFinite(usage, ['reasoningTokens', 'internalReasoningTokens']))
    reasoningCost = add(reasoningCost, firstFinite(cost, ['reasoning', 'internalReasoning']))
    preDiscountCost = add(
      preDiscountCost,
      firstFinite(cost, ['preDiscountTotal', 'originalTotal', 'undiscountedTotal']) ??
        firstFinite(usage, ['preDiscountCost', 'originalCost', 'undiscountedCost'])
    )
    const discountRate = reportedDiscountRate(usage, cost)
    if (discountRate !== undefined) discountRates.add(discountRate)
  }

  const input = line(finite(statsTokens?.input), inputCost)
  const output = line(finite(statsTokens?.output), outputCost)
  const cacheRead = line(finite(statsTokens?.cacheRead), cacheReadCost)
  const cacheWrite = line(finite(statsTokens?.cacheWrite), cacheWriteCost)
  const reasoning = line(reasoningTokens, reasoningCost)
  const finalCost = finite(statsRecord.cost)
  const discountRate = discountRates.size === 1 ? [...discountRates][0] : undefined

  if (!input && !output && !cacheRead && !cacheWrite && !reasoning &&
      preDiscountCost === undefined && discountRate === undefined && finalCost === undefined) {
    return undefined
  }

  return {
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(cacheRead ? { cacheRead } : {}),
    ...(cacheWrite ? { cacheWrite } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(preDiscountCost === undefined ? {} : { preDiscountCost }),
    ...(discountRate === undefined ? {} : { discountRate }),
    ...(finalCost === undefined ? {} : { finalCost }),
  }
}

/** Add a raw-message cost projection to a successful get_session_stats response. */
export function withSessionCostBreakdown(statsResponse: unknown, messagesResponse: unknown): unknown {
  const statsRoot = record(statsResponse)
  const data = record(statsRoot?.data)
  if (!statsRoot || statsRoot.success !== true || !data) return statsResponse
  // A newer engine may expose its own richer native breakdown. Preserve it.
  if (record(data.costBreakdown)) return statsResponse

  const messagesRoot = record(messagesResponse)
  const messagesData = record(messagesRoot?.data)
  const messages = Array.isArray(messagesData?.messages) ? messagesData.messages : []
  const costBreakdown = buildSessionCostBreakdown(data, messages)
  if (!costBreakdown) return statsResponse
  return { ...statsRoot, data: { ...data, costBreakdown } }
}
