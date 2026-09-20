import type { ProviderQuota, ProviderQuotaWindow } from '../shared/ipc-contracts'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function fraction(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(1, value))
}

function resolveFractions(amount: UnknownRecord): {
  usedFraction?: number
  remainingFraction?: number
} {
  const used = finite(amount.used)
  const limit = finite(amount.limit)
  const explicitUsed = finite(amount.usedFraction)
  const explicitRemaining = finite(amount.remainingFraction)
  const unit = text(amount.unit)
  const usedFraction = fraction(
    explicitUsed ??
      (used !== undefined && limit !== undefined && limit > 0
        ? used / limit
        : unit === 'percent' && used !== undefined
          ? used / 100
          : explicitRemaining === undefined
            ? undefined
            : 1 - explicitRemaining)
  )
  const remainingFraction = fraction(explicitRemaining ?? (usedFraction === undefined ? undefined : 1 - usedFraction))
  return { usedFraction, remainingFraction }
}

function parseWindow(value: unknown, index: number): ProviderQuotaWindow | null {
  const limit = record(value)
  if (!limit) return null
  const amount = record(limit.amount)
  if (!amount) return null
  const window = record(limit.window)
  const scope = record(limit.scope)
  const unit = text(amount.unit)
  const supportedUnits = new Set<ProviderQuotaWindow['unit']>([
    'percent',
    'tokens',
    'requests',
    'credits',
    'usd',
    'minutes',
    'bytes',
    'unknown',
  ])
  const parsedUnit = unit && supportedUnits.has(unit as ProviderQuotaWindow['unit'])
    ? (unit as ProviderQuotaWindow['unit'])
    : 'unknown'
  const id = text(limit.id) ?? `limit-${index}`
  const compactWindow = text(window?.id) ?? text(scope?.windowId)
  const label = compactWindow ?? text(window?.label) ?? text(limit.label) ?? id
  const { usedFraction, remainingFraction } = resolveFractions(amount)
  const status = text(limit.status)

  return {
    id,
    label,
    ...(text(scope?.tier) ? { tier: text(scope?.tier) } : {}),
    ...(finite(window?.durationMs) !== undefined ? { durationMs: finite(window?.durationMs) } : {}),
    ...(finite(window?.resetsAt) !== undefined ? { resetsAt: finite(window?.resetsAt) } : {}),
    ...(finite(amount.used) !== undefined ? { used: finite(amount.used) } : {}),
    ...(finite(amount.limit) !== undefined ? { limit: finite(amount.limit) } : {}),
    ...(finite(amount.remaining) !== undefined ? { remaining: finite(amount.remaining) } : {}),
    unit: parsedUnit,
    ...(usedFraction !== undefined ? { usedFraction } : {}),
    ...(remainingFraction !== undefined ? { remainingFraction } : {}),
    ...(status === 'ok' || status === 'warning' || status === 'exhausted' || status === 'unknown'
      ? { status }
      : {}),
  }
}

/**
 * Parse `pi/omp usage --json --provider <id>` without retaining account
 * identity or provider-specific raw payloads. The command itself uses the
 * engine's AuthStorage/UsageProvider API; this function only projects its
 * normalized report into the renderer contract.
 */
export function parseProviderQuotaOutput(output: string, provider: string): ProviderQuota | null {
  let root: UnknownRecord
  try {
    const parsed = JSON.parse(output.trim())
    const parsedRecord = record(parsed)
    if (!parsedRecord) return null
    root = parsedRecord
  } catch {
    return null
  }

  const reports = Array.isArray(root.reports) ? root.reports : []
  const matching = reports
    .map(record)
    .filter((report): report is UnknownRecord => report !== null && text(report.provider) === provider)
  if (matching.length === 0) return null

  const windows = matching.flatMap((report) => {
    const limits = Array.isArray(report.limits) ? report.limits : []
    return limits.flatMap((limit, index) => {
      const parsed = parseWindow(limit, index)
      return parsed ? [parsed] : []
    })
  })
  if (windows.length === 0) return null

  const fetchedAt = Math.max(
    finite(root.generatedAt) ?? 0,
    ...matching.map((report) => finite(report.fetchedAt) ?? 0)
  )
  return {
    provider,
    fetchedAt: fetchedAt || Date.now(),
    windows,
  }
}
