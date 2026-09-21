import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Columns2,
  Globe2,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Rows2,
  X,
} from 'lucide-react'
import { useAppStore } from '../store'
import { installBrowserStateListener, useWorkspaceTabStore, type WorkspaceTab } from '../workspace-tab-store'
import type { PaneNode } from '../workspace-layout'
import { getSessionTitle } from '../utils/session-title'
import { pathsEqual } from '../../../shared/path-compare'
import { RuntimeConversation } from './runtime-conversation'
function BrowserPane({ browserId }: { browserId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const browser = useWorkspaceTabStore((state) => state.browserStates[browserId])
  const [address, setAddress] = useState(browser?.url ?? '')

  useEffect(() => setAddress(browser?.url ?? ''), [browser?.url])

  const navigate = (): void => {
    if (!address.trim()) return
    void window.piDesktop.browser.navigate(browserId, address).catch(() => undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-surface px-1.5">
        <button type="button" disabled={!browser?.canGoBack} onClick={() => void window.piDesktop.browser.goBack(browserId)} className="rounded p-1 text-muted hover:bg-highlight disabled:opacity-30" aria-label={t('browser.back')}><ArrowLeft size={14} /></button>
        <button type="button" disabled={!browser?.canGoForward} onClick={() => void window.piDesktop.browser.goForward(browserId)} className="rounded p-1 text-muted hover:bg-highlight disabled:opacity-30" aria-label={t('browser.forward')}><ArrowRight size={14} /></button>
        <button type="button" onClick={() => void (browser?.loading ? window.piDesktop.browser.stop(browserId) : window.piDesktop.browser.reload(browserId))} className="rounded p-1 text-muted hover:bg-highlight" aria-label={browser?.loading ? t('browser.stop') : t('browser.reload')}>
          {browser?.loading ? <X size={14} /> : <RefreshCw size={14} />}
        </button>
        <form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
          <input value={address} onChange={(event) => setAddress(event.target.value)} className="h-6 min-w-0 flex-1 rounded border border-border bg-app px-2 text-xs text-primary outline-none focus:border-focus" aria-label={t('browser.address')} placeholder={t('browser.addressPlaceholder')} />
        </form>
        {browser?.loading && <Loader2 size={13} className="animate-spin text-accent-fg" />}
      </div>
      <div data-browser-view-id={browserId} className="min-h-0 flex-1 bg-white" />
    </div>
  )
}

function tabTitle(tab: WorkspaceTab): string {
  return tab.title || (tab.kind === 'browser' ? 'Browser' : 'Conversation')
}

function Pane({ paneId }: { paneId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const pane = useWorkspaceTabStore((state) => state.layout.panes[paneId])
  const paneCount = useWorkspaceTabStore((state) => Object.keys(state.layout.panes).length)
  const tabs = useWorkspaceTabStore((state) => state.tabs)
  const activate = useWorkspaceTabStore((state) => state.activate)
  const move = useWorkspaceTabStore((state) => state.move)
  const split = useWorkspaceTabStore((state) => state.split)
  const closePane = useWorkspaceTabStore((state) => state.closePane)
  const closeWorkspaceTab = useWorkspaceTabStore((state) => state.closeTab)
  const newBrowser = useWorkspaceTabStore((state) => state.newBrowser)
  const newConversation = useWorkspaceTabStore((state) => state.newConversation)
  const closeSessionTab = useAppStore((state) => state.closeSessionTab)
  const focusSessionRuntime = useAppStore((state) => state.focusSessionRuntime)
  const activeSessionRuntimeId = useAppStore((state) => state.activeSessionRuntimeId)
  const activeTab = pane.activeTabId ? tabs[pane.activeTabId] : undefined

  if (!pane) return <div />
  return (
    <section
      className={clsx('flex min-h-0 min-w-0 flex-1 flex-col bg-app', activeTab?.kind === 'conversation' && activeTab.runtimeId === activeSessionRuntimeId && 'ring-1 ring-inset ring-accent/30')}
      onPointerDownCapture={() => {
        if (activeTab?.kind === 'conversation' && activeTab.runtimeId !== useAppStore.getState().activeSessionRuntimeId) {
          void focusSessionRuntime(activeTab.runtimeId)
        }
      }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
      onDrop={(event) => { const tabId = event.dataTransfer.getData('application/x-pi-workspace-tab'); if (tabId) move(tabId, paneId) }}
    >
      <div className="flex h-8 shrink-0 items-end border-b border-border bg-app px-1">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
          {pane.tabIds.map((tabId) => {
            const tab = tabs[tabId]
            if (!tab) return null
            const active = tabId === pane.activeTabId
            return (
              <div key={tabId} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-pi-workspace-tab', tabId); event.dataTransfer.effectAllowed = 'move' }} className={clsx('group flex h-7 min-w-[96px] max-w-[190px] items-center rounded-t border border-b-0 px-1.5 text-[11px]', active ? 'border-border bg-surface text-primary' : 'border-transparent text-muted hover:bg-surface/60')}>
                <button type="button" onClick={() => { activate(paneId, tabId); if (tab.kind === 'conversation') void focusSessionRuntime(tab.runtimeId) }} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={tabTitle(tab)}>
                  {tab.kind === 'browser' ? <Globe2 size={12} className="shrink-0" /> : <MessageSquare size={12} className="shrink-0" />}
                  <span className="truncate">{tabTitle(tab)}</span>
                </button>
                <button type="button" className="rounded p-0.5 opacity-0 hover:bg-highlight group-hover:opacity-100" aria-label={t('workspacePane.closeTab')} onClick={() => {
                  if (tab.kind === 'conversation') void closeSessionTab(tab.runtimeId).then(() => closeWorkspaceTab(tabId))
                  else void closeWorkspaceTab(tabId)
                }}><X size={11} /></button>
              </div>
            )
          })}
        </div>
        <div className="mb-0.5 flex shrink-0 items-center gap-0.5 pl-1">
          <button type="button" onClick={() => {
            const workspaceId = activeTab?.kind === 'conversation' ? activeTab.workspaceId : useAppStore.getState().activeWorkspace?.id
            if (workspaceId) void newConversation(workspaceId, paneId)
          }} className="rounded p-1 text-muted hover:bg-highlight hover:text-primary" title={t('workspacePane.newConversation')}><MessageSquarePlus size={13} /></button>
          <button type="button" onClick={() => void newBrowser(undefined, paneId)} className="rounded p-1 text-muted hover:bg-highlight hover:text-primary" title={t('browser.newTab')}><Plus size={13} /></button>
          <button type="button" onClick={() => split(paneId, 'horizontal')} className="rounded p-1 text-muted hover:bg-highlight hover:text-primary" title={t('workspacePane.splitRight')}><Columns2 size={13} /></button>
          <button type="button" onClick={() => split(paneId, 'vertical')} className="rounded p-1 text-muted hover:bg-highlight hover:text-primary" title={t('workspacePane.splitDown')}><Rows2 size={13} /></button>
          {paneCount > 1 && <button type="button" onClick={() => closePane(paneId)} className="rounded p-1 text-muted hover:bg-highlight hover:text-primary" title={t('workspacePane.closePane')}><ArrowDownToLine className="rotate-90" size={13} /></button>}
        </div>
      </div>
      {!activeTab ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-dim">
          {useAppStore.getState().activeWorkspace && <button type="button" onClick={() => void newConversation(useAppStore.getState().activeWorkspace!.id, paneId)} className="rounded border border-border px-3 py-1.5 hover:bg-highlight">{t('workspacePane.newConversation')}</button>}
          <button type="button" onClick={() => void newBrowser(undefined, paneId)} className="rounded border border-border px-3 py-1.5 hover:bg-highlight">{t('browser.newTab')}</button>
          <span>{t('workspacePane.dropTab')}</span>
        </div>
      ) : activeTab.kind === 'browser' ? (
        <BrowserPane browserId={activeTab.browserId} />
      ) : (
        <RuntimeConversation runtimeId={activeTab.runtimeId} />
      )}
    </section>
  )
}

function Split({ node }: { node: Extract<PaneNode, { type: 'split' }> }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const resize = useWorkspaceTabStore((state) => state.resize)
  const horizontal = node.direction === 'horizontal'
  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    const move = (moveEvent: MouseEvent): void => {
      const ratio = horizontal ? (moveEvent.clientX - rect.left) / rect.width : (moveEvent.clientY - rect.top) / rect.height
      resize(node.id, ratio)
    }
    const up = (): void => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  return (
    <div ref={containerRef} className={clsx('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col')}>
      <div className="flex min-h-0 min-w-0" style={{ flexBasis: `${node.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}><PaneTree node={node.first} /></div>
      <div onMouseDown={startResize} className={horizontal ? 'w-1.5 shrink-0 cursor-col-resize border-x border-border/70 hover:bg-accent/40' : 'h-1.5 shrink-0 cursor-row-resize border-y border-border/70 hover:bg-accent/40'} />
      <div className="flex min-h-0 min-w-0 flex-1"><PaneTree node={node.second} /></div>
    </div>
  )
}

function PaneTree({ node }: { node: PaneNode }): React.JSX.Element {
  return node.type === 'pane' ? <Pane paneId={node.paneId} /> : <Split node={node} />
}

export function WorkspaceSurface(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const layout = useWorkspaceTabStore((state) => state.layout)
  const tabs = useWorkspaceTabStore((state) => state.tabs)
  const browserStates = useWorkspaceTabStore((state) => state.browserStates)
  const upsertBrowser = useWorkspaceTabStore((state) => state.upsertBrowser)
  const ensureConversations = useWorkspaceTabStore((state) => state.ensureConversations)
  const focusConversation = useWorkspaceTabStore((state) => state.focusConversation)
  const runtimes = useAppStore((state) => state.sessionRuntimes)
  const activeRuntimeId = useAppStore((state) => state.activeSessionRuntimeId)
  const sessions = useAppStore((state) => state.sessionList)
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen)
  const taskLauncherOpen = useAppStore((state) => state.taskLauncherOpen)
  const notePickerOpen = useAppStore((state) => state.notePickerOpen)
  const confirmOpen = useAppStore((state) => state.confirmRequest !== null)
  const extensionDialogOpen = useAppStore((state) => state.extensionUiRequest !== null)

  const labels = useMemo(() => Object.fromEntries(Object.values(runtimes).map((runtime) => {
    const session = sessions.find((item) => runtime.sessionPath && pathsEqual(item.path, runtime.sessionPath))
    return [runtime.runtimeId, session ? getSessionTitle(session.name, session.sessionId, session.preview) : 'New Session']
  })), [runtimes, sessions])

  useEffect(() => ensureConversations(Object.values(runtimes), labels), [ensureConversations, labels, runtimes])
  useEffect(() => { if (activeRuntimeId) focusConversation(activeRuntimeId) }, [activeRuntimeId, focusConversation])
  useEffect(() => installBrowserStateListener(), [])
  useEffect(() => { void window.piDesktop.browser.list().then((items) => items.forEach((item) => upsertBrowser(item))) }, [upsertBrowser])

  const overlayOpen = commandPaletteOpen || taskLauncherOpen || notePickerOpen || confirmOpen || extensionDialogOpen
  const syncBounds = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const visible = new Map<string, DOMRect>()
    if (!overlayOpen) {
      root.querySelectorAll<HTMLElement>('[data-browser-view-id]').forEach((element) => {
        const id = element.dataset.browserViewId
        if (id) visible.set(id, element.getBoundingClientRect())
      })
    }
    const payload = Object.keys(browserStates).map((id) => {
      const bounds = visible.get(id)
      return { id, visible: Boolean(bounds), bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : { x: 0, y: 0, width: 0, height: 0 } }
    })
    void window.piDesktop.browser.setLayout(payload)
  }, [browserStates, overlayOpen])

  useEffect(() => {
    const frame = requestAnimationFrame(syncBounds)
    const observer = new ResizeObserver(syncBounds)
    if (rootRef.current) observer.observe(rootRef.current)
    window.addEventListener('resize', syncBounds)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', syncBounds); void window.piDesktop.browser.setLayout([]) }
  }, [layout, syncBounds, tabs])

  return <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden"><PaneTree node={layout.root} /></div>
}
