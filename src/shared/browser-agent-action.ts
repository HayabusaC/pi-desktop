import type { BrowserAgentAction } from './ipc-contracts'

const MAX_URL_LENGTH = 8_192
const MAX_SELECTOR_LENGTH = 16_384
const MAX_TEXT_LENGTH = 100_000

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const string = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

const tabId = (value: unknown): value is string =>
  string(value, 128) && value.startsWith('browser-')

/** Validate the authenticated loopback payload before it reaches Electron. */
export function isBrowserAgentAction(value: unknown): value is BrowserAgentAction {
  if (!object(value) || typeof value.action !== 'string') return false
  switch (value.action) {
    case 'tabs':
      return true
    case 'newTab':
      return value.url === undefined || string(value.url, MAX_URL_LENGTH)
    case 'closeTab':
    case 'snapshot':
    case 'screenshot':
      return tabId(value.tabId)
    case 'navigate':
      return tabId(value.tabId) && string(value.url, MAX_URL_LENGTH)
    case 'click':
      return tabId(value.tabId)
        && (value.selector === undefined || string(value.selector, MAX_SELECTOR_LENGTH))
        && (value.x === undefined || (typeof value.x === 'number' && Number.isFinite(value.x)))
        && (value.y === undefined || (typeof value.y === 'number' && Number.isFinite(value.y)))
        && (typeof value.selector === 'string' || (typeof value.x === 'number' && typeof value.y === 'number'))
    case 'type':
      return tabId(value.tabId)
        && string(value.text, MAX_TEXT_LENGTH)
        && (value.selector === undefined || string(value.selector, MAX_SELECTOR_LENGTH))
        && (value.submit === undefined || typeof value.submit === 'boolean')
    case 'evaluate':
      return tabId(value.tabId) && string(value.expression, MAX_TEXT_LENGTH)
    default:
      return false
  }
}
