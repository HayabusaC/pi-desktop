import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Plug, RefreshCw, RotateCcw, TestTube2, ToggleLeft, ToggleRight } from 'lucide-react'
import type { McpServerAction, McpServerInfo } from '../../../shared/ipc-contracts'
import { useAppStore } from '../store'

const ACTION_CLASS = 'inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-surface-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-50'

export function McpBrowser(): React.JSX.Element {
  const { t } = useTranslation()
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspace?.id)
  const piStatus = useAppStore((state) => state.piStatus)
  const engine = useAppStore((state) => state.piEngine)
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setServers(await window.piDesktop.mcpServers.list())
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, activeWorkspaceId, piStatus])

  const run = async (action: McpServerAction, name?: string): Promise<void> => {
    const key = `${action}:${name ?? ''}`
    setBusy(key)
    setNotice(null)
    try {
      const result = await window.piDesktop.mcpServers.action({ action, name })
      setNotice({ ok: result.success, text: result.output || t('mcp.actionCompleted', { action }) })
      await refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  const toggleDetails = (id: string): void => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-muted" />
            <div>
              <h2 className="text-sm font-medium text-primary">{t('mcp.title')}</h2>
              <p className="text-[11px] text-faint">{t('mcp.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => void refresh()} disabled={loading} className={ACTION_CLASS}>
              <RefreshCw size={13} className={clsx(loading && 'animate-spin')} /> {t('mcp.refresh')}
            </button>
            <button type="button" onClick={() => void run('reload')} disabled={busy !== null || engine !== 'omp' || piStatus !== 'running'} className={ACTION_CLASS}>
              {busy === 'reload:' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} {t('mcp.reload')}
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div className={clsx('flex items-start gap-2 border-b px-4 py-2.5 text-xs', notice.ok ? 'border-success-bg bg-success-bg text-success' : 'border-error-bg bg-error-bg text-error')}>
          {notice.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span className="whitespace-pre-wrap">{notice.text}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-dim" /></div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-dim">
            <Plug size={32} className="mb-3 text-faint" />
            <p className="text-sm">{t('mcp.emptyTitle')}</p>
            <p className="mt-1 text-xs text-faint">{t('mcp.emptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => {
              const isExpanded = expanded.has(server.id)
              return (
                <div key={server.id} className="rounded-lg border border-border bg-surface/50">
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-primary">{server.name}</span>
                          <Badge>{server.scope === 'global' ? t('mcp.globalScope') : t('mcp.projectScope')}</Badge>
                          <Badge>{server.transport}</Badge>
                          <StatusBadge status={server.runtimeStatus} />
                          <span className={clsx('text-[10px]', server.enabled ? 'text-success' : 'text-dim')}>{server.enabled ? t('mcp.enabled') : t('mcp.disabled')}</span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-dim">{server.command || server.url || '(endpoint unavailable)'}</p>
                        <p className="mt-1 truncate text-[10px] text-faint" title={server.sourcePath}>{server.sourcePath}</p>
                        {server.runtimeError && <p className="mt-1 text-[11px] text-error">{server.runtimeError}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        <ActionButton action="test" name={server.name} busy={busy} icon={<TestTube2 size={12} />} onRun={run}>{t('mcp.test')}</ActionButton>
                        <ActionButton action="reconnect" name={server.name} busy={busy} icon={<RotateCcw size={12} />} onRun={run}>{t('mcp.reconnect')}</ActionButton>
                        <ActionButton action={server.enabled ? 'disable' : 'enable'} name={server.name} busy={busy} icon={server.enabled ? <ToggleRight size={13} /> : <ToggleLeft size={13} />} onRun={run}>
                          {server.enabled ? t('mcp.disable') : t('mcp.enable')}
                        </ActionButton>
                        <button type="button" onClick={() => toggleDetails(server.id)} className="inline-flex items-center justify-center rounded p-1 text-dim transition-colors hover:bg-surface-hover hover:text-primary" title={t('mcp.viewConfig')}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  {isExpanded && <pre className="max-h-80 overflow-auto border-t border-border bg-card/50 px-4 py-3 text-[11px] leading-relaxed text-secondary">{JSON.stringify(server.config, null, 2)}</pre>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="rounded bg-card px-1.5 py-0.5 text-[10px] text-dim">{children}</span>
}

function StatusBadge({ status }: { status: McpServerInfo['runtimeStatus'] }): React.JSX.Element {
  const { t } = useTranslation()
  return <span className={clsx('rounded px-1.5 py-0.5 text-[10px]', status === 'connected' ? 'bg-success-bg text-success' : status === 'error' ? 'bg-error-bg text-error' : 'bg-card text-dim')}>{status === 'connected' ? t('mcp.connected') : status === 'error' ? t('mcp.error') : t('mcp.disconnected')}</span>
}

function ActionButton({ action, name, busy, icon, onRun, children }: {
  action: McpServerAction
  name: string
  busy: string | null
  icon: React.ReactNode
  onRun: (action: McpServerAction, name?: string) => Promise<void>
  children: React.ReactNode
}): React.JSX.Element {
  const key = `${action}:${name}`
  return <button type="button" disabled={busy !== null} onClick={() => void onRun(action, name)} className={ACTION_CLASS}>{busy === key ? <Loader2 size={12} className="animate-spin" /> : icon}{children}</button>
}
