import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyMcpActionResult, listMcpServers } from './skills-mcp-handlers'

test('discovers empty, global, project, and duplicate-scope OMP MCP configs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-desktop-mcp-'))
  const agent = join(root, 'agent')
  const project = join(root, 'project')
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agent
  try {
    assert.deepEqual(await listMcpServers(project), [])
    await mkdir(agent, { recursive: true })
    await mkdir(join(project, '.omp'), { recursive: true })
    await writeFile(join(agent, 'mcp.json'), JSON.stringify({
      mcpServers: {
        shared: {
          command: 'global-command',
          args: ['--token=inline-secret', '--api-key', 'separate-secret'],
          env: { API_KEY: 'secret' },
        },
      },
    }))
    let rows = await listMcpServers(project)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.scope, 'global')
    assert.deepEqual(rows[0]?.config.env, { API_KEY: '[redacted]' })
    assert.deepEqual(rows[0]?.config.args, ['--token=[redacted]', '--api-key', '[redacted]'])

    await writeFile(join(project, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        shared: { type: 'http', url: 'https://user:pass@example.test/mcp?token=secret' },
        projectOnly: { command: 'project-command', enabled: false },
      },
    }))
    rows = await listMcpServers(project, {
      sendCommand: async () => ({ success: true, data: { dumpTools: [{ name: 'mcp__shared_tool' }] } }),
    })
    assert.equal(rows.length, 3)
    assert.equal(rows.filter((row) => row.name === 'shared').length, 2)
    assert.equal(rows.find((row) => row.name === 'projectOnly')?.enabled, false)
    assert.equal(rows.find((row) => row.scope === 'project' && row.name === 'shared')?.url, 'https://example.test/mcp')
    assert.equal(rows.find((row) => row.name === 'shared')?.runtimeStatus, 'connected')
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('maps MCP connection failures to error status', () => {
  assert.deepEqual(classifyMcpActionResult(true, 'Server connected (3 tools).'), { status: 'connected' })
  assert.deepEqual(classifyMcpActionResult(true, 'Connection failed: refused'), {
    status: 'error',
    error: 'Connection failed: refused',
  })
})
