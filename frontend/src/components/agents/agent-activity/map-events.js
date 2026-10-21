/**
 * Maps Amethyst turn events into AgentActivityItem[] for the adaptive stream
 */
export function mapEventsToActivityItems(events = [], live = null) {
  const items = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;

    if (ev.type === 'thought') {
      items.push({
        id: `thought-${i}`,
        type: 'step',
        label: ev.text || 'Thinking',
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

    // Tools (edit, write, read, run)
    let action = 'tool';
    let target = '';
    let additions = call.additions;
    let deletions = call.deletions;

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
      target = args.query || args.pattern || args.title || '';
    }

    items.push({
      id: `tool-${i}-${name}`,
      type: 'tool',
      action,
      target: target ? String(target).trim() : name,
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
      target = liveArgs.title || liveArgs.name || '';
    }

    items.push({
      id: 'live-activity',
      type: 'tool',
      action,
      target: target ? String(target).trim() : liveName,
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
