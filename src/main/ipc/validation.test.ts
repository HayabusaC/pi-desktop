import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { RENDERER_INDEX_PATH } from '../renderer-origin'
import { assertTrustedSender } from './validation'

const rendererUrl = pathToFileURL(RENDERER_INDEX_PATH).href

function eventWith(
  frameUrl: string | undefined,
  webContentsUrl: string,
  frameKind: 'main' | 'child' = 'main',
): IpcMainInvokeEvent {
  const frame = frameUrl === undefined ? null : { url: frameUrl }
  if (frame) Object.assign(frame, { parent: frameKind === 'main' ? null : { url: rendererUrl } })
  return {
    senderFrame: frame,
    sender: { getURL: () => webContentsUrl },
  } as unknown as IpcMainInvokeEvent
}

test('accepts the owning renderer URL when Electron omits senderFrame', () => {
  assert.doesNotThrow(() => {
    assertTrustedSender(eventWith(undefined, rendererUrl))
  })
})

test('does not let an untrusted child frame inherit its owner URL', () => {
  assert.throws(
    () => assertTrustedSender(eventWith('file:///tmp/untrusted.html', rendererUrl, 'child')),
    /Unauthorized IPC sender/,
  )
})

test('accepts an empty main-frame URL using its committed WebContents URL', () => {
  assert.doesNotThrow(() => {
    assertTrustedSender(eventWith('', rendererUrl))
  })
})

test('rejects a missing frame whose owning WebContents is also untrusted', () => {
  assert.throws(
    () => assertTrustedSender(eventWith(undefined, 'file:///tmp/untrusted.html')),
    /Unauthorized IPC sender/,
  )
})
