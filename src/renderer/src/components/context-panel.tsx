import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Database, History, Loader2, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { useAppStore } from '../store'
import type { MagicContextConfigFile, MagicContextMemory } from '../../../shared/ipc-contracts'

type Tab = 'overview' | 'memories' | 'sessions' | 'historian' | 'dreamer' | 'cache' | 'config' | 'logs'

export function ContextPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const data = useAppStore((state) => state.magicContextData)
  const loading = useAppStore((state) => state.magicContextLoading)
  const error = useAppStore((state) => state.magicContextError)
  const caps = useAppStore((state) => state.magicContextCapabilities)
  const refresh = useAppStore((state) => state.refreshMagicContextData)
  const runAction = useAppStore((state) => state.runMagicContextAction)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => { void refresh() }, [refresh])

  if (!caps?.magicContext) return <div className="flex flex-1 items-center justify-center px-3 text-xs text-dim">{t('context.unavailable')}</div>

  const tabs: Tab[] = ['overview', 'memories', 'sessions', 'historian', 'dreamer', 'cache', 'config', 'logs']
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-app text-xs">
      <header className="flex min-w-0 items-start justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="flex shrink-0 items-center gap-1.5 py-0.5"><Brain size={15} className="text-accent" /><h1 className="text-sm font-semibold leading-5">{t('context.title')}</h1></div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          <ActionButton label={t('context.actions.status')} onClick={() => void runAction({ action: 'status' })} />
          {caps.ctxWrapup && <ActionButton label={t('context.actions.compact20')} onClick={() => void runAction({ action: 'wrapup', keep: 20 })} />}
          {caps.ctxWrapup && <ActionButton label={t('context.actions.compact50')} onClick={() => void runAction({ action: 'wrapup', keep: 50 })} />}
          {caps.ctxFlush && <ActionButton label={t('context.actions.forceFlush')} onClick={() => void runAction({ action: 'flush' })} />}
          <button onClick={() => void refresh()} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-primary" title={t('common.refresh')}><RefreshCw size={13} /></button>
          <button onClick={onClose} className="rounded px-1.5 py-0.5 text-sm leading-4 text-muted hover:bg-surface-hover hover:text-primary" title={t('common.close')}><span aria-hidden="true">×</span></button>
        </div>
      </header>
      <nav className="flex flex-wrap gap-0.5 border-b border-border px-2 py-1">
        {tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded px-1.5 py-0.5 text-[10px] leading-4 capitalize ${tab === item ? 'bg-accent text-white' : 'text-muted hover:bg-surface-hover hover:text-primary'}`}>{t(`context.tabs.${item}`)}</button>)}
      </nav>
      {error && <div className="break-words border-b border-error/30 bg-error/10 px-3 py-1.5 text-[11px] text-error [overflow-wrap:anywhere]">{error}</div>}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2.5">
        {loading && !data ? <div className="flex items-center gap-1.5 text-xs text-dim"><Loader2 className="animate-spin" size={14} />{t('common.loading')}</div> : (
          <>
            {tab === 'overview' && <Overview data={data} />}
            {tab === 'memories' && <Memories memories={data?.memories ?? []} onRefresh={refresh} />}
            {tab === 'sessions' && <Records rows={data?.sessions ?? []} empty={t('context.empty.sessions')} />}
            {tab === 'historian' && <Records rows={data?.historian ?? []} empty={t('context.empty.historian')} />}
            {tab === 'dreamer' && <Dreamer data={data} onDream={() => void runAction({ action: 'dream' })} enabled={caps.ctxDreamer} />}
            {tab === 'cache' && <Records rows={data?.cache ?? []} empty={t('context.empty.cache')} />}
            {tab === 'config' && <ConfigEditor />}
            {tab === 'logs' && <Records rows={data?.logs ?? []} empty={t('context.empty.logs')} />}
          </>
        )}
      </main>
    </div>
  )
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return <button onClick={onClick} className="whitespace-nowrap rounded border border-border-strong px-1.5 py-0.5 text-[10px] leading-4 text-muted hover:bg-surface-hover hover:text-primary">{label}</button>
}

function Overview({ data }: { data: ReturnType<typeof useAppStore.getState>['magicContextData'] }): React.JSX.Element {
  const { t } = useTranslation()
  const cards = [
    [t('context.tabs.memories'), data?.overview.memories ?? 0, Brain],
    [t('context.tabs.sessions'), data?.overview.sessions ?? 0, History],
    [t('context.overview.compartments'), data?.overview.compartments ?? 0, Database],
    [t('context.overview.dreamRuns'), data?.overview.dreamRuns ?? 0, Sparkles],
  ] as const
  return <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">{cards.map(([label, value, Icon]) => <div key={label} className="min-w-0 rounded-md border border-border bg-surface p-2.5"><div className="flex items-center justify-between gap-2"><Icon size={13} className="shrink-0 text-accent" /><div className="text-lg font-semibold leading-5 tabular-nums">{value}</div></div><div className="mt-1 truncate text-[10px] text-dim" title={label}>{label}</div></div>)}</div>
}

function Memories({ memories, onRefresh }: { memories: MagicContextMemory[]; onRefresh: () => Promise<void> }): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const save = async (memory: MagicContextMemory): Promise<void> => {
    await window.piDesktop.magicContext.updateMemory(memory.id, draft)
    setEditing(null); await onRefresh()
  }
  const remove = async (memory: MagicContextMemory): Promise<void> => {
    const ok = await useAppStore.getState().requestConfirm({ title: t('context.memory.deleteTitle'), message: t('context.memory.deleteMessage'), confirmLabel: t('common.delete'), danger: true })
    if (!ok) return
    await window.piDesktop.magicContext.deleteMemory(memory.id); await onRefresh()
  }
  if (!memories.length) return <Empty text={t('context.empty.memories')} />
  return <div className="space-y-1.5">{memories.map((memory) => <article key={memory.id} className="min-w-0 rounded-md border border-border bg-surface p-2.5">
    <div className="mb-1.5 flex min-w-0 items-start justify-between gap-2"><div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5 text-[10px] leading-4 text-dim"><span>{memory.category}</span><span>{memory.status}</span><span className="min-w-0 break-words [overflow-wrap:anywhere]">{memory.project_path}</span></div><div className="flex shrink-0 gap-0.5">{editing === memory.id ? <button onClick={() => void save(memory)} className="rounded p-1 text-accent"><Save size={13} /></button> : <button onClick={() => { setEditing(memory.id); setDraft(memory.content) }} className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover">{t('common.edit')}</button>}<button onClick={() => void remove(memory)} className="rounded p-1 text-error hover:bg-error/10"><Trash2 size={13} /></button></div></div>
    {editing === memory.id ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-24 w-full resize-y rounded border border-border-strong bg-input p-2 text-xs leading-5 outline-none focus:border-focus" /> : <p className="whitespace-pre-wrap break-words text-xs leading-5 text-secondary [overflow-wrap:anywhere]">{memory.content}</p>}
  </article>)}</div>
}

function Dreamer({ data, onDream, enabled }: { data: ReturnType<typeof useAppStore.getState>['magicContextData']; onDream: () => void; enabled: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface p-2.5"><div className="min-w-0"><div className="text-xs font-medium">{t('context.dreamer.title')}</div><div className="break-words text-[10px] leading-4 text-dim [overflow-wrap:anywhere]">{data?.dreamer.enabled ? t('context.dreamer.enabled') : t('context.dreamer.disabled')}</div></div>{enabled && <ActionButton label={t('context.dreamer.run')} onClick={onDream} />}</div><Records rows={data?.dreamer.schedules ?? []} empty={t('context.empty.dreamer')} /><Records rows={data?.dreamer.runs ?? []} empty={t('context.empty.dreamRuns')} /></div>
}

function Records({ rows, empty }: { rows: object[]; empty: string }): React.JSX.Element {
  if (!rows.length) return <Empty text={empty} />
  return <div className="min-w-0 space-y-1.5">{rows.map((row, index) => { const keyed = row as { id?: unknown; session_id?: unknown }; return <pre key={String(keyed.id ?? keyed.session_id ?? index)} className="min-w-0 whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 font-mono text-[10px] leading-4 text-secondary [overflow-wrap:anywhere]">{JSON.stringify(row, null, 2)}</pre> })}</div>
}

function ConfigEditor(): React.JSX.Element {
  const { t } = useTranslation()
  const [source, setSource] = useState<'user' | 'project'>('project')
  const [file, setFile] = useState<MagicContextConfigFile | null>(null)
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { void window.piDesktop.magicContext.readConfig(source).then((next) => { setFile(next); setContent(next.content ?? '{\n}\n'); setMessage(next.error ?? '') }) }, [source])
  const save = async (): Promise<void> => { try { await window.piDesktop.magicContext.writeConfig(source, content); setMessage(t('context.config.saved')) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  return <div className="min-w-0 space-y-2"><div className="flex min-w-0 flex-wrap items-center gap-1"><ActionButton label={t('context.config.project')} onClick={() => setSource('project')} /><ActionButton label={t('context.config.user')} onClick={() => setSource('user')} /><span className="min-w-0 flex-1 break-words text-[10px] leading-4 text-dim [overflow-wrap:anywhere]" title={file?.path}>{file?.path}</span></div><textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} wrap="off" className="min-h-[22rem] w-full resize-y overflow-auto rounded-md border border-border bg-input p-2 font-mono text-[10px] leading-4 text-secondary outline-none focus:border-focus" /><div className="flex min-w-0 items-start gap-2"><button onClick={() => void save()} className="shrink-0 rounded bg-accent px-2 py-1 text-[10px] font-medium text-white">{t('common.save')}</button><span className="min-w-0 break-words text-[10px] leading-4 text-dim [overflow-wrap:anywhere]">{message}</span></div></div>
}

function Empty({ text }: { text: string }): React.JSX.Element { return <div className="break-words rounded-md border border-dashed border-border p-4 text-center text-xs leading-5 text-dim [overflow-wrap:anywhere]">{text}</div> }
