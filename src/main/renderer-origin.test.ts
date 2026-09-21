import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTrustedRendererUrl } from './renderer-origin'

const INDEX = join(process.cwd(), 'out/renderer/index.html')
const INDEX_URL = pathToFileURL(INDEX).href

test('dev: accepts the dev server origin (any path/hash)', () => {
  const opts = { devServerUrl: 'http://localhost:5173', rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', opts), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/#/chat', opts), true)
})

test('dev: rejects a look-alike host that only shares a prefix', () => {
  const opts = { devServerUrl: 'http://localhost:5173', rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl('http://localhost:5173.evil.com/', opts), false)
  assert.equal(isTrustedRendererUrl('http://evil.com/localhost:5173', opts), false)
})

test('prod: accepts the packaged index file, ignoring hash routing', () => {
  const opts = { rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl(INDEX_URL, opts), true)
  assert.equal(isTrustedRendererUrl(`${INDEX_URL}#/settings`, opts), true)
})

test('prod: rejects any other local file', () => {
  const opts = { rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl(pathToFileURL(join(process.cwd(), 'out/renderer/evil.html')).href, opts), false)
  assert.equal(isTrustedRendererUrl(pathToFileURL(join(process.cwd(), 'other.html')).href, opts), false)
})

test('rejects unparseable input', () => {
  assert.equal(isTrustedRendererUrl('not a url', { rendererIndexPath: INDEX }), false)
})
