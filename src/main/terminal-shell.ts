import { existsSync } from 'fs'
import { posix, win32 } from 'path'
import type { TerminalShellId, TerminalShellOption } from '../shared/ipc-contracts'

interface TerminalShellResolution {
  id: TerminalShellId
  executable: string
}

type Exists = (path: string) => boolean

function executableOnPath(
  name: string,
  pathValue: string | undefined,
  platform: string,
  exists: Exists
): string | null {
  const paths = platform === 'win32' ? win32 : posix
  if (paths.isAbsolute(name)) return exists(name) ? name : null
  for (const directory of (pathValue ?? '').split(paths.delimiter).filter(Boolean)) {
    const candidate = paths.join(directory, name)
    if (exists(candidate)) return candidate
  }
  return null
}

function firstExecutable(
  candidates: Array<string | undefined>,
  pathValue: string | undefined,
  platform: string,
  exists: Exists
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = executableOnPath(candidate, pathValue, platform, exists)
    if (resolved) return resolved
  }
  return null
}

export function resolveTerminalShell(
  id: TerminalShellId | undefined,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync
): TerminalShellResolution | null {
  if (platform !== 'win32') {
    if (id && id !== 'system') return null
    return { id: 'system', executable: env.SHELL || '/bin/bash' }
  }

  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows'
  const pathValue = env.PATH
  const requested = id === 'system' || id === undefined ? 'cmd' : id
  const candidates: Record<'cmd' | 'powershell' | 'wsl', Array<string | undefined>> = {
    cmd: [env.COMSPEC, win32.join(systemRoot, 'System32', 'cmd.exe'), 'cmd.exe'],
    powershell: [
      'pwsh.exe',
      win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      'powershell.exe',
    ],
    wsl: [win32.join(systemRoot, 'System32', 'wsl.exe'), 'wsl.exe'],
  }
  const executable = firstExecutable(candidates[requested], pathValue, platform, exists)
  return executable ? { id: requested, executable } : null
}

export function listTerminalShells(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync
): TerminalShellOption[] {
  if (platform !== 'win32') return [{ id: 'system', available: true }]
  return (['cmd', 'powershell', 'wsl'] as const).map((id) => ({
    id,
    available: resolveTerminalShell(id, platform, env, exists) !== null,
  }))
}
