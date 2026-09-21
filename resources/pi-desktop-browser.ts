import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const rpcUrl = process.env.PI_DESKTOP_BROWSER_RPC_URL
const rpcToken = process.env.PI_DESKTOP_BROWSER_RPC_TOKEN

const parameters = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['tabs', 'newTab', 'closeTab', 'navigate', 'snapshot', 'screenshot', 'click', 'type', 'evaluate'],
    },
    tabId: { type: 'string', description: 'Browser tab id returned by tabs/newTab.' },
    url: { type: 'string' },
    selector: { type: 'string', description: 'CSS selector from snapshot or supplied directly.' },
    x: { type: 'number' },
    y: { type: 'number' },
    text: { type: 'string' },
    submit: { type: 'boolean' },
    expression: { type: 'string', description: 'JavaScript evaluated in the selected visible page.' },
  },
} as const

export default function piDesktopBrowser(pi: ExtensionAPI): void {
  if (!rpcUrl || !rpcToken) return

  pi.registerTool({
    name: 'browser',
    label: 'Browser',
    description: 'Control Pi Desktop browser tabs and the same visible persistent-profile pages the user sees. Use snapshot before click/type.',
    parameters: parameters as never,
    async execute(_toolCallId: string, input: Record<string, unknown>) {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${rpcToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      })
      const payload = await response.json() as { result?: unknown; error?: string }
      if (!response.ok || payload.error) throw new Error(payload.error || `Browser RPC failed (${response.status})`)

      if (input.action === 'screenshot' && typeof payload.result === 'string' && payload.result.startsWith('data:image/png;base64,')) {
        return {
          content: [{ type: 'image', data: payload.result.slice('data:image/png;base64,'.length), mimeType: 'image/png' }],
          details: { tabId: input.tabId },
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(payload.result, null, 2) }],
        details: payload.result,
      }
    },
  } as never)
}
