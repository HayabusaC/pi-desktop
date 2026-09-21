import type { MagicContextCapabilities } from './ipc-contracts'

export function buildMagicContextCapabilities(
  commands: ReadonlySet<string>,
  dbPath: string | null,
  configPaths: MagicContextCapabilities['configPaths']
): MagicContextCapabilities {
  const magicContext = commands.has('ctx-status')
  const activeDbPath = magicContext ? dbPath : null
  return {
    magicContext,
    ctxWrapup: magicContext && commands.has('ctx-wrapup'),
    ctxFlush: magicContext && commands.has('ctx-flush'),
    ctxDreamer: magicContext && commands.has('ctx-dream'),
    ctxMemory: magicContext && Boolean(activeDbPath),
    ctxHistorian: magicContext && (commands.has('ctx-wrapup') || commands.has('ctx-recomp')),
    ctxDashboardData: magicContext && Boolean(activeDbPath),
    dbPath: activeDbPath,
    configPaths,
  }
}
