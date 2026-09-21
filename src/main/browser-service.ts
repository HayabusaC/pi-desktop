import { randomUUID } from 'crypto'
import { BrowserWindow, WebContentsView } from 'electron'
import type {
  BrowserAgentAction,
  BrowserSnapshot,
  BrowserTabState,
  BrowserViewLayout,
} from '../shared/ipc-contracts'
import { isAllowedBrowserNavigation, normalizeBrowserUrl } from '../shared/browser-url'

const BROWSER_PARTITION = 'persist:pi-desktop-browser'
const DEFAULT_URL = 'about:blank'

interface BrowserEntry {
  id: string
  view: WebContentsView
  crashed: boolean
}

function stateOf(entry: BrowserEntry): BrowserTabState {
  const wc = entry.view.webContents
  return {
    id: entry.id,
    title: wc.getTitle() || wc.getURL() || 'New Tab',
    url: wc.getURL() || DEFAULT_URL,
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    crashed: entry.crashed || undefined,
  }
}

/**
 * Owns every real browser surface. Renderer state contains only tab/layout
 * metadata; page content stays in sandboxed WebContentsViews in main.
 */
export class BrowserService {
  private readonly entries = new Map<string, BrowserEntry>()

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly broadcast: (state: BrowserTabState) => void,
  ) {}

  create(url?: string): BrowserTabState {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) throw new Error('Main window is not available')

    const id = `browser-${randomUUID()}`
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })
    const entry: BrowserEntry = { id, view, crashed: false }
    this.entries.set(id, entry)
    window.contentView.addChildView(view)
    view.setVisible(false)

    const emit = (): void => this.emit(entry)
    view.webContents.on('did-start-loading', emit)
    view.webContents.on('did-stop-loading', emit)
    view.webContents.on('did-navigate', emit)
    view.webContents.on('did-navigate-in-page', emit)
    view.webContents.on('page-title-updated', emit)
    view.webContents.on('will-navigate', (event, target) => {
      if (!isAllowedBrowserNavigation(target)) event.preventDefault()
    })
    view.webContents.on('render-process-gone', () => {
      entry.crashed = true
      emit()
    })
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      try {
        this.create(target)
      } catch {
        // Invalid popup URLs stay denied.
      }
      return { action: 'deny' }
    })

    void view.webContents.loadURL(normalizeBrowserUrl(url)).catch(() => emit())
    return stateOf(entry)
  }

  list(): BrowserTabState[] {
    return [...this.entries.values()].map(stateOf)
  }

  close(id: string): void {
    const entry = this.require(id)
    const closingState = { ...stateOf(entry), closed: true }
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.contentView.removeChildView(entry.view)
    this.entries.delete(id)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    this.broadcast(closingState)
  }

  async navigate(id: string, url: string): Promise<BrowserTabState> {
    const entry = this.require(id)
    entry.crashed = false
    await entry.view.webContents.loadURL(normalizeBrowserUrl(url))
    return stateOf(entry)
  }

  goBack(id: string): BrowserTabState {
    const entry = this.require(id)
    if (entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack()
    }
    return stateOf(entry)
  }

  goForward(id: string): BrowserTabState {
    const entry = this.require(id)
    if (entry.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward()
    }
    return stateOf(entry)
  }

  reload(id: string): void {
    this.require(id).view.webContents.reload()
  }

  stop(id: string): void {
    this.require(id).view.webContents.stop()
  }

  setLayout(layouts: BrowserViewLayout[]): void {
    const requested = new Map(layouts.map((layout) => [layout.id, layout]))
    for (const entry of this.entries.values()) {
      const layout = requested.get(entry.id)
      const visible = Boolean(layout?.visible && layout.bounds.width > 0 && layout.bounds.height > 0)
      if (visible && layout) {
        entry.view.setBounds({
          x: Math.max(0, Math.round(layout.bounds.x)),
          y: Math.max(0, Math.round(layout.bounds.y)),
          width: Math.max(1, Math.round(layout.bounds.width)),
          height: Math.max(1, Math.round(layout.bounds.height)),
        })
      }
      entry.view.setVisible(visible)
    }
  }

  async snapshot(id: string): Promise<BrowserSnapshot> {
    const entry = this.require(id)
    const result = await entry.view.webContents.executeJavaScript(`(() => {
      const esc = (value) => CSS.escape(String(value));
      const selector = (el) => {
        if (el.id) return '#' + esc(el.id);
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 5) {
          let part = node.localName;
          if (!part) break;
          const parent = node.parentElement;
          if (parent) {
            const siblings = [...parent.children].filter((child) => child.localName === node.localName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(part);
          node = parent;
        }
        return parts.join(' > ');
      };
      const candidates = [...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        })
        .slice(0, 500)
        .map((el, index) => ({
          index,
          tag: el.localName,
          role: el.getAttribute('role'),
          name: (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim().slice(0, 300),
          selector: selector(el),
        }));
      return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 100000), elements: candidates };
    })()`, true) as BrowserSnapshot
    return result
  }

  async screenshot(id: string): Promise<string> {
    const image = await this.require(id).view.webContents.capturePage()
    return image.toDataURL()
  }

  async evaluate(id: string, expression: string): Promise<unknown> {
    const wc = this.require(id).view.webContents
    return this.withDebugger(wc, async () => {
      const response = await wc.debugger.sendCommand('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }) as { result?: { value?: unknown; description?: string }; exceptionDetails?: unknown }
      if (response.exceptionDetails) throw new Error(response.result?.description || 'Browser evaluation failed')
      return response.result?.value
    })
  }

  async click(id: string, target: { selector?: string; x?: number; y?: number }): Promise<void> {
    const wc = this.require(id).view.webContents
    let x = target.x
    let y = target.y
    if (target.selector) {
      const point = await wc.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`, true) as { x: number; y: number } | null
      if (!point) throw new Error(`No element matches selector: ${target.selector}`)
      x = point.x
      y = point.y
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('click requires selector or finite x/y coordinates')
    await this.withDebugger(wc, async () => {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    })
  }

  async type(id: string, target: { selector?: string; text: string; submit?: boolean }): Promise<void> {
    const wc = this.require(id).view.webContents
    if (target.selector) {
      const focused = await wc.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)});
        if (!el) return false;
        el.focus();
        if ('value' in el) el.value = '';
        return true;
      })()`, true)
      if (!focused) throw new Error(`No element matches selector: ${target.selector}`)
    }
    await this.withDebugger(wc, async () => {
      await wc.debugger.sendCommand('Input.insertText', { text: target.text })
      if (target.submit) {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      }
    })
  }

  async dispatchAgentAction(request: BrowserAgentAction): Promise<unknown> {
    switch (request.action) {
      case 'tabs': return this.list()
      case 'newTab': return this.create(request.url)
      case 'closeTab': this.close(request.tabId); return { ok: true }
      case 'navigate': return this.navigate(request.tabId, request.url)
      case 'snapshot': return this.snapshot(request.tabId)
      case 'screenshot': return this.screenshot(request.tabId)
      case 'click': await this.click(request.tabId, request); return { ok: true }
      case 'type': await this.type(request.tabId, request); return { ok: true }
      case 'evaluate': return this.evaluate(request.tabId, request.expression)
    }
  }

  destroy(): void {
    for (const id of [...this.entries.keys()]) this.close(id)
  }

  private require(id: string): BrowserEntry {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown browser tab: ${id}`)
    return entry
  }

  private emit(entry: BrowserEntry): void {
    if (!entry.view.webContents.isDestroyed()) this.broadcast(stateOf(entry))
  }

  private async withDebugger<T>(wc: Electron.WebContents, action: () => Promise<T>): Promise<T> {
    const attachedHere = !wc.debugger.isAttached()
    if (attachedHere) wc.debugger.attach('1.3')
    try {
      return await action()
    } finally {
      if (attachedHere && wc.debugger.isAttached()) wc.debugger.detach()
    }
  }
}
