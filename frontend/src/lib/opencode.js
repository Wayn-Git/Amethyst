/**
 * Deprecated OpenCode API Client.
 * Retired in favor of the upcoming Coding Agents Manager (Issue #70).
 */

export function encodeDirectory() {
  return ''
}

export const opencode = {
  encodeDir: encodeDirectory,
  status: async () => ({ running: false, port: null }),
  start: async () => ({ running: false }),
  stop: async () => ({ running: false }),
  syncAmethyst: async () => ({ synced: [] }),
  listProjects: async () => [],
  listSessions: async () => [],
  listSkills: async () => [],
}

export default opencode
