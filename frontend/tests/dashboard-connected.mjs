// Isolated component fixtures; no connected accounts or screenshots.
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { default: NextEvent } = await server.ssrLoadModule('/src/dashboard/widgets/NextEvent.jsx')
  const render = data => renderToStaticMarkup(React.createElement(NextEvent, { data }))
  assert.equal(render({ items: [] }), '')
  const html = render({ timezone: 'UTC', items: [{ title: 'Calendar fixture', start: new Date(Date.now() + 30 * 60000).toISOString() }] })
  assert.match(html, /Calendar fixture/)
  assert.match(html, /In 30 minutes/)
  assert.match(html, /current week/)
  console.log('PASS connected widgets: next-event empty, title, countdown, calendar scope')
} finally { await server.close() }
