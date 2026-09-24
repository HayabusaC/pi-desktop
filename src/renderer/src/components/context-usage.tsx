import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MagicContextEmbeddingUsage, MagicContextUsageRun } from '../../../shared/ipc-contracts'

type Range = 'today' | '7d' | '30d' | 'all'
type Usage = MagicContextUsageRun['usage']

function rangeStart(range: Range, now: number): number {
  if (range === 'all') return 0
  if (range === 'today') return new Date(new Date(now).toDateString()).getTime()
  return now - (range === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000
}

function dollars(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(value < 0.01 && value > 0 ? 6 : 4)}`
}

function sumNullable(values: Array<number | null>): number | null {
  return values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null
}

function rateCard(row: MagicContextUsageRun): Record<string, number> | 'mixed' | null {
  const snapshot = row.pricingSnapshot
  if (!Array.isArray(snapshot)) return null
  const items = snapshot.filter((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false
    const record = entry as { provider?: unknown; model?: unknown }
    return record.provider === row.provider && record.model === row.model
  }) as Array<{ pricing?: unknown }>
  if (items.length === 0 || items.some((item) => !item.pricing || typeof item.pricing !== 'object')) return null
  const names = ['input', 'output', 'cacheRead', 'cacheWrite']
  const cards = items.map((item) => {
    const pricing = item.pricing as Record<string, unknown>
    return Object.fromEntries(names.map((name) => [name, typeof pricing[name] === 'number' ? pricing[name] : NaN]))
  })
  return new Set(cards.map((card) => JSON.stringify(card))).size === 1 ? cards[0] : 'mixed'
}

function grouped<T>(rows: T[], key: (row: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return [...groups]
}

function Pricing({ rows }: { rows: MagicContextUsageRun[] }): React.JSX.Element {
  const { t } = useTranslation()
  const cards = rows.map(rateCard)
  if (cards.some((card) => card === null)) return <span>{t('context.usage.pricingUnavailable')}</span>
  if (cards.includes('mixed')) return <span>{t('context.usage.multipleRates')}</span>
  const signatures = new Set(cards.map((card) => JSON.stringify(card)))
  if (signatures.size !== 1) return <span>{t('context.usage.multipleRates')}</span>
  const card = cards[0] as Record<string, number>
  return <span>{t('context.usage.priceSummary', { input: dollars(card.input ?? null), output: dollars(card.output ?? null), cacheRead: dollars(card.cacheRead ?? null), cacheWrite: dollars(card.cacheWrite ?? null) })}</span>
}

function TokenLine({ usage }: { usage: Usage }): React.JSX.Element {
  const { t } = useTranslation()
  return <span>{t('context.usage.tokenSummary', { input: usage.input.toLocaleString(), output: usage.output.toLocaleString(), cacheRead: usage.cacheRead.toLocaleString(), cacheWrite: usage.cacheWrite.toLocaleString(), reasoning: usage.reasoning?.toLocaleString() ?? '—', total: usage.total?.toLocaleString() ?? '—' })}</span>
}

function RunGroups({ rows }: { rows: MagicContextUsageRun[] }): React.JSX.Element {
  const { t } = useTranslation()
  if (rows.length === 0) return <div className="text-dim">{t('context.usage.noRuns')}</div>
  const latest = rows[0]
  return <div className="space-y-2">
    <div className="text-[10px] text-dim">{t('context.usage.currentModel')}: {latest.provider ?? '—'}/{latest.model ?? '—'}</div>
    {grouped(rows, (row) => `${row.provider ?? 'unknown'}/${row.model ?? 'unknown'}`).map(([model, modelRows]) => {
      const usage: Usage = {
        input: modelRows.reduce((sum, row) => sum + row.usage.input, 0),
        output: modelRows.reduce((sum, row) => sum + row.usage.output, 0),
        cacheRead: modelRows.reduce((sum, row) => sum + row.usage.cacheRead, 0),
        cacheWrite: modelRows.reduce((sum, row) => sum + row.usage.cacheWrite, 0),
        reasoning: sumNullable(modelRows.map((row) => row.usage.reasoning)),
        total: sumNullable(modelRows.map((row) => row.usage.total)),
      }
      const cost = sumNullable(modelRows.map((row) => row.estimatedCost))
      return <article key={model} className="rounded-md border border-border bg-surface p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{model}</strong><span>{t('context.usage.estimatedCost')}: {cost === null ? t('context.usage.pricingUnavailable') : dollars(cost)}</span></div>
        <div className="mt-1 text-[10px] text-dim"><Pricing rows={modelRows} /></div>
        <div className="mt-1 text-[10px] text-secondary"><TokenLine usage={usage} /></div>
        <div className="mt-1 text-[10px] text-dim">{modelRows.length} {t('context.usage.runs')}</div>
      </article>
    })}
  </div>
}

function EmbeddingGroups({ rows }: { rows: MagicContextEmbeddingUsage[] }): React.JSX.Element {
  const { t } = useTranslation()
  if (rows.length === 0) return <div className="text-dim">{t('context.usage.noEmbeddings')}</div>
  return <div className="space-y-2">
    <div className="text-[10px] text-dim">{t('context.usage.currentModel')}: {rows[0].provider}/{rows[0].model}</div>
    {grouped(rows, (row) => `${row.provider}/${row.model}`).map(([model, modelRows]) => {
      const knownTokens = modelRows.every((row) => row.inputTokens !== null)
      const tokens = knownTokens ? modelRows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0) : null
      const rates = new Set(modelRows.map((row) => row.pricePerMillionInputTokens))
      const rate = rates.size === 1 ? modelRows[0].pricePerMillionInputTokens : null
      const cost = sumNullable(modelRows.map((row) => row.estimatedCost))
      const local = modelRows.every((row) => row.provider === 'local' || row.provider === 'synapse')
      return <article key={model} className="rounded-md border border-border bg-surface p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{model}</strong><span>{t('context.usage.estimatedCost')}: {local ? t('context.usage.zeroApiCost') : cost === null ? t('context.usage.pricingUnavailable') : dollars(cost)}</span></div>
        <div className="mt-1 text-[10px] text-dim">{t('context.usage.embeddingSummary', { requests: modelRows.reduce((sum, row) => sum + row.requests, 0).toLocaleString(), input: tokens?.toLocaleString() ?? '—', dimensions: [...new Set(modelRows.map((row) => row.dimensions).filter((dimension) => dimension !== null))].join(', ') || '—' })}</div>
        <div className="mt-1 text-[10px] text-dim">{t('context.usage.pricePerMillion')}: {local ? '$0' : rates.size > 1 ? t('context.usage.multipleRates') : rate === null ? t('context.usage.pricingUnavailable') : dollars(rate)}</div>
      </article>
    })}
  </div>
}

export function ContextUsage({ runs, embeddings }: { runs: MagicContextUsageRun[]; embeddings: MagicContextEmbeddingUsage[] }): React.JSX.Element {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>('7d')
  const start = rangeStart(range, Date.now())
  const visibleRuns = useMemo(() => runs.filter((row) => row.timestamp >= start), [runs, start])
  const visibleEmbeddings = useMemo(() => embeddings.filter((row) => row.timestamp >= start), [embeddings, start])
  const historian = visibleRuns.filter((row) => row.component === 'historian')
  const dreamer = visibleRuns.filter((row) => row.component === 'dreamer')
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1">{([['today', t('context.usage.range.today')], ['7d', t('context.usage.range.7d')], ['30d', t('context.usage.range.30d')], ['all', t('context.usage.range.all')]] as const).map(([item, label]) => <button key={item} onClick={() => setRange(item)} className={`rounded border px-2 py-1 text-[10px] ${range === item ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted'}`}>{label}</button>)}</div>
    <section className="space-y-2"><h2 className="font-semibold">{t('context.tabs.historian')}</h2><RunGroups rows={historian} /></section>
    <section className="space-y-2"><h2 className="font-semibold">{t('context.tabs.dreamer')}</h2>
      {dreamer.length === 0 ? <RunGroups rows={[]} /> : grouped(dreamer, (row) => row.task ?? t('context.usage.unspecifiedTask')).map(([task, taskRows]) =>
        <details key={task} open className="rounded-md border border-border p-2"><summary className="cursor-pointer font-medium">{task} · {taskRows.length} {t('context.usage.runs')}</summary><div className="mt-2"><RunGroups rows={taskRows} /></div></details>)}</section>
    <section className="space-y-2"><h2 className="font-semibold">{t('context.usage.embedding')}</h2><EmbeddingGroups rows={visibleEmbeddings} /></section>
  </div>
}
