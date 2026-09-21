import assert from 'node:assert/strict'
import test from 'node:test'
import { fileIconKind } from './file-icon-kind'

test('classifies common project files for the explorer icon set', () => {
  assert.equal(fileIconKind('.gitignore'), 'git')
  assert.equal(fileIconKind('README.md'), 'info')
  assert.equal(fileIconKind('CMakeLists.txt'), 'config')
  assert.equal(fileIconKind('main.cc'), 'code')
  assert.equal(fileIconKind('component.tsx'), 'typescript')
  assert.equal(fileIconKind('package-lock.json'), 'lock')
  assert.equal(fileIconKind('report.pdf'), 'pdf')
  assert.equal(fileIconKind('run_all.sh'), 'shell')
  assert.equal(fileIconKind('unknown.binary'), 'file')
})
