import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, CornerDownLeft, FolderTree, GitCompare, Loader2, PanelLeft, PanelLeftClose, Paperclip, Search, ShieldCheck, Square, Terminal, Workflow } from 'lucide-react'
import type { PiProcessStatus, PiRpcEvent, PromptImage, SessionState } from '../../../shared/ipc-contracts'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { PI_DESKTOP_PRODUCT_NAME } from '../../../shared/product-name'
import piLogo from '../assets/pi-logo.svg'
import { parseAgentMessage, type DisplayMessage } from '../message-parsing'
import { groupToolMessages, prepareChatMessages } from '../message-grouping'
import { useAppStore } from '../store'
import { NowContext } from '../utils/relative-time'
import { ChatSearch } from './chat-search'
import { ContextPanel } from './context-panel'
import { DiffViewer } from './diff-viewer'
import { FileTree } from './file-tree'
import { MessageBubble, ToolGroupBubble } from './message-bubble'
import { ModelSelector } from './model-selector'
import { ThinkingLevelSelector } from './thinking-level-selector'
import { ResizeHandle } from './resize-handle'
import { clampAuxiliaryPanelWidth, DEFAULT_CONVERSATION_PANEL_WIDTH } from './chat-panel-widths'

type RuntimeState = { messages: DisplayMessage[]; session: SessionState | null; status: PiProcessStatus; streaming: boolean; loading: boolean; error: string | null }

function responseData<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object') return null
  const response = value as { success?: boolean; data?: T }
  return response.success === false ? null : (response.data ?? null)
}

function useRuntimeConversation(runtimeId: string): RuntimeState {
  const runtime = useAppStore((state) => state.sessionRuntimes[runtimeId])
  const [state, setState] = useState<RuntimeState>({ messages: [], session: null, status: runtime?.status ?? 'starting', streaming: runtime?.activity === 'working', loading: true, error: null })
  const refresh = useCallback(async () => {
    try {
      const [messagesResponse, stateResponse] = await Promise.all([
        window.piDesktop.session.getRuntimeMessages(runtimeId),
        window.piDesktop.session.commandRuntime(runtimeId, { type: 'get_state' }),
      ])
      const raw = responseData<{ messages?: unknown[] }>(messagesResponse)?.messages ?? []
      const session = responseData<SessionState>(stateResponse)
      setState((current) => ({ ...current, messages: raw.map(parseAgentMessage).filter((message): message is DisplayMessage => message !== null), session, streaming: session?.isStreaming ?? current.streaming, loading: false, error: null }))
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }, [runtimeId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => setState((current) => ({ ...current, status: runtime?.status ?? 'stopped', streaming: runtime?.activity === 'working' || current.session?.isStreaming === true })), [runtime?.activity, runtime?.status])
  useEffect(() => window.piDesktop.onSessionRuntimeEvent(({ runtimeId: id, event }: { runtimeId: string; event: PiRpcEvent }) => {
    if (id !== runtimeId) return
    if (event.type === 'agent_start' || event.type === 'turn_start') setState((current) => ({ ...current, streaming: true }))
    if (event.type === 'agent_end' || event.type === 'turn_end' || event.type === 'prompt_result') setState((current) => ({ ...current, streaming: false }))
    if (event.type === 'status_change') setState((current) => ({ ...current, status: event.status }))
    void refresh()
  }), [refresh, runtimeId])
  useEffect(() => {
    if (!state.streaming) return
    const timer = window.setInterval(() => void refresh(), 400)
    return () => window.clearInterval(timer)
  }, [refresh, state.streaming])
  return state
}

function RuntimeComposer({ runtimeId, runtime }: { runtimeId: string; runtime: RuntimeState }): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<Array<{ name: string; image: PromptImage }>>([])
  const [sending, setSending] = useState(false)
  const send = useCallback(async () => {
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    setDraft('')
    try {
      await window.piDesktop.session.commandRuntime(runtimeId, { type: runtime.streaming ? 'steer' : 'prompt', message, ...(images.length ? { images: images.map((item) => item.image) } : {}) })
      setImages([])
    } finally { setSending(false) }
  }, [draft, images, runtime.streaming, runtimeId, sending])
  const attach = useCallback(async () => {
    const path = await window.piDesktop.system.openDialog({ title: t('common.attachFile'), mode: 'file' })
    if (!path) return
    const result = await window.piDesktop.files.readAttachment(path)
    if (result.kind === 'image') setImages((current) => [...current, { name: result.name, image: result.image }])
    else setDraft((value) => `${value}${value ? '\n\n' : ''}${result.content}`)
  }, [t])
  const disabled = runtime.status === 'starting' || runtime.status === 'error'
  return <div className="mx-auto w-full max-w-5xl px-3 pb-2">
    <div className="rounded-xl border border-border-strong bg-surface/95 shadow-lg">
      {images.length > 0 && <div className="flex gap-2 border-b border-border p-2">{images.map((item, index) => <button key={`${item.name}-${index}`} onClick={() => setImages((list) => list.filter((_, i) => i !== index))} className="rounded border border-border p-1"><img src={`data:${item.image.mimeType};base64,${item.image.data}`} alt={item.name} className="h-8 w-8 rounded object-cover" /></button>)}</div>}
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} disabled={disabled} rows={1} className="max-h-36 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-sm text-primary outline-none" placeholder={runtime.streaming ? t('chat.composer.placeholderSteering') : t('chat.composer.placeholderIdle', { agent: 'OMP' })} />
      <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
        <button type="button" onClick={() => void attach()} className="rounded p-1.5 text-dim hover:bg-highlight"><Paperclip size={15} /></button>
        <button type="button" onClick={() => useAppStore.getState().toggleFileSearch()} className="rounded p-1.5 text-dim hover:bg-highlight"><Search size={15} /></button>
        <div className="ml-auto flex h-6 items-center rounded-md bg-card/60 ring-1 ring-border-strong/80"><ModelSelector compact runtimeId={runtimeId} sessionState={runtime.session} piStatus={runtime.status} /><ThinkingLevelSelector runtimeId={runtimeId} sessionState={runtime.session} piStatus={runtime.status} /></div>
        {runtime.streaming ? <button type="button" onClick={() => void window.piDesktop.session.abortRuntime(runtimeId)} className="rounded p-1.5 text-dim hover:bg-highlight"><Square size={16} /></button> : <button type="button" disabled={disabled || sending || !draft.trim()} onClick={() => void send()} className="rounded p-1.5 text-dim hover:bg-highlight disabled:opacity-30">{sending ? <Loader2 size={16} className="animate-spin" /> : <CornerDownLeft size={16} />}</button>}
      </div>
    </div>
  </div>
}

export function RuntimeConversation({ runtimeId }: { runtimeId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const runtime = useRuntimeConversation(runtimeId)
  const runtimeInfo = useAppStore((state) => state.sessionRuntimes[runtimeId])
  const engineLabel = agentEngineLabel(runtimeInfo?.engine ?? 'pi') ?? 'Pi'
  const workspace = useAppStore((state) => state.workspaces.find((item) => item.id === state.sessionRuntimes[runtimeId]?.workspaceId))
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const reviewOpen = useAppStore((state) => state.reviewOpen)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const magicContext = useAppStore((state) => state.magicContextCapabilities?.magicContext === true)
  const [panel, setPanel] = useState<'files' | 'diff' | 'context' | null>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_CONVERSATION_PANEL_WIDTH)
  const [searchOpen, setSearchOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => groupToolMessages(prepareChatMessages(runtime.messages), t), [runtime.messages, t])
  const empty = !runtime.loading && runtime.messages.length === 0 && !runtime.streaming
  const retry = useCallback(async (id: string) => { const message = runtime.messages.find((item) => item.id === id); if (message?.role === 'user') await window.piDesktop.session.promptRuntime(runtimeId, message.content) }, [runtime.messages, runtimeId])
  useEffect(() => { if (scrollRef.current && runtime.streaming) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [runtime.messages, runtime.streaming])
  const toolbar = (icon: React.ReactNode, active: boolean, action: () => void, title: string) => <button type="button" onClick={action} title={title} className={`rounded p-1.5 ${active ? 'bg-highlight text-primary' : 'text-muted hover:bg-highlight'}`}>{icon}</button>
  return <div className="flex min-h-0 flex-1 overflow-hidden">
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-2">
        {workspace && <div className="mr-1 flex min-w-0 items-center gap-1 rounded bg-card/60 px-1.5 py-0.5 text-[11px] text-muted" title={workspace.path}><FolderTree size={12} /><span className="truncate">{workspace.name}: {workspace.path}</span></div>}
        {toolbar(sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />, false, () => useAppStore.getState().toggleSidebar(), t('common.hideSidebar'))}
        {toolbar(<ShieldCheck size={14} />, reviewOpen, () => useAppStore.getState().toggleReview(), t('chat.toolbar.reviewPanel'))}
        {toolbar(<FolderTree size={14} />, panel === 'files', () => setPanel(panel === 'files' ? null : 'files'), t('chat.toolbar.fileTree'))}
        {toolbar(<GitCompare size={14} />, panel === 'diff', () => setPanel(panel === 'diff' ? null : 'diff'), t('chat.toolbar.diffViewer'))}
        {toolbar(<Terminal size={14} />, terminalOpen, () => useAppStore.getState().toggleTerminal(), t('chat.toolbar.terminal'))}
        {toolbar(<Workflow size={14} />, false, () => { if (runtime.session?.sessionId) useAppStore.getState().openWorkflowRunsForSession(runtime.session.sessionId) }, t('common.workflowRuns'))}
        {magicContext && toolbar(<Brain size={14} />, panel === 'context', () => setPanel(panel === 'context' ? null : 'context'), t('context.open'))}
        <button type="button" className="ml-auto rounded p-1.5 text-muted hover:bg-highlight" onClick={() => setSearchOpen((open) => !open)}><Search size={14} /></button>
      </div>
      <div className="relative min-h-0 flex-1">
        {searchOpen && <ChatSearch containerRef={scrollRef} focusNonce={1} onClose={() => setSearchOpen(false)} />}
        {empty ? <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-4 py-10">
          <div className="mb-7 text-center">
            <img src={piLogo} alt={PI_DESKTOP_PRODUCT_NAME} className="mx-auto mb-4 block h-14 w-14" />
            <h2 className="text-2xl font-semibold text-primary">{t('chat.emptyState.title', { agent: engineLabel })}</h2>
            <p className="mt-1 text-sm text-dim">{runtime.status === 'running' ? t('chat.emptyState.pickProject') : runtime.status === 'starting' ? t('chat.emptyState.starting', { agent: engineLabel }) : runtime.status === 'error' ? t('chat.emptyState.startFailed', { agent: engineLabel }) : t('chat.emptyState.chooseProject', { agent: engineLabel })}</p>
          </div>
          <div className="w-full max-w-3xl"><RuntimeComposer runtimeId={runtimeId} runtime={runtime} /></div>
        </div> : <>
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pb-32">
            {runtime.loading && runtime.messages.length === 0 ? <div className="flex h-full items-center justify-center gap-2 text-sm text-dim"><Loader2 className="animate-spin" size={16} />{t('chat.loadingSession')}</div> : <NowContext.Provider value={Date.now()}><div className="mx-auto max-w-5xl px-3 pt-3">{items.map((item) => item.kind === 'toolGroup' ? <ToolGroupBubble key={item.id} title={item.title} messages={item.messages} onRetry={retry} /> : <MessageBubble key={item.message.id} message={item.message} onRetry={retry} />)}{runtime.error && <div className="py-2 text-center text-xs text-error">{runtime.error}</div>}</div></NowContext.Provider>}
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-chat-column via-chat-column/90 to-transparent pt-5"><RuntimeComposer runtimeId={runtimeId} runtime={runtime} /></div>
        </>}
      </div>
    </div>
    {panel && <div className="flex shrink-0 bg-app" style={{ width: panelWidth }}>
      <ResizeHandle onResize={(delta) => setPanelWidth((width) => clampAuxiliaryPanelWidth(width - delta))} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border">
        {panel === 'files' ? <FileTree /> : panel === 'diff' ? <DiffViewer onClose={() => setPanel(null)} /> : <ContextPanel onClose={() => setPanel(null)} />}
      </div>
    </div>}
  </div>
}
