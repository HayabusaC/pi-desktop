import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, type MagicContextAction, type MagicContextActionResult, type MagicContextCapabilities, type PiRpcEvent } from '../../shared/ipc-contracts'
import { getAgentInvoked, getCommandOutputText } from '../../shared/rpc-lifecycle'
import { buildMagicContextCapabilities } from '../../shared/magic-context-capabilities'
import { magicContextActionCommand } from '../../shared/magic-context-control'
import {
  deleteMagicContextMemory,
  loadMagicContextDashboardData,
  readMagicContextConfig,
  resolveMagicContextConfigPaths,
  resolveMagicContextDbPath,
  updateMagicContextMemory,
  writeMagicContextConfig,
} from '../magic-context-service'
import type { PiRpcManager } from '../pi-rpc-manager'
import type { IpcContext } from './context'
import { assertTrustedSender } from './validation'

const DEBUG = process.env.PI_DESKTOP_MAGIC_CONTEXT_DEBUG === '1'
const debug = (label: string, detail: Record<string, unknown>): void => {
  if (DEBUG) console.debug(`[Magic Context] ${label}`, detail)
}

async function extensionCommands(pi: PiRpcManager): Promise<Set<string>> {
  const type = pi.getEngineKind() === 'omp' ? 'get_available_commands' : 'get_commands'
  const response = await pi.sendCommand({ type }) as { success?: boolean; data?: { commands?: Array<{ name?: unknown; source?: unknown }> } } | null
  if (!response?.success || !Array.isArray(response.data?.commands)) return new Set()
  return new Set(response.data.commands
    .filter((command) => command?.source === 'extension' && typeof command.name === 'string')
    .map((command) => command.name as string))
}

async function capabilities(ctx: IpcContext): Promise<MagicContextCapabilities> {
  const projectPath = ctx.workspaceManager.getActiveWorkspace()?.path
  const configPaths = resolveMagicContextConfigPaths(projectPath)
  const pi = ctx.workspaceManager.getActivePiManager()
  if (!pi || pi.getStatus().status !== 'running') {
    return { magicContext: false, ctxWrapup: false, ctxFlush: false, ctxDreamer: false, ctxMemory: false, ctxHistorian: false, ctxDashboardData: false, dbPath: null, configPaths }
  }
  try {
    const commands = await extensionCommands(pi)
    const result = buildMagicContextCapabilities(commands, resolveMagicContextDbPath(), configPaths)
    debug('capability detection', { engine: pi.getEngineKind(), commands: [...commands].filter((name) => name.startsWith('ctx-')), ...result })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debug('capability detection failed', { error: message })
    return { magicContext: false, ctxWrapup: false, ctxFlush: false, ctxDreamer: false, ctxMemory: false, ctxHistorian: false, ctxDashboardData: false, dbPath: null, configPaths, error: message }
  }
}

function validateAction(value: unknown): MagicContextAction {
  if (!value || typeof value !== 'object') throw new Error('Invalid Magic Context action')
  const record = value as Record<string, unknown>
  if (record.action === 'status' || record.action === 'flush') return { action: record.action }
  if (record.action === 'wrapup' && (record.keep === 20 || record.keep === 50)) return { action: 'wrapup', keep: record.keep }
  if (record.action === 'dream' && (record.task === undefined || typeof record.task === 'string')) return { action: 'dream', ...(record.task ? { task: record.task } : {}) }
  throw new Error('Invalid Magic Context action')
}

async function runAction(pi: PiRpcManager, action: MagicContextAction): Promise<MagicContextActionResult> {
  const output: string[] = []
  const listener = (event: PiRpcEvent): void => {
    if (event.type === 'command_output') {
      const value = getCommandOutputText(event)
      if (value) output.push(value)
    }
  }
  pi.on('event', listener)
  try {
    const response = await pi.sendCommand({ type: 'prompt', message: magicContextActionCommand(action) }) as { success?: boolean } | null
    const agentInvoked = getAgentInvoked(response)
    const success = response?.success === true && agentInvoked === false
    const result = { success, output: output.join('\n') || undefined, ...(success ? {} : { error: agentInvoked === true ? 'Magic Context command was not consumed by the extension' : 'Magic Context command failed' }) }
    debug('action result', { action: action.action, success, outputChars: result.output?.length ?? 0 })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debug('action failed', { action: action.action, error: message })
    return { success: false, error: message }
  } finally { pi.off('event', listener) }
}

export function registerMagicContextHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_CAPABILITIES, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event)
    return capabilities(ctx)
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_DATA, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event)
    const caps = await capabilities(ctx)
    if (!caps.magicContext || !caps.dbPath) throw new Error('Magic Context is not active for the current session')
    try { return loadMagicContextDashboardData(caps.dbPath) }
    catch (error) { debug('dashboard data load failed', { error: error instanceof Error ? error.message : String(error) }); throw error }
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_ACTION, async (event: IpcMainInvokeEvent, value: unknown) => {
    assertTrustedSender(event)
    const action = validateAction(value)
    const caps = await capabilities(ctx)
    const required = action.action === 'wrapup' ? caps.ctxWrapup : action.action === 'flush' ? caps.ctxFlush : action.action === 'dream' ? caps.ctxDreamer : caps.magicContext
    if (!required) return { success: false, error: `Magic Context ${action.action} capability is not active` }
    return runAction(ctx.getActivePi(), action)
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_COMPACT, async (event: IpcMainInvokeEvent, keep: unknown): Promise<MagicContextActionResult> => {
    assertTrustedSender(event)
    if (keep !== undefined && keep !== 20 && keep !== 50) throw new Error('Invalid compact keep count')
    const caps = await capabilities(ctx)
    const pi = ctx.getActivePi()
    if (!caps.magicContext) {
      debug('compact route', { route: 'native' })
      try {
        const response = await pi.sendCommand({ type: 'compact' }) as { success?: boolean } | null
        return response?.success === false ? { success: false, error: 'Native compact failed' } : { success: true }
      } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
    }
    debug('compact route', { route: 'magic-context', keep: keep ?? 20 })
    if (!caps.ctxWrapup) return { success: false, error: 'Magic Context wrap-up is unavailable for this session' }
    // Deliberately no native fallback: an active Magic Context session owns compaction.
    return runAction(pi, { action: 'wrapup', keep: (keep ?? 20) as 20 | 50 })
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_MEMORY_UPDATE, async (event: IpcMainInvokeEvent, id: unknown, content: unknown) => {
    assertTrustedSender(event)
    if (!Number.isSafeInteger(id) || typeof content !== 'string') throw new Error('Invalid memory update')
    const caps = await capabilities(ctx)
    if (!caps.ctxMemory || !caps.dbPath) throw new Error('Magic Context memory capability is not active')
    updateMagicContextMemory(caps.dbPath, id as number, content)
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_MEMORY_DELETE, async (event: IpcMainInvokeEvent, id: unknown) => {
    assertTrustedSender(event)
    if (!Number.isSafeInteger(id)) throw new Error('Invalid memory id')
    const caps = await capabilities(ctx)
    if (!caps.ctxMemory || !caps.dbPath) throw new Error('Magic Context memory capability is not active')
    deleteMagicContextMemory(caps.dbPath, id as number)
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_CONFIG_READ, async (event: IpcMainInvokeEvent, source: unknown) => {
    assertTrustedSender(event)
    if (source !== 'user' && source !== 'project') throw new Error('Invalid config source')
    return readMagicContextConfig(source, ctx.workspaceManager.getActiveWorkspace()?.path)
  })
  ipcMain.handle(IPC_CHANNELS.MAGIC_CONTEXT_CONFIG_WRITE, async (event: IpcMainInvokeEvent, source: unknown, content: unknown) => {
    assertTrustedSender(event)
    if ((source !== 'user' && source !== 'project') || typeof content !== 'string') throw new Error('Invalid config write')
    const caps = await capabilities(ctx)
    if (!caps.magicContext) throw new Error('Magic Context is not active for the current session')
    await writeMagicContextConfig(source, content, ctx.workspaceManager.getActiveWorkspace()?.path)
  })
}
