import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  deleteMagicContextMemory,
  loadMagicContextDashboardData,
  resolveMagicContextDbPath,
  updateMagicContextMemory,
  writeMagicContextConfig,
} from './magic-context-service'

function fixture(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-desktop-magic-context-'))
  const dbPath = join(root, 'context.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, project_path TEXT, category TEXT, content TEXT,
      normalized_hash TEXT, status TEXT, source_type TEXT, seen_count INTEGER, retrieval_count INTEGER,
      updated_at INTEGER, importance INTEGER, shareable INTEGER, UNIQUE(project_path, category, normalized_hash));
    CREATE TABLE memory_embeddings (memory_id INTEGER);
    CREATE TABLE memory_mutation_log (id INTEGER PRIMARY KEY, project_path TEXT, mutation_type TEXT,
      target_memory_id INTEGER, superseded_by_id INTEGER, category TEXT, new_content TEXT, queued_at INTEGER);
    CREATE TABLE session_meta (session_id TEXT PRIMARY KEY, last_response_time INTEGER,
      last_context_percentage REAL, is_subagent INTEGER);
    CREATE TABLE compartments (id INTEGER PRIMARY KEY, session_id TEXT);
    CREATE TABLE historian_runs (id INTEGER PRIMARY KEY, status TEXT, created_at INTEGER);
    CREATE TABLE task_schedule_state (project_path TEXT, task TEXT, next_due_at INTEGER);
    CREATE TABLE dream_runs (id INTEGER PRIMARY KEY, project_path TEXT, started_at INTEGER,
      finished_at INTEGER, tasks_succeeded INTEGER, tasks_failed INTEGER, tasks_json TEXT);
    CREATE TABLE transform_decisions (id INTEGER PRIMARY KEY, session_id TEXT, reason TEXT);
    INSERT INTO memories VALUES (1, 'git:test', 'CONSTRAINTS', 'Keep tests green', 'old', 'active', 'historian', 2, 1, 10, 80, 1);
    INSERT INTO session_meta VALUES ('session-1', 20, 42.5, 0);
    INSERT INTO compartments VALUES (1, 'session-1');
    INSERT INTO historian_runs VALUES (1, 'completed', 30);
    INSERT INTO task_schedule_state VALUES ('git:test', 'verify', 40);
    INSERT INTO dream_runs VALUES (1, 'git:test', 20, 30, 1, 0, '[]');
    INSERT INTO transform_decisions VALUES (1, 'session-1', 'cache_stable');
  `)
  db.close()
  return { root, dbPath }
}

test('discovers explicit storage and reads dashboard data without migrating', () => {
  const { root, dbPath } = fixture()
  const previous = process.env.MAGIC_CONTEXT_STORAGE_DIR
  process.env.MAGIC_CONTEXT_STORAGE_DIR = root
  try {
    assert.equal(resolveMagicContextDbPath(), dbPath)
    const data = loadMagicContextDashboardData(dbPath)
    assert.equal(data.overview.memories, 1)
    assert.equal(data.overview.sessions, 1)
    assert.equal(data.overview.compartments, 1)
    assert.equal(data.overview.dreamRuns, 1)
    assert.equal(data.historian.length, 1)
    assert.equal(data.dreamer.enabled, true)
    assert.equal(data.cache.length, 1)
  } finally {
    if (previous === undefined) delete process.env.MAGIC_CONTEXT_STORAGE_DIR
    else process.env.MAGIC_CONTEXT_STORAGE_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('edits and deletes memories with official mutation-log semantics', () => {
  const { root, dbPath } = fixture()
  try {
    updateMagicContextMemory(dbPath, 1, 'Keep every test green')
    let db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare('SELECT content, shareable FROM memories WHERE id=1').get() as { content: string; shareable: number }
    assert.equal(row.content, 'Keep every test green')
    assert.equal(row.shareable, 0)
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM memory_mutation_log WHERE mutation_type='update'").get() as { n: number }).n, 1)
    db.close()
    deleteMagicContextMemory(dbPath, 1)
    db = new DatabaseSync(dbPath, { readOnly: true })
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n, 0)
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM memory_mutation_log WHERE mutation_type='delete'").get() as { n: number }).n, 1)
    db.close()
  } finally {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
    catch { /* Windows can retain a transient SQLite handle until process exit. */ }
  }
})

test('writes project config only at the canonical CortexKit path', async () => {
  const { root } = fixture()
  try {
    await writeMagicContextConfig('project', '{\n  "memory": { "enabled": true }\n}\n', root)
    assert.match(readFileSync(join(root, '.cortexkit', 'magic-context.jsonc'), 'utf8'), /"enabled": true/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
