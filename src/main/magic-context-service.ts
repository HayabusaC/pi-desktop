import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  MagicContextConfigFile,
  MagicContextDashboardData,
  MagicContextMemory,
  MagicContextUsageRun,
  MagicContextEmbeddingUsage,
} from '../shared/ipc-contracts'

const DEBUG = process.env.PI_DESKTOP_MAGIC_CONTEXT_DEBUG === '1'
const SECRET = /(?:api[-_]?key|authorization|token|secret|password|credential)/i
const SECRET_VALUE = /((?:api[-_]?key|authorization|token|secret|password|credential)\s*[=:]\s*)([^\s,;]+)/gi

function debug(label: string, detail: Record<string, unknown>): void {
  if (!DEBUG) return
  const safe = Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, SECRET.test(key) ? '[redacted]' : value]))
  console.debug(`[Magic Context] ${label}`, safe)
}

export function resolveMagicContextDbPath(): string | null {
  const override = process.env.MAGIC_CONTEXT_STORAGE_DIR?.trim()
  if (override) {
    if (!isAbsolute(override)) return null
    const candidate = join(override, 'context.db')
    return existsSync(candidate) ? candidate : null
  }
  const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  for (const candidate of [
    join(dataHome, 'cortexkit', 'magic-context', 'context.db'),
    join(dataHome, 'opencode', 'storage', 'plugin', 'magic-context', 'context.db'),
  ]) if (existsSync(candidate)) return candidate
  return null
}

export function resolveMagicContextConfigPaths(projectPath?: string): { user: string; project: string | null } {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return {
    user: join(configHome, 'cortexkit', 'magic-context.jsonc'),
    project: projectPath ? join(resolve(projectPath), '.cortexkit', 'magic-context.jsonc') : null,
  }
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

function columns(db: DatabaseSync, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set()
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
}

function rows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

function count(db: DatabaseSync, table: string): number {
  if (!tableExists(db, table)) return 0
  return Number((db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value?: number | bigint })?.value ?? 0)
}

function loadLogs(storageDir: string): MagicContextDashboardData['logs'] {
  const paths = [
    process.env.MAGIC_CONTEXT_LOG_PATH?.trim(),
    join(tmpdir(), 'omp', 'magic-context', 'magic-context.log'),
    join(storageDir, 'logs', 'magic-context.omp.log'),
    join(storageDir, 'logs', 'magic-context.log'),
  ].filter((value): value is string => Boolean(value))
  const lines: string[] = []
  for (const path of [...new Set(paths)]) {
    try {
      const raw = readFileSync(path, 'utf8')
      lines.push(...raw.split(/\r?\n/).filter(Boolean).slice(-250))
    } catch { /* optional log */ }
  }
  return lines.slice(-500).reverse().map((unsafeRaw) => {
    const raw = unsafeRaw.replace(SECRET_VALUE, '$1[redacted]')
    const match = raw.match(/^\[?([^\]\s]+)\]?\s+(TRACE|DEBUG|INFO|WARN|ERROR)?\s*(.*)$/i)
    return { timestamp: match?.[1] ?? '', level: match?.[2]?.toUpperCase() ?? null, message: match?.[3] ?? raw, raw }
  })
}

export function loadMagicContextDashboardData(dbPath: string): MagicContextDashboardData {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  db.exec('PRAGMA busy_timeout=5000')
  try {
    const memoryCols = columns(db, 'memories')
    const memories = tableExists(db, 'memories') ? rows<MagicContextMemory>(db, `
      SELECT id, project_path, category, content, status, source_type,
        seen_count, retrieval_count, updated_at,
        ${memoryCols.has('importance') ? 'COALESCE(importance, 50)' : '50'} AS importance
      FROM memories ORDER BY updated_at DESC LIMIT 500`) : []
    const compartmentCount = tableExists(db, 'compartments')
      ? '(SELECT COUNT(*) FROM compartments c WHERE c.session_id=sm.session_id)'
      : '0'
    const sessionCols = columns(db, 'session_meta')
    const sessionValue = (name: string, fallback: string): string => sessionCols.has(name) ? `sm.${name}` : fallback
    const sessions = tableExists(db, 'session_meta') ? rows<Record<string, unknown>>(db, `
      SELECT sm.session_id,
        ${sessionValue('title', 'NULL')} AS title,
        ${sessionValue('project_identity', 'NULL')} AS project_identity,
        ${compartmentCount} AS compartment_count,
        ${sessionValue('last_response_time', 'NULL')} AS last_response_time,
        ${sessionValue('last_context_percentage', 'NULL')} AS last_context_percentage,
        ${sessionValue('is_subagent', '0')} AS is_subagent
      FROM session_meta sm ORDER BY COALESCE(${sessionValue('last_response_time', '0')}, 0) DESC LIMIT 300`) : []
    const historian = [
      ...(tableExists(db, 'historian_runs') ? rows<Record<string, unknown>>(db,
        'SELECT * FROM historian_runs ORDER BY id DESC LIMIT 100') : []),
      ...(tableExists(db, 'subagent_invocations') ? rows<Record<string, unknown>>(db,
        "SELECT * FROM subagent_invocations WHERE subagent='historian' ORDER BY started_at DESC LIMIT 100") : []),
    ]
    const schedules = tableExists(db, 'task_schedule_state') ? rows<Record<string, unknown>>(db,
      'SELECT * FROM task_schedule_state ORDER BY project_path, task') : []
    const runs = tableExists(db, 'dream_runs') ? rows<Record<string, unknown>>(db,
      'SELECT id, project_path, started_at, finished_at, tasks_succeeded, tasks_failed, tasks_json FROM dream_runs ORDER BY finished_at DESC LIMIT 100').map((run) => ({
        ...run,
        tasks_json: typeof run.tasks_json === 'string' ? safeJson(run.tasks_json) : run.tasks_json,
      })) : []
    const cacheTable = tableExists(db, 'cache_events') ? 'cache_events'
      : tableExists(db, 'transform_decisions') ? 'transform_decisions'
        : tableExists(db, 'transform_events') ? 'transform_events' : null
    const cache = cacheTable ? rows<Record<string, unknown>>(db, `SELECT * FROM ${cacheTable} ORDER BY rowid DESC LIMIT 300`) : []
    const invocationCols = columns(db, 'subagent_invocations')
    const invocationColumn = (name: string): string => invocationCols.has(name) ? name : 'NULL'
    const usageRuns = tableExists(db, 'subagent_invocations') ? rows<Record<string, unknown>>(db, `
      SELECT id, started_at AS timestamp, subagent, ${invocationColumn('component')} AS component,
        task, provider_id, model_id,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        ${invocationColumn('reasoning_tokens')} AS reasoning_tokens,
        ${invocationColumn('total_tokens')} AS total_tokens,
        ${invocationColumn('pricing_snapshot')} AS pricing_snapshot,
        ${invocationColumn('estimated_cost')} AS estimated_cost
      FROM subagent_invocations
      WHERE subagent IN ('historian', 'historian_editor', 'dreamer')
      ORDER BY started_at DESC`).map((row): MagicContextUsageRun => ({
        id: Number(row.id), timestamp: Number(row.timestamp),
        component: row.component === 'dreamer' || row.subagent === 'dreamer' ? 'dreamer' : 'historian',
        task: typeof row.task === 'string' ? row.task : null,
        provider: typeof row.provider_id === 'string' ? row.provider_id : null,
        model: typeof row.model_id === 'string' ? row.model_id : null,
        usage: {
          input: Number(row.input_tokens ?? 0), output: Number(row.output_tokens ?? 0),
          cacheRead: Number(row.cache_read_tokens ?? 0), cacheWrite: Number(row.cache_write_tokens ?? 0),
          reasoning: row.reasoning_tokens == null ? null : Number(row.reasoning_tokens),
          total: row.total_tokens == null ? null : Number(row.total_tokens),
        },
        pricingSnapshot: typeof row.pricing_snapshot === 'string' ? safeJson(row.pricing_snapshot) : null,
        estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
      })) : []
    const embeddingUsage = tableExists(db, 'embedding_usage') ? rows<Record<string, unknown>>(db,
      'SELECT * FROM embedding_usage ORDER BY timestamp DESC').map((row): MagicContextEmbeddingUsage => ({
        id: Number(row.id), timestamp: Number(row.timestamp),
        provider: String(row.provider_id), model: String(row.model_id),
        requests: Number(row.requests ?? 1),
        inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
        dimensions: row.dimensions == null ? null : Number(row.dimensions),
        pricePerMillionInputTokens: row.price_per_million_input_tokens == null ? null : Number(row.price_per_million_input_tokens),
        estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
      })) : []
    const compartments = count(db, 'compartments')
    const data: MagicContextDashboardData = {
      loadedAt: Date.now(),
      overview: { memories: memories.length, sessions: sessions.length, compartments, dreamRuns: runs.length },
      memories,
      sessions: sessions as unknown as MagicContextDashboardData['sessions'],
      historian,
      dreamer: { enabled: schedules.length > 0, schedules, runs: runs as unknown as MagicContextDashboardData['dreamer']['runs'] },
      usage: { runs: usageRuns, embeddings: embeddingUsage },
      cache,
      logs: loadLogs(dirname(dbPath)),
    }
    debug('dashboard data loaded', { dbPath, ...data.overview })
    return data
  } finally {
    db.close()
  }
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value) } catch { return value }
}

function normalizedHash(content: string): string {
  return createHash('md5').update(content.toLowerCase().trim().replace(/\s+/g, ' ')).digest('hex')
}

export function updateMagicContextMemory(dbPath: string, id: number, content: string): void {
  if (!content.trim()) throw new Error('Memory content cannot be empty')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
  try {
    const target = db.prepare('SELECT project_path, category FROM memories WHERE id=?').get(id) as { project_path: string; category: string } | undefined
    if (!target) throw new Error('Memory no longer exists')
    const hash = normalizedHash(content)
    const collision = db.prepare('SELECT id FROM memories WHERE project_path=? AND category=? AND normalized_hash=? AND id!=? LIMIT 1')
      .get(target.project_path, target.category, hash, id) as { id: number } | undefined
    if (collision) throw new Error(`Memory content already exists as ID ${collision.id} in this category`)
    db.prepare('UPDATE memories SET content=?, normalized_hash=?, updated_at=? WHERE id=?').run(content, hash, Date.now(), id)
    if (columns(db, 'memories').has('shareable')) db.prepare('UPDATE memories SET shareable=0 WHERE id=?').run(id)
    if (tableExists(db, 'memory_embeddings')) db.prepare('DELETE FROM memory_embeddings WHERE memory_id=?').run(id)
    if (tableExists(db, 'memory_mutation_log')) db.prepare(`INSERT INTO memory_mutation_log
      (project_path, mutation_type, target_memory_id, superseded_by_id, category, new_content, queued_at)
      VALUES (?, 'update', ?, NULL, ?, ?, ?)`).run(target.project_path, id, target.category, content, Date.now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error } finally { db.close() }
}

export function deleteMagicContextMemory(dbPath: string, id: number): void {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
  try {
    const target = db.prepare('SELECT project_path, category FROM memories WHERE id=?').get(id) as { project_path: string; category: string } | undefined
    if (!target) throw new Error('Memory no longer exists')
    if (tableExists(db, 'memory_mutation_log')) db.prepare(`INSERT INTO memory_mutation_log
      (project_path, mutation_type, target_memory_id, superseded_by_id, category, new_content, queued_at)
      VALUES (?, 'delete', ?, NULL, ?, NULL, ?)`).run(target.project_path, id, target.category, Date.now())
    if (tableExists(db, 'memory_embeddings')) db.prepare('DELETE FROM memory_embeddings WHERE memory_id=?').run(id)
    db.prepare('DELETE FROM memories WHERE id=?').run(id)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error } finally { db.close() }
}

export async function readMagicContextConfig(source: 'user' | 'project', projectPath?: string): Promise<MagicContextConfigFile> {
  const paths = resolveMagicContextConfigPaths(projectPath)
  const path = source === 'user' ? paths.user : paths.project
  if (!path) return { source, path: '', exists: false, content: null, error: 'No active project' }
  try { return { source, path, exists: true, content: await readFile(path, 'utf8') } }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { source, path, exists: false, content: null }
    return { source, path, exists: true, content: null, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function writeMagicContextConfig(source: 'user' | 'project', content: string, projectPath?: string): Promise<void> {
  const paths = resolveMagicContextConfigPaths(projectPath)
  const path = source === 'user' ? paths.user : paths.project
  if (!path) throw new Error('No active project')
  if (source === 'project' && resolve(path) !== join(resolve(projectPath!), '.cortexkit', 'magic-context.jsonc')) throw new Error('Invalid project config path')
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.pi-desktop-${process.pid}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  debug('config saved', { source, path, bytes: Buffer.byteLength(content) })
}
