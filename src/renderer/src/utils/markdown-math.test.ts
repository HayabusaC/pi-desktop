import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeMarkdownMath } from './markdown-math'

test('normalizes TeX display brackets', () => {
  assert.equal(normalizeMarkdownMath('\\[ e^{i\\pi}+1=0 \\]'), '$$\ne^{i\\pi}+1=0\n$$')
  assert.equal(normalizeMarkdownMath('\\[\ne^{i\\pi}+1=0\n\\]'), '$$\ne^{i\\pi}+1=0\n$$')
})

test('normalizes TeX inline parentheses', () => {
  assert.equal(
    normalizeMarkdownMath('Euler wrote \\( e^{i\\pi}+1=0 \\).'),
    'Euler wrote $e^{i\\pi}+1=0$.'
  )
})

test('does not reinterpret bare delimiters or code as math', () => {
  assert.equal(normalizeMarkdownMath('[ ordinary note ]'), '[ ordinary note ]')
  assert.equal(normalizeMarkdownMath('[ e^{i\\pi}+1=0 ]'), '[ e^{i\\pi}+1=0 ]')
  assert.equal(normalizeMarkdownMath('( e^{i\\pi}+1=0 )'), '( e^{i\\pi}+1=0 )')
  assert.equal(normalizeMarkdownMath('`\\[x^2\\]`'), '`\\[x^2\\]`')
  assert.equal(normalizeMarkdownMath('`\\(x^2\\)`'), '`\\(x^2\\)`')
  assert.equal(
    normalizeMarkdownMath('```md\n\\[x^2\\]\n[ y^2 ]\n```'),
    '```md\n\\[x^2\\]\n[ y^2 ]\n```'
  )
})
