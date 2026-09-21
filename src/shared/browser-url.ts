const DEFAULT_BROWSER_URL = 'about:blank'

/** Normalize address-bar input without admitting privileged local schemes. */
export function normalizeBrowserUrl(input?: string): string {
  const value = input?.trim() || DEFAULT_BROWSER_URL
  if (value === DEFAULT_BROWSER_URL) return value
  if (/^(?:file|javascript|data|chrome|devtools|ftp):/i.test(value)) {
    throw new Error('Browser tabs only support http://, https://, and about:blank URLs')
  }
  const withScheme = /^https?:\/\//i.test(value)
    ? value
    : /^(?:localhost|127(?:\.\d{1,3}){3})(?::|\/|$)/i.test(value)
      ? `http://${value}`
      : `https://${value}`
  const parsed = new URL(withScheme)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Browser tabs only support http://, https://, and about:blank URLs')
  }
  return parsed.toString()
}

/** Whether an already-qualified navigation target may load in a browser view. */
export function isAllowedBrowserNavigation(url: string): boolean {
  if (url === DEFAULT_BROWSER_URL) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
