import assert from 'node:assert/strict'
import test from 'node:test'
import { win32 } from 'node:path'
import { listTerminalShells, resolveTerminalShell } from './terminal-shell'

const root = 'C:\\Windows'
const known = new Set([
  win32.join(root, 'System32', 'cmd.exe'),
  win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
])
const exists = (path: string): boolean => known.has(path)

test('resolves only the allowlisted Windows terminal shells', () => {
  const env = { SystemRoot: root, PATH: '' }
  assert.equal(resolveTerminalShell('cmd', 'win32', env, exists)?.executable, win32.join(root, 'System32', 'cmd.exe'))
  assert.equal(
    resolveTerminalShell('powershell', 'win32', env, exists)?.executable,
    win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  )
  assert.equal(resolveTerminalShell('wsl', 'win32', env, exists), null)
})

test('reports unavailable Windows shells and keeps the POSIX system shell', () => {
  const windows = listTerminalShells('win32', { SystemRoot: root, PATH: '' }, exists)
  assert.deepEqual(windows, [
    { id: 'cmd', available: true },
    { id: 'powershell', available: true },
    { id: 'wsl', available: false },
  ])
  assert.deepEqual(resolveTerminalShell('system', 'linux', { SHELL: '/bin/zsh' }, exists), {
    id: 'system',
    executable: '/bin/zsh',
  })
  assert.equal(resolveTerminalShell('cmd', 'linux', { SHELL: '/bin/zsh' }, exists), null)
})
