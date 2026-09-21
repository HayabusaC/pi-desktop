/**
 * Read OMP's local-command completion marker without treating a missing or
 * malformed field as false. OMP currently returns it in response.data for
 * consumed builtins and at the top level of prompt_result events.
 */
export function getAgentInvoked(value: unknown): boolean | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.agentInvoked === 'boolean') return record.agentInvoked
  if (record.data && typeof record.data === 'object') {
    const nested = (record.data as Record<string, unknown>).agentInvoked
    if (typeof nested === 'boolean') return nested
  }
  return undefined
}

/** OMP 18 uses top-level text; accept nested data.text for compatibility. */
export function getCommandOutputText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (record.data && typeof record.data === 'object') {
    const nested = (record.data as Record<string, unknown>).text
    if (typeof nested === 'string') return nested
  }
  return undefined
}

export function shouldFinishWithoutAgent(value: unknown): boolean {
  return getAgentInvoked(value) === false
}
