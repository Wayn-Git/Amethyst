/**
 * Pure utility functions for ToolApprovalCard:
 * - Scoped security policy for "Always allow"
 * - Argument formatting for details inspection
 */

export function computeApprovalScope(toolName, args = {}) {
  const name = String(toolName || '').toLowerCase().split('__mcp__')[0].trim()

  // Terminal commands: scope to executable and sub-command (e.g. "bun test*", "pytest*", "git*")
  if (name.includes('shell') || name.includes('bash') || name.includes('term') || name.includes('command') || args.command || args.CommandLine) {
    const rawCmd = (args.command || args.CommandLine || args.cmd || '').trim()
    const parts = rawCmd.split(/\s+/).filter(Boolean)
    const subCommandTools = ['bun', 'npm', 'pnpm', 'yarn', 'cargo', 'git']
    if (parts.length >= 2 && subCommandTools.includes(parts[0])) {
      return { tool: toolName, pattern: `${parts[0]} ${parts[1]}*` }
    }
    if (parts.length >= 1) {
      return { tool: toolName, pattern: `${parts[0]}*` }
    }
    return { tool: toolName, pattern: 'command*' }
  }

  // Filesystem mutations: scope to directory prefix
  if (name.includes('write') || name.includes('edit') || name.includes('patch') || args.path || args.TargetFile) {
    const filePath = args.path || args.file_path || args.TargetFile || ''
    const parts = filePath.split('/').filter(Boolean)
    if (parts.length > 1) {
      const dirPrefix = parts.slice(0, -1).join('/')
      return { tool: toolName, pathPrefix: dirPrefix }
    }
    return { tool: toolName, pathPrefix: filePath }
  }

  // Generic tool scope
  return { tool: toolName }
}

export function formatToolArguments(toolName, rawArgs = {}) {
  let args = rawArgs
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs)
    } catch {
      args = { raw: rawArgs }
    }
  }

  const command = args.command || args.CommandLine || args.cmd || null
  const directory = args.directory || args.cwd || args.DirectoryPath || null
  const path = args.path || args.file_path || args.TargetFile || null
  const content = typeof args.content === 'string' ? args.content : typeof args.CodeContent === 'string' ? args.CodeContent : null

  return {
    command,
    directory,
    path,
    contentPreview: content ? (content.length > 200 ? content.slice(0, 200) + '...' : content) : null,
    raw: args,
  }
}
