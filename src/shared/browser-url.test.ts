import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedBrowserNavigation, normalizeBrowserUrl } from './browser-url'

test('normalizes hostnames and localhost addresses', () => {
  assert.equal(normalizeBrowserUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeBrowserUrl('localhost:3000/path'), 'http://localhost:3000/path')
})

test('keeps http navigation and the blank page', () => {
  assert.equal(normalizeBrowserUrl('http://localhost:4173'), 'http://localhost:4173/')
  assert.equal(normalizeBrowserUrl(), 'about:blank')
})

test('rejects privileged and executable schemes', () => {
  assert.throws(() => normalizeBrowserUrl('file:///etc/passwd'))
  assert.throws(() => normalizeBrowserUrl('javascript:alert(1)'))
})

test('applies the same scheme policy to page-initiated navigations', () => {
  assert.equal(isAllowedBrowserNavigation('https://example.com/path'), true)
  assert.equal(isAllowedBrowserNavigation('http://localhost:3000/'), true)
  assert.equal(isAllowedBrowserNavigation('about:blank'), true)
  assert.equal(isAllowedBrowserNavigation('file:///etc/passwd'), false)
  assert.equal(isAllowedBrowserNavigation('javascript:alert(1)'), false)
  assert.equal(isAllowedBrowserNavigation('not a url'), false)
})
