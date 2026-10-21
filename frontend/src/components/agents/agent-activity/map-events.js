/**
 * Maps Amethyst turn events into AgentActivityItem[] for the adaptive stream
 */
function extractSubject(args) {
  if (!args || typeof args !== 'object') return '';
  const keys = ['query', 'q', 'search_query', 'pattern', 'command', 'CommandLine', 'path', 'file_path', 'AbsolutePath', 'TargetFile', 'title', 'subject', 'to', 'url'];
  for (const k of keys) {
    const val = args[k];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.trim() && v.length < 60) return `${k}: ${v.trim()}`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
  }
  return '';
}

export function mapEventsToActivityItems(events = [], live = null) {
  const items = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;

    if (ev.type === 'thought') {
      const text = (ev.text || '').trim();
      if (!text) continue;
      const firstLine = text.split('\n')[0] || 'Reasoning';
      const summary = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
      items.push({
        id: `thought-${i}`,
        type: 'trace',
        kind: 'thinking',
        label: 'Thought',
        detail: summary,
        content: text,
        status: 'complete',
      });
      continue;
    }

    const call = ev.call || ev;
    const name = String(call.name || '').split('__mcp__')[0];
    const args = typeof call.arguments === 'string'
      ? safeParse(call.arguments)
      : (call.arguments || {});

    // Web Search
    if (name === 'search_web' || name === 'fetch_url') {
      const query = args.query || args.q || 'Web search';
      const results = [];
      if (args.url) {
        try {
          const u = new URL(args.url);
          results.push({ id: `res-${i}`, title: u.hostname, domain: u.hostname, url: args.url });
        } catch {}
      }
      items.push({
        id: `search-${i}`,
        type: 'search',
        query,
        results,
        status: 'complete',
      });
      continue;
    }

    // Tools (edit, write, read, run, etc.)
    let action = 'tool';
    let target = '';
    const additions = call.additions;
    const deletions = call.deletions;

    if (name.includes('shell') || name.includes('bash') || name.includes('command') || name === 'run') {
      action = 'run';
      target = args.command || args.CommandLine || '';
    } else if (name.includes('edit') || name.includes('patch')) {
      action = 'edit';
      target = args.TargetFile || args.path || args.file_path || '';
    } else if (name.includes('write') || name.includes('create')) {
      action = 'write';
      target = args.TargetFile || args.path || args.title || '';
    } else if (name.includes('read') || name.includes('view') || name.includes('open')) {
      action = 'read';
      target = args.AbsolutePath || args.path || args.file_path || '';
    } else {
      action = name.replace(/_/g, ' ');
      target = extractSubject(args);
    }

    items.push({
      id: `tool-${i}-${name}`,
      type: 'tool',
      action,
      target: target && target.toLowerCase() !== action.toLowerCase() ? String(target).trim() : '',
      additions,
      deletions,
      status: call.status === 'error' ? 'error' : 'complete',
    });
  }

  // Live in-progress tool
  if (live && live.name) {
    const liveName = String(live.name).split('__mcp__')[0];
    const liveArgs = typeof live.arguments === 'string'
      ? safeParse(live.arguments)
      : (live.arguments || {});

    let action = 'tool';
    let target = '';

    if (liveName.includes('shell') || liveName.includes('bash')) {
      action = 'run';
      target = liveArgs.command || liveArgs.CommandLine || '';
    } else if (liveName.includes('edit')) {
      action = 'edit';
      target = liveArgs.TargetFile || liveArgs.path || '';
    } else if (liveName.includes('read')) {
      action = 'read';
      target = liveArgs.AbsolutePath || liveArgs.path || '';
    } else if (liveName.includes('search')) {
      action = 'search';
      target = liveArgs.query || liveArgs.q || '';
    } else {
      action = liveName.replace(/_/g, ' ');
      target = extractSubject(liveArgs);
    }

    items.push({
      id: 'live-activity',
      type: 'tool',
      action,
      target: target && target.toLowerCase() !== action.toLowerCase() ? String(target).trim() : '',
      status: 'active',
    });
  }

  return items;
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
