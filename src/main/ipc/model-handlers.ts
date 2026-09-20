import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { isString } from './validation'
import type { IpcContext } from './context'
import { runPiCli } from './run-pi-cli'
import { parseProviderQuotaOutput } from '../provider-quota'

const PROVIDER_QUOTA_TIMEOUT_MS = 20_000

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function registerModelHandlers(ctx: IpcContext): void {
  const { getActivePi, workspaceManager } = ctx

  // ─── Model Management ───────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.MODEL_SET, async (_event, provider: unknown, modelId: unknown) => {
    if (!isString(provider)) throw new Error('provider must be a string')
    if (!isString(modelId)) throw new Error('modelId must be a string')
    return getActivePi().sendCommand({ type: 'set_model', provider, modelId })
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_CYCLE, async () => {
    return getActivePi().sendCommand({ type: 'cycle_model' })
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_LIST_AVAILABLE, async () => {
    return getActivePi().sendCommand({ type: 'get_available_models' })
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_PROVIDER_QUOTA, async () => {
    const pi = workspaceManager.getActivePiManager()
    if (!pi || pi.getStatus().status !== 'running') return null

    try {
      // Read the provider from the live RPC state so a stale renderer request
      // can never show quota for the model that was just switched away from.
      const stateResponse = record(await pi.sendCommand({ type: 'get_state' }))
      const state = record(stateResponse?.data)
      const model = record(state?.model)
      const provider = typeof model?.provider === 'string' ? model.provider : null
      if (!provider) return null

      // OAuth login state is the gate. API-key-only providers never reach the
      // usage CLI, and the engine's UsageProvider performs a second credential-
      // type check before returning a report.
      const loginResponse = record(await pi.sendCommand({ type: 'get_login_providers' }))
      const loginData = record(loginResponse?.data)
      const loginProviders = Array.isArray(loginData?.providers) ? loginData.providers : []
      const oauthAuthenticated = loginProviders.some((value) => {
        const candidate = record(value)
        return candidate?.id === provider && candidate.authenticated === true
      })
      if (!oauthAuthenticated) return null

      const cwd = workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
      const result = await runPiCli(
        ['usage', '--json', '--redact', '--provider', provider],
        cwd,
        PROVIDER_QUOTA_TIMEOUT_MS,
        pi.getEngineKind()
      )
      return result.success ? parseProviderQuotaOutput(result.output, provider) : null
    } catch {
      // Quota is optional provider metadata. Unsupported older engines and
      // transient provider failures must not disturb the active session.
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_SET_LEVEL, async (_event, level: unknown) => {
    if (!isString(level)) throw new Error('level must be a string')
    return getActivePi().sendCommand({ type: 'set_thinking_level', level })
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_CYCLE_LEVEL, async () => {
    return getActivePi().sendCommand({ type: 'cycle_thinking_level' })
  })
}
