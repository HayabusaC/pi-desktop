export type SplitDirection = 'horizontal' | 'vertical'

export interface WorkspacePane {
  id: string
  tabIds: string[]
  activeTabId: string | null
}

export type PaneNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; id: string; direction: SplitDirection; ratio: number; first: PaneNode; second: PaneNode }

export interface WorkspaceLayout {
  root: PaneNode
  panes: Record<string, WorkspacePane>
  activePaneId: string
}

let nextId = 1
const id = (prefix: string): string => `${prefix}-${Date.now()}-${nextId++}`

export function createWorkspaceLayout(): WorkspaceLayout {
  const paneId = id('pane')
  return { root: { type: 'pane', paneId }, panes: { [paneId]: { id: paneId, tabIds: [], activeTabId: null } }, activePaneId: paneId }
}

function replacePane(node: PaneNode, paneId: string, replacement: PaneNode): PaneNode {
  if (node.type === 'pane') return node.paneId === paneId ? replacement : node
  return { ...node, first: replacePane(node.first, paneId, replacement), second: replacePane(node.second, paneId, replacement) }
}

function firstPane(node: PaneNode): string {
  return node.type === 'pane' ? node.paneId : firstPane(node.first)
}

export function addTab(layout: WorkspaceLayout, tabId: string, paneId = layout.activePaneId): WorkspaceLayout {
  const pane = layout.panes[paneId]
  if (!pane) return layout
  const panes = removeTab(layout, tabId).panes
  const target = panes[paneId] ?? pane
  return {
    ...layout,
    panes: { ...panes, [paneId]: { ...target, tabIds: [...target.tabIds, tabId], activeTabId: tabId } },
    activePaneId: paneId,
  }
}

export function removeTab(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  let changed = false
  const panes = Object.fromEntries(Object.entries(layout.panes).map(([paneId, pane]) => {
    if (!pane.tabIds.includes(tabId)) return [paneId, pane]
    changed = true
    const tabIds = pane.tabIds.filter((id) => id !== tabId)
    const activeTabId = pane.activeTabId === tabId ? (tabIds.at(-1) ?? null) : pane.activeTabId
    return [paneId, { ...pane, tabIds, activeTabId }]
  }))
  return changed ? { ...layout, panes } : layout
}

export function activateTab(layout: WorkspaceLayout, paneId: string, tabId: string | null): WorkspaceLayout {
  const pane = layout.panes[paneId]
  if (!pane || (tabId !== null && !pane.tabIds.includes(tabId))) return layout
  return { ...layout, activePaneId: paneId, panes: { ...layout.panes, [paneId]: { ...pane, activeTabId: tabId } } }
}

export function moveTab(layout: WorkspaceLayout, tabId: string, paneId: string, index?: number): WorkspaceLayout {
  const removed = removeTab(layout, tabId)
  const pane = removed.panes[paneId]
  if (!pane) return layout
  const at = Math.max(0, Math.min(index ?? pane.tabIds.length, pane.tabIds.length))
  const tabIds = [...pane.tabIds]
  tabIds.splice(at, 0, tabId)
  return { ...removed, activePaneId: paneId, panes: { ...removed.panes, [paneId]: { ...pane, tabIds, activeTabId: tabId } } }
}

export function splitPane(layout: WorkspaceLayout, paneId: string, direction: SplitDirection): WorkspaceLayout {
  if (!layout.panes[paneId]) return layout
  const newPaneId = id('pane')
  const replacement: PaneNode = {
    type: 'split',
    id: id('split'),
    direction,
    ratio: 0.5,
    first: { type: 'pane', paneId },
    second: { type: 'pane', paneId: newPaneId },
  }
  return {
    root: replacePane(layout.root, paneId, replacement),
    panes: { ...layout.panes, [newPaneId]: { id: newPaneId, tabIds: [], activeTabId: null } },
    activePaneId: newPaneId,
  }
}

function collapse(node: PaneNode, paneId: string): { node: PaneNode | null; sibling: PaneNode | null } {
  if (node.type === 'pane') return { node: node.paneId === paneId ? null : node, sibling: null }
  const left = collapse(node.first, paneId)
  if (!left.node) return { node: node.second, sibling: node.second }
  const right = collapse(node.second, paneId)
  if (!right.node) return { node: node.first, sibling: node.first }
  return { node: { ...node, first: left.node, second: right.node }, sibling: left.sibling ?? right.sibling }
}

export function closePane(layout: WorkspaceLayout, paneId: string): WorkspaceLayout {
  if (layout.root.type === 'pane' || !layout.panes[paneId]) return layout
  const result = collapse(layout.root, paneId)
  if (!result.node || !result.sibling) return layout
  const targetId = firstPane(result.sibling)
  const closing = layout.panes[paneId]
  const target = layout.panes[targetId]
  const tabIds = [...target.tabIds, ...closing.tabIds.filter((tab) => !target.tabIds.includes(tab))]
  const panes = { ...layout.panes }
  delete panes[paneId]
  panes[targetId] = { ...target, tabIds, activeTabId: target.activeTabId ?? closing.activeTabId ?? tabIds[0] ?? null }
  return { root: result.node, panes, activePaneId: targetId }
}

export function setSplitRatio(layout: WorkspaceLayout, splitId: string, ratio: number): WorkspaceLayout {
  const bounded = Math.max(0.15, Math.min(0.85, ratio))
  const visit = (node: PaneNode): PaneNode => node.type === 'pane'
    ? node
    : { ...node, ratio: node.id === splitId ? bounded : node.ratio, first: visit(node.first), second: visit(node.second) }
  return { ...layout, root: visit(layout.root) }
}
