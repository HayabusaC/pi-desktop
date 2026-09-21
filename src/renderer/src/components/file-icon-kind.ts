export type FileIconKind =
  | 'archive'
  | 'code'
  | 'config'
  | 'database'
  | 'document'
  | 'git'
  | 'html'
  | 'image'
  | 'info'
  | 'json'
  | 'lock'
  | 'pdf'
  | 'shell'
  | 'stylesheet'
  | 'text'
  | 'typescript'
  | 'javascript'
  | 'yaml'
  | 'file'

const EXTENSION_KIND: Record<string, FileIconKind> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  c: 'code', cc: 'code', cpp: 'code', cxx: 'code', h: 'code', hh: 'code', hpp: 'code',
  cs: 'code', java: 'code', go: 'code', rs: 'code', py: 'code', rb: 'code', php: 'code', swift: 'code', kt: 'code',
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'config', ini: 'config', cfg: 'config', conf: 'config', env: 'config',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'stylesheet', scss: 'stylesheet', sass: 'stylesheet', less: 'stylesheet',
  md: 'document', mdx: 'document', tex: 'document', rst: 'document',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image', bmp: 'image',
  zip: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive', rar: 'archive', '7z': 'archive',
  sql: 'database', db: 'database', sqlite: 'database', sqlite3: 'database',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell',
  lock: 'lock',
  txt: 'text', log: 'text', out: 'text', toc: 'text', aux: 'text',
}

export function fileIconKind(name: string): FileIconKind {
  const lower = name.toLowerCase()
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') return 'git'
  if (lower.startsWith('readme')) return 'info'
  if (lower.endsWith('.lock') || lower === 'package-lock.json' || lower === 'pnpm-lock.yaml') return 'lock'
  if (lower === 'dockerfile' || lower === 'makefile' || lower === 'cmakelists.txt') return 'config'
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? EXTENSION_KIND[lower.slice(dot + 1)] ?? 'file' : 'file'
}
