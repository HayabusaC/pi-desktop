import type { MagicContextAction, MagicContextCapabilities } from './ipc-contracts'

export function magicContextActionCommand(action: MagicContextAction): string {
  if (action.action === 'status') return '/ctx-status'
  if (action.action === 'flush') return '/ctx-flush'
  if (action.action === 'wrapup') return `/ctx-wrapup ${action.keep}`
  return `/ctx-dream${action.task ? ` ${action.task}` : ''}`
}

export function resolveCompactMode(capabilities: MagicContextCapabilities | null): 'native' | 'magic-context' {
  return capabilities?.magicContext ? 'magic-context' : 'native'
}
