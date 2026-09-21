import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, FolderOpen, GitBranch, Loader2, MessageSquarePlus, PanelLeft, Plus, Settings, X, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../store'
import { useGlobalWorkflowOpen } from '../hooks'
import type { Workspace } from '../../../shared/ipc-contracts'

function tabLabel(workspace: Workspace): string {
  return workspace.name || workspace.path.split(/[\\/]/).filter(Boolean).pop() || workspace.path
}

export function WorkspaceTabs(): React.JSX.Element {
  const { t } = useTranslation()
  const workspaces = useAppStore((state) => state.workspaces)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const workspaceActivity = useAppStore((state) => state.workspaceActivity)
  const currentView = useAppStore((state) => state.currentView)
  const globalWorkflowOpen = useGlobalWorkflowOpen()
  const setWorkflowPanelOpen = useAppStore((state) => state.setWorkflowPanelOpen)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const removeWorkspace = useAppStore((state) => state.removeWorkspace)
  const createWorktreeTab = useAppStore((state) => state.createWorktreeTab)
  const createNewSession = useAppStore((state) => state.createNewSession)
  const setCurrentView = useAppStore((state) => state.setCurrentView)

  const toolView = ['settings', 'packages', 'mcp', 'notes', 'skills', 'diagnostics'] as const
  const toolsActive =
    toolView.includes(currentView as (typeof toolView)[number]) || globalWorkflowOpen

  const tabs = useMemo(
    () => [...workspaces].sort((a, b) => a.createdAt - b.createdAt),
    [workspaces]
  )

  return (
    <div className="flex shrink-0 flex-col bg-app">
    <div className="flex h-8 items-end gap-0.5 overflow-x-auto border-b border-border px-1.5 pt-0.5">
      {!sidebarOpen && (
        <button
          type="button"
          onClick={toggleSidebar}
          className="mb-0.5 flex h-6 w-6 shrink-0 animate-fade-in items-center justify-center rounded border border-border-strong bg-surface text-muted shadow-sm transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
          title={t('common.showSidebar')}
          aria-label={t('common.showSidebar')}
        >
          <PanelLeft size={15} />
        </button>
      )}
      {tabs.map((workspace) => {
        const active = workspace.id === activeWorkspace?.id && !toolsActive
        const activity = workspaceActivity[workspace.id]
        const isWorktree = workspace.kind === 'worktree'
        const isWorking = activity?.state === 'working'
        const needsApproval = activity?.state === 'needs-approval'
        const completed = activity?.state === 'completed'
        const failed = activity?.state === 'failed'

        return (
          <div
            key={workspace.id}
            onAuxClick={(event) => {
              // DOM button 1 is the middle mouse button. Keep right-click for
              // the normal context menu and use the middle button as tab-close.
              if (event.button !== 1) return
              event.preventDefault()
              void removeWorkspace(workspace.id)
            }}
            className={clsx(
              'group flex h-7 min-w-[128px] max-w-[210px] shrink-0 items-center gap-1.5 rounded-t border border-b-0 px-2 text-[11px] transition-colors',
              active
                ? 'border-border bg-surface text-primary'
                : 'border-transparent text-muted hover:bg-surface/60 hover:text-secondary'
            )}
          >
            <button
              type="button"
              onClick={() => {
                setWorkflowPanelOpen(false)
                if (workspace.id === activeWorkspace?.id) {
                  setCurrentView('chat')
                  return
                }
                void activateWorkspace(workspace.id).then((switched) => {
                  if (switched) setCurrentView('chat')
                })
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={`${workspace.path}${workspace.branch ? `\n${workspace.branch}` : ''}`}
            >
              {isWorktree ? (
                <GitBranch size={13} className="shrink-0 text-special" />
              ) : (
                <FolderOpen size={13} className="shrink-0 text-dim" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">{tabLabel(workspace)}</span>
              {isWorking && <Loader2 size={12} className="shrink-0 animate-spin text-accent-fg" />}
              {needsApproval && <AlertCircle size={12} className="shrink-0 text-warning" />}
              {completed && <CheckCircle2 size={12} className="shrink-0 text-success" />}
              {failed && <XCircle size={12} className="shrink-0 text-error" />}
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                onClick={() => void removeWorkspace(workspace.id)}
                className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-all hover:bg-highlight hover:text-primary group-hover:opacity-100"
                title={isWorktree ? t('store.confirm.closeTabLabel') : t('store.confirm.removeWorkspaceTitle')}
                aria-label={
                  isWorktree
                    ? t('workspaceTabs.closeTabAriaLabel', { name: tabLabel(workspace) })
                    : t('workspaceTabs.removeWorkspaceAriaLabel', { name: tabLabel(workspace) })
                }
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}

      {toolsActive && (
        <div className="group flex h-7 min-w-[120px] shrink-0 items-center rounded-t border border-b-0 border-border bg-surface text-primary">
          {/* The tab only exists while a tool surface is on screen, so its label
              always names what is already showing — a static marker, never a
              control that navigates somewhere the user did not ask for. Closing
              is the neighbouring button's job. */}
          <div
            aria-current="page"
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[11px]"
            title={t('workspaceTabs.tools')}
          >
            <Settings size={13} className="shrink-0 text-accent-fg" />
            <span className="truncate font-medium">{t('workspaceTabs.tools')}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setWorkflowPanelOpen(false)
              setCurrentView('chat')
            }}
            className="mr-1 rounded p-1 text-faint opacity-0 transition-all hover:bg-highlight hover:text-primary group-hover:opacity-100"
            title={t('workspaceTabs.closeTools')}
            aria-label={t('workspaceTabs.closeTools')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setWorkflowPanelOpen(false)
          setCurrentView('chat')
          void createNewSession()
        }}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-primary transition-colors"
        title={t('workspaceTabs.newSessionTitle')}
        aria-label={t('workspaceTabs.newSessionAriaLabel')}
      >
        <MessageSquarePlus size={15} />
      </button>
      <button
        type="button"
        onClick={() => void createWorktreeTab()}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-primary transition-colors"
        title={t('workspaceTabs.newIsolatedTabTitle')}
        aria-label={t('workspaceTabs.newIsolatedTabAriaLabel')}
      >
        <Plus size={15} />
      </button>
    </div>
    </div>
  )
}
