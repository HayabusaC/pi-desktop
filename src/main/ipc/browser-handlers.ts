import { ipcMain } from 'electron'
import { IPC_CHANNELS, type BrowserViewLayout } from '../../shared/ipc-contracts'
import type { BrowserService } from '../browser-service'
import { assertTrustedSender } from './validation'
import { isObject, isString } from './validation'

function tabId(value: unknown): string {
  if (!isString(value) || !value.startsWith('browser-')) throw new Error('Invalid browser tab id')
  return value
}

function layout(value: unknown): BrowserViewLayout[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error('Invalid browser layout')
  return value.map((item) => {
    if (!isObject(item) || !isObject(item.bounds)) throw new Error('Invalid browser layout entry')
    const { x, y, width, height } = item.bounds
    if (![x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part))) {
      throw new Error('Invalid browser bounds')
    }
    return {
      id: tabId(item.id),
      visible: item.visible === true,
      bounds: { x: x as number, y: y as number, width: width as number, height: height as number },
    }
  })
}

export function registerBrowserHandlers(service: BrowserService): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event)
      return fn(...args)
    })
  }

  handle(IPC_CHANNELS.BROWSER_CREATE, (url) => {
    if (url !== undefined && !isString(url)) throw new Error('Browser URL must be a string')
    return service.create(url)
  })
  handle(IPC_CHANNELS.BROWSER_CLOSE, (id) => service.close(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_LIST, () => service.list())
  handle(IPC_CHANNELS.BROWSER_NAVIGATE, (id, url) => {
    if (!isString(url)) throw new Error('Browser URL must be a string')
    return service.navigate(tabId(id), url)
  })
  handle(IPC_CHANNELS.BROWSER_GO_BACK, (id) => service.goBack(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_GO_FORWARD, (id) => service.goForward(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_RELOAD, (id) => service.reload(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_STOP, (id) => service.stop(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_SET_LAYOUT, (value) => service.setLayout(layout(value)))
  handle(IPC_CHANNELS.BROWSER_SNAPSHOT, (id) => service.snapshot(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_SCREENSHOT, (id) => service.screenshot(tabId(id)))
  handle(IPC_CHANNELS.BROWSER_CLICK, (id, target) => {
    if (!isObject(target)) throw new Error('Invalid browser click target')
    return service.click(tabId(id), {
      selector: isString(target.selector) ? target.selector : undefined,
      x: typeof target.x === 'number' ? target.x : undefined,
      y: typeof target.y === 'number' ? target.y : undefined,
    })
  })
  handle(IPC_CHANNELS.BROWSER_TYPE, (id, target) => {
    if (!isObject(target) || !isString(target.text)) throw new Error('Invalid browser type target')
    return service.type(tabId(id), {
      selector: isString(target.selector) ? target.selector : undefined,
      text: target.text,
      submit: target.submit === true,
    })
  })
  handle(IPC_CHANNELS.BROWSER_EVALUATE, (id, expression) => {
    if (!isString(expression) || expression.length > 100_000) throw new Error('Invalid browser expression')
    return service.evaluate(tabId(id), expression)
  })
}
