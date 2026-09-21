import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import type {
  McpRuntimeStatus,
  McpServerActionRequest,
  McpServerActionResult,
  McpServerInfo,
  PiRpcEvent,
} from '../../shared/ipc-contracts'
import { getAgentInvoked, getCommandOutputText } from '../../shared/rpc-lifecycle'
import type { IpcContext } from './context'
import { getPiCli } from '../pi-rpc-manager'
import { listSkills, mergeRpcSkills } from '../skills-discovery'

const MCP_DEBUG = process.env.PI_DESKTOP_RPC_DEBUG === '1'
const MCP_NAME = /^[a-zA-Z0-9_.:-]+(?: [a-zA-Z0-9_.:-]+)*$/
const SECRET_KEY = /(?:api[-_]?key|authorization|token|secret|password|credential|cookie|env|headers|auth|oauth)/i
const SECRET_ARG = /^(?:--?(?:api[-_]?key|authorization|token|secret|password|credential)|-p)$/i
const SECRET_ARG_ASSIGNMENT = /^(--?(?:api[-_]?key|authorization|token|secret|password|credential)=).+$/i
const runtimeResults = new Map<string, { status: McpRuntimeStatus; error?: string }>()

function debug(label: string, detail: Record<string, unknown>): void {
  if (MCP_DEBUG) console.debug(`[MCP discovery] ${label}`, detail)
}

export function registerSkillsMcpHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async () => {
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    const pi = workspaceManager.getActivePiManager()
    const engine = pi?.getEngineKind() ?? getPiCli().kind ?? 'pi'
    const skills = await listSkills(cwd, engine)
    if (pi && pi.getStatus().status === 'running') mergeRpcSkills(skills, await fetchCommands(pi))
    return skills
  })

  ipcMain.handle(IPC_CHANNELS.COMMANDS_LIST, async () => {
    const pi = workspaceManager.getActivePiManager()
    if (!pi || pi.getStatus().status !== 'running') return []
    return fetchCommands(pi)
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SERVERS_LIST, async () => {
    const cwd = workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    const pi = workspaceManager.getActivePiManager()
    return listMcpServers(cwd, pi && pi.getStatus().status === 'running' ? pi : null)
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SERVERS_ACTION, async (_event, value: unknown) => {
    const request = validateAction(value)
    const pi = workspaceManager.getActivePiManager()
    if (!pi || pi.getStatus().status !== 'running' || pi.getEngineKind() !== 'omp') {
      throw new Error('OMP must be running to manage MCP servers')
    }
    const cwd = workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    let result: McpServerActionResult
    if (request.action === 'reload') {
      // OMP's ACP `/mcp reload` only refreshes command metadata in 18.2.6.
      // `/reload-plugins` is the native RPC-safe path that rediscoveries and
      // reconnects MCP while retaining the active session.
      result = await runMcpCommand(pi, '/reload-plugins')
    } else if (request.action === 'reconnect') {
      // Per-server reconnect is TUI-only in OMP 18.2.6. Reload the native MCP
      // manager, then use OMP's own test command to report this server's result.
      const reload = await runMcpCommand(pi, '/reload-plugins')
      const test = reload.success
        ? await runMcpCommand(pi, `/mcp test ${request.name}`)
        : { success: false }
      result = mergeActionResults(reload, test)
    } else {
      result = await runMcpCommand(pi, `/mcp ${request.action} ${request.name}`)
      if (result.success && (request.action === 'enable' || request.action === 'disable')) {
        result = mergeActionResults(result, await runMcpCommand(pi, '/reload-plugins'))
      }
    }
    if (request.name && (request.action === 'test' || request.action === 'reconnect')) {
      const runtime = classifyMcpActionResult(result.success, result.output)
      runtimeResults.set(`${resolve(cwd)}\0${request.name}`, {
        status: runtime.status,
        error: runtime.error,
      })
    }
    debug('runtime action', {
      action: request.action,
      name: request.name,
      success: result.success,
      agentInvoked: result.agentInvoked ?? 'missing',
      outputChars: result.output?.length ?? 0,
    })
    return result
  })
}

function mergeActionResults(...results: McpServerActionResult[]): McpServerActionResult {
  const outputs = results.map((result) => result.output).filter((output): output is string => Boolean(output))
  const agentInvoked = results.map(getAgentInvoked).find((value) => value === true)
    ?? (results.every((result) => getAgentInvoked(result) === false) ? false : undefined)
  return {
    success: results.every((result) => result.success),
    output: outputs.join('\n') || undefined,
    ...(agentInvoked === undefined ? {} : { agentInvoked }),
  }
}

export function classifyMcpActionResult(success: boolean, output?: string): { status: McpRuntimeStatus; error?: string } {
  const failed = !success || /(?:failed|error|not found|unreachable)/i.test(output ?? '')
  return failed
    ? { status: 'error', error: output || 'MCP operation failed' }
    : { status: 'connected' }
}

async function fetchCommands(pi: {
  getEngineKind(): 'pi' | 'omp'
  sendCommand(command: Record<string, unknown>): Promise<unknown>
}): Promise<unknown[]> {
  try {
    const command = pi.getEngineKind() === 'omp' ? 'get_available_commands' : 'get_commands'
    const response = (await pi.sendCommand({ type: command })) as { success?: boolean; data?: { commands?: unknown[] } } | null
    return response?.success && Array.isArray(response.data?.commands) ? response.data.commands : []
  } catch {
    return []
  }
}

function validateAction(value: unknown): McpServerActionRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid MCP action')
  const request = value as Record<string, unknown>
  const action = request.action
  if (!['reload', 'test', 'reconnect', 'enable', 'disable'].includes(String(action))) {
    throw new Error('Invalid MCP action')
  }
  if (action !== 'reload' && (typeof request.name !== 'string' || !MCP_NAME.test(request.name))) {
    throw new Error('Invalid MCP server name')
  }
  return { action: action as McpServerActionRequest['action'], name: request.name as string | undefined }
}

async function runMcpCommand(
  pi: {
    on(event: 'event', listener: (event: PiRpcEvent) => void): unknown
    off(event: 'event', listener: (event: PiRpcEvent) => void): unknown
    sendCommand(command: Record<string, unknown>): Promise<unknown>
  },
  message: string
): Promise<McpServerActionResult> {
  const output: string[] = []
  const listener = (event: PiRpcEvent): void => {
    if (event.type === 'command_output') {
      const text = getCommandOutputText(event)
      if (text) output.push(text)
    }
  }
  pi.on('event', listener)
  try {
    const response = await pi.sendCommand({ type: 'prompt', message }) as { success?: boolean } | null
    const agentInvoked = getAgentInvoked(response)
    return {
      success: response?.success === true,
      output: output.join('\n') || undefined,
      ...(agentInvoked === undefined ? {} : { agentInvoked }),
    }
  } finally {
    pi.off('event', listener)
  }
}

function ompAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return resolve(process.env.PI_CODING_AGENT_DIR)
  const profile = process.env.OMP_PROFILE !== undefined ? process.env.OMP_PROFILE : process.env.PI_PROFILE
  const configDir = process.env.PI_CONFIG_DIR || '.omp'
  return profile && profile !== 'default'
    ? join(homedir(), configDir, 'profiles', profile, 'agent')
    : join(homedir(), configDir, 'agent')
}

function discoveryPaths(cwd: string): Array<{ path: string; scope: 'global' | 'project'; provider: string }> {
  return [
    { path: join(ompAgentDir(), 'mcp.json'), scope: 'global', provider: 'omp-user' },
    { path: join(cwd, '.omp', 'mcp.json'), scope: 'project', provider: 'omp-project' },
    { path: join(cwd, 'mcp.json'), scope: 'project', provider: 'mcp-json' },
    { path: join(cwd, '.mcp.json'), scope: 'project', provider: 'mcp-json' },
  ]
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch (error) {
    debug('config read failed', { path, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '[redacted invalid URL]'
  }
}

function safeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const args = value.map(String)
  return args.map((arg, index) => {
    if (index > 0 && SECRET_ARG.test(args[index - 1] ?? '')) return '[redacted]'
    if (SECRET_ARG_ASSIGNMENT.test(arg)) return arg.replace(SECRET_ARG_ASSIGNMENT, '$1[redacted]')
    return arg
  })
}

function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((childKey) => [childKey, '[redacted]']))
    }
    return '[redacted]'
  }
  if (Array.isArray(value)) return key === 'args' ? safeArgs(value) : value.map((item) => redact(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
    childKey,
    childKey === 'url' ? safeUrl(child) : redact(child, childKey),
  ]))
}

function serverPrefix(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'server'
  return `mcp__${safe}_`
}

async function connectedToolNames(pi: { sendCommand(command: Record<string, unknown>): Promise<unknown> } | null): Promise<string[]> {
  if (!pi) return []
  try {
    const response = await pi.sendCommand({ type: 'get_state' }) as {
      success?: boolean
      data?: { dumpTools?: Array<{ name?: unknown }> }
    } | null
    const names = response?.success && Array.isArray(response.data?.dumpTools)
      ? response.data.dumpTools.map((tool) => typeof tool?.name === 'string' ? tool.name : '').filter(Boolean)
      : []
    debug('runtime status query', { success: response?.success === true, toolCount: names.length })
    return names
  } catch (error) {
    debug('runtime status query failed', { error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

export async function listMcpServers(
  cwd: string,
  pi: { sendCommand(command: Record<string, unknown>): Promise<unknown> } | null = null
): Promise<McpServerInfo[]> {
  const paths = discoveryPaths(resolve(cwd))
  debug('sources', { paths: paths.map((item) => ({ ...item, exists: existsSync(item.path) })) })
  const userConfig = await readJson(paths[0].path)
  const disabled = new Set(Array.isArray(userConfig?.disabledServers) ? userConfig.disabledServers.map(String) : [])
  const forced = new Set(Array.isArray(userConfig?.enabledServers) ? userConfig.enabledServers.map(String) : [])
  const toolNames = await connectedToolNames(pi)
  const rows: McpServerInfo[] = []

  for (const source of paths) {
    const document = source.path === paths[0].path ? userConfig : await readJson(source.path)
    const servers = document?.mcpServers
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue
    for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const config = raw as Record<string, unknown>
      const transport = config.type === 'sse' || config.type === 'http'
        ? config.type
        : typeof config.url === 'string' ? 'http' : 'stdio'
      const override = runtimeResults.get(`${resolve(cwd)}\0${name}`)
      const inferredConnected = toolNames.some((tool) => tool.startsWith(serverPrefix(name)))
      const enabled = !disabled.has(name) && (config.enabled !== false || forced.has(name))
      rows.push({
        id: `${source.scope}:${source.path}:${name}`,
        name,
        scope: source.scope,
        transport,
        command: typeof config.command === 'string' ? config.command : undefined,
        url: safeUrl(config.url),
        args: safeArgs(config.args),
        enabled,
        configured: true,
        runtimeStatus: override?.status ?? (inferredConnected ? 'connected' : 'disconnected'),
        runtimeError: override?.error,
        sourcePath: source.path,
        config: redact(config) as Record<string, unknown>,
      })
    }
  }
  debug('result', { configured: rows.length, statuses: rows.map(({ name, scope, runtimeStatus }) => ({ name, scope, runtimeStatus })) })
  return rows
}
