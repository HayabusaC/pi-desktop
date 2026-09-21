import { create } from 'zustand'
import type { BrowserTabState, SessionRuntimeInfo } from '../../shared/ipc-contracts'
import {
  activateTab,
  addTab,
  closePane,
  createWorkspaceLayout,
  moveTab,
  removeTab,
  setSplitRatio,
  splitPane,
  type SplitDirection,
  type WorkspaceLayout,
} from './workspace-layout'

export type WorkspaceTab =
  | { id: string; kind: 'conversation'; runtimeId: string; workspaceId: string; title: string }
  | { id: string; kind: 'browser'; browserId: string; title: string }

interface WorkspaceTabState {
  layout: WorkspaceLayout
  tabs: Record<string, WorkspaceTab>
  browserStates: Record<string, BrowserTabState>
  ensureConversations(runtimes: SessionRuntimeInfo[], labels: Record<string, string>): void
  upsertBrowser(state: BrowserTabState, activate?: boolean): void
  dropBrowser(browserId: string): void
  newBrowser(url?: string, paneId?: string): Promise<void>
  newConversation(workspaceId: string, paneId?: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  activate(paneId: string, tabId: string | null): void
  focusConversation(runtimeId: string): void
  move(tabId: string, paneId: string, index?: number): void
  split(paneId: string, direction: SplitDirection): void
  closePane(paneId: string): void
  resize(splitId: string, ratio: number): void
}

const conversationTabId = (runtimeId: string): string => `conversation:${runtimeId}`
const browserTabId = (browserId: string): string => `browser:${browserId}`

export const useWorkspaceTabStore = create<WorkspaceTabState>((set, get) => ({
  layout: createWorkspaceLayout(),
  tabs: {},
  browserStates: {},

  ensureConversations: (runtimes, labels) => set((state) => {
    let layout = state.layout
    const tabs = { ...state.tabs }
    const knownRuntimeIds = new Set(runtimes.map((runtime) => runtime.runtimeId))
    for (const runtime of runtimes) {
      const id = conversationTabId(runtime.runtimeId)
      tabs[id] = {
        id,
        kind: 'conversation',
        runtimeId: runtime.runtimeId,
        workspaceId: runtime.workspaceId,
        title: labels[runtime.runtimeId] || 'Conversation',
      }
      if (!Object.values(layout.panes).some((pane) => pane.tabIds.includes(id))) {
        layout = addTab(layout, id)
      }
    }
    for (const tab of Object.values(tabs)) {
      if (tab.kind === 'conversation' && !knownRuntimeIds.has(tab.runtimeId)) {
        delete tabs[tab.id]
        layout = removeTab(layout, tab.id)
      }
    }
    return { tabs, layout }
  }),

  upsertBrowser: (browser, shouldActivate = false) => set((state) => {
    const id = browserTabId(browser.id)
    const exists = Boolean(state.tabs[id])
    const tabs = { ...state.tabs, [id]: { id, kind: 'browser' as const, browserId: browser.id, title: browser.title || browser.url || 'New Tab' } }
    const layout = !exists || shouldActivate ? addTab(state.layout, id) : state.layout
    return { tabs, layout, browserStates: { ...state.browserStates, [browser.id]: browser } }
  }),

  dropBrowser: (browserId) => set((state) => {
    const id = browserTabId(browserId)
    const tabs = { ...state.tabs }
    const browserStates = { ...state.browserStates }
    delete tabs[id]
    delete browserStates[browserId]
    return { tabs, browserStates, layout: removeTab(state.layout, id) }
  }),

  newBrowser: async (url, paneId) => {
    const browser = await window.piDesktop.browser.create(url)
    set((state) => {
      const id = browserTabId(browser.id)
      return {
        tabs: { ...state.tabs, [id]: { id, kind: 'browser', browserId: browser.id, title: browser.title || 'New Tab' } },
        browserStates: { ...state.browserStates, [browser.id]: browser },
        layout: addTab(state.layout, id, paneId ?? state.layout.activePaneId),
      }
    })
  },

  newConversation: async (workspaceId, paneId) => {
    const runtime = await window.piDesktop.session.createInWorkspace(workspaceId)
    set((state) => {
      const id = conversationTabId(runtime.runtimeId)
      return {
        tabs: { ...state.tabs, [id]: { id, kind: 'conversation', runtimeId: runtime.runtimeId, workspaceId, title: 'New Session' } },
        layout: addTab(state.layout, id, paneId ?? state.layout.activePaneId),
      }
    })
  },

  closeTab: async (tabId) => {
    const tab = get().tabs[tabId]
    if (!tab) return
    if (tab.kind === 'browser') await window.piDesktop.browser.close(tab.browserId)
    set((state) => {
      const tabs = { ...state.tabs }
      const browserStates = { ...state.browserStates }
      delete tabs[tabId]
      if (tab.kind === 'browser') delete browserStates[tab.browserId]
      return { tabs, browserStates, layout: removeTab(state.layout, tabId) }
    })
  },

  activate: (paneId, tabId) => set((state) => ({ layout: activateTab(state.layout, paneId, tabId) })),
  focusConversation: (runtimeId) => set((state) => {
    const tabId = conversationTabId(runtimeId)
    const pane = Object.values(state.layout.panes).find((item) => item.tabIds.includes(tabId))
    return pane ? { layout: activateTab(state.layout, pane.id, tabId) } : state
  }),
  move: (tabId, paneId, index) => set((state) => ({ layout: moveTab(state.layout, tabId, paneId, index) })),
  split: (paneId, direction) => set((state) => ({ layout: splitPane(state.layout, paneId, direction) })),
  closePane: (paneId) => set((state) => ({ layout: closePane(state.layout, paneId) })),
  resize: (splitId, ratio) => set((state) => ({ layout: setSplitRatio(state.layout, splitId, ratio) })),
}))

export function installBrowserStateListener(): () => void {
  return window.piDesktop.onBrowserState((browser) => {
    if (browser.closed) useWorkspaceTabStore.getState().dropBrowser(browser.id)
    else useWorkspaceTabStore.getState().upsertBrowser(browser)
  })
}
