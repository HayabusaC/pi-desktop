import assert from 'node:assert/strict'
import test from 'node:test'
import { addTab, closePane, createWorkspaceLayout, moveTab, setSplitRatio, splitPane } from './workspace-layout'

test('tabs move across panes independently of conversation identity', () => {
  let layout = createWorkspaceLayout()
  const first = layout.activePaneId
  layout = addTab(layout, 'conversation:a')
  layout = addTab(layout, 'browser:b')
  layout = splitPane(layout, first, 'horizontal')
  const second = layout.activePaneId
  layout = moveTab(layout, 'browser:b', second)
  assert.deepEqual(layout.panes[first].tabIds, ['conversation:a'])
  assert.deepEqual(layout.panes[second].tabIds, ['browser:b'])
})

test('closing a pane preserves its tabs in the sibling', () => {
  let layout = createWorkspaceLayout()
  const first = layout.activePaneId
  layout = addTab(layout, 'conversation:a')
  layout = splitPane(layout, first, 'vertical')
  const second = layout.activePaneId
  layout = addTab(layout, 'browser:b', second)
  layout = closePane(layout, second)
  assert.equal(layout.root.type, 'pane')
  assert.deepEqual(layout.panes[first].tabIds, ['conversation:a', 'browser:b'])
})

test('split ratios are clamped to usable pane sizes', () => {
  let layout = createWorkspaceLayout()
  layout = splitPane(layout, layout.activePaneId, 'horizontal')
  assert.equal(layout.root.type, 'split')
  if (layout.root.type !== 'split') return
  layout = setSplitRatio(layout, layout.root.id, 0.99)
  assert.equal(layout.root.type === 'split' && layout.root.ratio, 0.85)
})
