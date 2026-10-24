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
  const { default: ConnectedItems } = await server.ssrLoadModule('/src/dashboard/widgets/ConnectedItems.jsx')
  const connected = data => renderToStaticMarkup(React.createElement(ConnectedItems, { data }))
  assert.match(connected({ items: [], unavailable: ['Slack'] }), /Unavailable: Slack/)
  const mentions = connected({ limited: true, items: [{ id: '1', source: 'GitHub', title: 'Mention fixture', url: 'javascript:alert(1)' }] })
  assert.match(mentions, /Mention fixture/)
  assert.match(mentions, /Results limited/)
  assert.doesNotMatch(mentions, /href=/)
  assert.match(connected({ items: [{ id: '1', title: 'Thread fixture', source: 'Slack', url: 'https://example.com/thread' }] }), /rel="noreferrer"/)
  assert.match(connected({ items: [{ id: 'pr', title: 'PR fixture', source: 'GitHub', status: 'Awaiting your review · Your open PR' }] }), /Awaiting your review · Your open PR/)
  assert.match(connected({ items: [{ id: 'issue', title: 'Issue fixture', source: 'GitHub', status: 'Assigned to you' }] }), /Assigned to you/)
  console.log('PASS connected widgets: next-event, mentions, PR labels, partial sources, limits, safe links')
} finally { await server.close() }
