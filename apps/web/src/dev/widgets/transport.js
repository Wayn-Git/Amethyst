if (import.meta.env.DEV && location.pathname === '/dev/widgets') {
// Install before api.js evaluates its startup ping. Production removes this branch.
window.fetch = async (input, init = {}) => {
  const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname
  const body = init.body ? JSON.parse(init.body) : {}
  let value = {}
  if (path.includes('/actions/')) {
    value = { draft_id: crypto.randomUUID(), action: path.split('/').at(-1), item: body }
  } else if (path.includes('/drafts/')) {
    value = { state: body.approved ? 'applied' : 'rejected' }
  } else if (path.endsWith('/settings')) value = { enabled: true, repos: [], ...body }
  else if (path.endsWith('/rewrite')) value = { id: 1, text: 'Sample rewritten draft.', tone: body.tone, reference: 'sample' }
  else if (path.includes('/templates/')) value = { id: 1, title: 'Sample template', subject: 'Sample subject', text: 'Sample body' }
  else if (path.endsWith('/follow-up')) value = { text: 'Sample follow-up draft.' }
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
}

  const memory = new Map()
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem
  Storage.prototype.getItem = function(key) { return key.startsWith('amethyst.widgets.') ? memory.get(key) ?? null : get.call(this, key) }
  Storage.prototype.setItem = function(key, value) { if (key.startsWith('amethyst.widgets.')) memory.set(key, String(value)); else set.call(this, key, value) }
}
