import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import { BrainCircuit, Check, Cpu, Image, Loader2, RefreshCw, Search } from 'lucide-react'
import type { ModelInfo } from '../../../shared/ipc-contracts'
import type { CustomModel, ModelsConfig } from '../../../shared/models-config'
import { useAppStore } from '../store'
import { formatIpcError } from '../utils/ipc-error'

type ModelDetail = Partial<ModelInfo> & Pick<ModelInfo, 'id' | 'provider'> & {
  name: string
  source: 'runtime' | 'configured'
}

function configuredModels(config: ModelsConfig | null): ModelDetail[] {
  if (!config) return []
  return Object.entries(config.providers ?? {}).flatMap(([providerKey, provider]) =>
    (provider.models ?? []).map((model: CustomModel) => ({
      ...model,
      id: model.id,
      name: model.name?.trim() || model.id,
      provider: providerKey,
      api: model.api ?? provider.api,
      baseUrl: provider.baseUrl,
      source: 'configured' as const,
    })),
  )
}

function mergeModels(runtime: ModelInfo[], config: ModelsConfig | null): ModelDetail[] {
  const configured = configuredModels(config)
  const byKey = new Map(configured.map((model) => [`${model.provider}\0${model.id}`, model]))
  for (const model of runtime) {
    const key = `${model.provider}\0${model.id}`
    byKey.set(key, { ...byKey.get(key), ...model, source: 'runtime' })
  }
  return [...byKey.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  )
}

export function ModelBrowser(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const piStatus = useAppStore((state) => state.piStatus)
  const currentModel = useAppStore((state) => state.sessionState?.model)
  const customModels = useAppStore((state) => state.customModels)
  const loadCustomModels = useAppStore((state) => state.loadCustomModels)
  const [runtimeModels, setRuntimeModels] = useState<ModelInfo[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await loadCustomModels()
      if (useAppStore.getState().piStatus !== 'running') {
        setRuntimeModels([])
        return
      }
      const response = await window.piDesktop.model.listAvailable() as {
        success?: boolean
        data?: { models?: ModelInfo[] }
      } | null
      setRuntimeModels(response?.success ? response.data?.models ?? [] : [])
    } catch (err) {
      setError(formatIpcError(err))
      setRuntimeModels([])
    } finally {
      setLoading(false)
    }
  }, [loadCustomModels])

  useEffect(() => { void refresh() }, [refresh, piStatus])

  const models = useMemo(() => mergeModels(runtimeModels, customModels), [runtimeModels, customModels])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return models
    return models.filter((model) =>
      `${model.name} ${model.id} ${model.provider} ${model.api ?? ''}`.toLowerCase().includes(needle),
    )
  }, [models, query])
  const currentKey = currentModel ? `${currentModel.provider}\0${currentModel.id}` : null
  const effectiveKey = selectedKey && models.some((model) => `${model.provider}\0${model.id}` === selectedKey)
    ? selectedKey
    : currentKey ?? (models[0] ? `${models[0].provider}\0${models[0].id}` : null)
  const selected = models.find((model) => `${model.provider}\0${model.id}` === effectiveKey) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-muted" />
          <div>
            <h2 className="text-sm font-medium text-primary">{t('models.browser.title')}</h2>
            <p className="text-[11px] text-faint">{t('models.browser.subtitle')}</p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded p-1.5 text-dim transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50" title={t('models.browser.refresh')}>
          <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
        </button>
      </header>

      {error && <div className="border-b border-error-bg bg-error-bg px-4 py-2 text-xs text-error">{t('models.browser.loadFailed')}: {error}</div>}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface/30">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={13} className="text-dim" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('models.browser.searchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-faint" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {loading && models.length === 0 ? (
              <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-dim" /></div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-faint">{t('models.browser.empty')}</p>
            ) : filtered.map((model) => {
              const key = `${model.provider}\0${model.id}`
              return (
                <button key={key} type="button" onClick={() => setSelectedKey(key)} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover', effectiveKey === key && 'bg-card')}>
                  <Cpu size={14} className="shrink-0 text-accent-fg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-primary">{model.name}</span>
                    <span className="block truncate text-[11px] text-dim">{model.provider} · {model.id}</span>
                  </span>
                  {currentKey === key && <Check size={13} className="shrink-0 text-success" />}
                </button>
              )
            })}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {selected ? <ModelDetails model={selected} current={currentKey === `${selected.provider}\0${selected.id}`} locale={i18n.language} /> : (
            <div className="flex h-full items-center justify-center text-sm text-faint">{t('models.browser.noSelection')}</div>
          )}
        </main>
      </div>
    </div>
  )
}

function ModelDetails({ model, current, locale }: { model: ModelDetail; current: boolean; locale: string }): React.JSX.Element {
  const { t } = useTranslation()
  const number = (value?: number): string => value == null ? t('models.browser.unknown') : value.toLocaleString(locale)
  const cost = (value?: number): string => value == null ? '—' : `$${value.toLocaleString(locale, { maximumFractionDigits: 6 })}`
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-xl border border-border bg-surface/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-semibold text-primary">{model.name}</h1>{current && <Badge tone="success">{t('models.browser.current')}</Badge>}</div>
            <p className="mt-1 font-mono text-xs text-dim">{model.id}</p>
          </div>
          <Badge>{model.source === 'runtime' ? t('models.browser.runtimeSource') : t('models.browser.configuredSource')}</Badge>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Detail label={t('models.browser.provider')} value={model.provider} />
        <Detail label={t('models.browser.api')} value={model.api || t('models.browser.unknown')} />
        <Detail label={t('models.browser.baseUrl')} value={model.baseUrl || t('models.browser.unknown')} mono />
        <Detail label={t('models.browser.contextWindow')} value={`${number(model.contextWindow)} ${model.contextWindow == null ? '' : t('models.browser.tokens')}`} />
        <Detail label={t('models.browser.maxOutput')} value={`${number(model.maxTokens)} ${model.maxTokens == null ? '' : t('models.browser.tokens')}`} />
        <Detail label={t('models.browser.reasoning')} value={model.reasoning == null ? t('models.browser.unknown') : model.reasoning ? t('models.browser.yes') : t('models.browser.no')} icon={<BrainCircuit size={14} />} />
        <Detail label={t('models.browser.inputModalities')} value={model.input?.join(', ') || t('models.browser.unknown')} icon={<Image size={14} />} />
        <Detail label={t('models.browser.thinkingEfforts')} value={model.thinking?.efforts?.join(', ') || model.thinking?.mode || t('models.browser.unknown')} />
      </section>

      <section className="rounded-xl border border-border bg-surface/50 p-4">
        <div className="mb-3"><h3 className="text-sm font-medium text-primary">{t('models.browser.cost')}</h3><p className="text-[11px] text-faint">{t('models.browser.costHint')}</p></div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Detail label={t('models.browser.inputCost')} value={cost(model.cost?.input)} />
          <Detail label={t('models.browser.outputCost')} value={cost(model.cost?.output)} />
          <Detail label={t('models.browser.cacheRead')} value={cost(model.cost?.cacheRead)} />
          <Detail label={t('models.browser.cacheWrite')} value={cost(model.cost?.cacheWrite)} />
        </div>
      </section>
    </div>
  )
}

function Detail({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }): React.JSX.Element {
  return <div className="min-w-0 rounded-lg border border-border bg-card/50 p-3"><div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">{icon}{label}</div><div className={clsx('mt-1 break-words text-sm text-secondary', mono && 'font-mono text-xs')}>{value}</div></div>
}

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'success' }): React.JSX.Element {
  return <span className={clsx('rounded px-2 py-0.5 text-[10px]', tone === 'success' ? 'bg-success-bg text-success' : 'bg-card text-dim')}>{children}</span>
}
