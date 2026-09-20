const FENCE_START = /^ {0,3}(`{3,}|~{3,})/

function normalizeTextSegment(segment: string): string {
  return segment
    .replace(/\\\[\s*(.*?)\s*\\\]/g, (_match, expression: string) => `$$\n${expression}\n$$`)
    .replace(/\\\(\s*(.*?)\s*\\\)/g, (_match, expression: string) => `$${expression}$`)
    .replace(/\\\[/g, () => '$$')
    .replace(/\\\]/g, () => '$$')
    .replace(/\\\(/g, () => '$')
    .replace(/\\\)/g, () => '$')
}

/** Replace TeX display delimiters outside code while preserving Markdown code. */
function normalizeOutsideInlineCode(line: string): string {
  let result = ''
  let cursor = 0
  let codeDelimiterLength = 0

  while (cursor < line.length) {
    if (line[cursor] !== '`') {
      const nextTick = line.indexOf('`', cursor)
      const end = nextTick === -1 ? line.length : nextTick
      const segment = line.slice(cursor, end)
      result += codeDelimiterLength === 0 ? normalizeTextSegment(segment) : segment
      cursor = end
      continue
    }

    let end = cursor + 1
    while (line[end] === '`') end += 1
    const runLength = end - cursor
    result += line.slice(cursor, end)
    if (codeDelimiterLength === 0) codeDelimiterLength = runLength
    else if (runLength === codeDelimiterLength) codeDelimiterLength = 0
    cursor = end
  }

  return result
}

/**
 * Accept common model output using `\[ ... \]` for display math and
 * `\( ... \)` for inline math without changing prose or code examples.
 */
export function normalizeMarkdownMath(content: string): string {
  const lines = content.split('\n')
  let fence: { marker: string; length: number } | null = null

  return lines.map((line) => {
    const fenceMatch = line.match(FENCE_START)
    if (fenceMatch) {
      const run = fenceMatch[1]
      if (!fence) fence = { marker: run[0], length: run.length }
      else if (run[0] === fence.marker && run.length >= fence.length) fence = null
      return line
    }
    if (fence) return line

    return normalizeOutsideInlineCode(line)
  }).join('\n')
}
