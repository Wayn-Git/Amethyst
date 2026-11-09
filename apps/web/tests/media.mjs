/* What a media item is allowed to become on screen.
 *
 * The security-relevant half of the widget system: `normalise` decides what
 * goes in an `<iframe src>`, an `<img src>` and a `<video src>`, and the
 * payload it works from arrives through the message transcript. So the
 * interesting cases here are the hostile ones -- a lookalike host, a
 * `javascript:` thumbnail, an `embed_url` that does not match the link it
 * claims to be for.
 *
 *     npm run test:media
 */

import { strict as assert } from 'node:assert'
import {
  embedUrl, isPlayable, isSafe, normalise, normaliseAll, youtubeId,
} from '../src/components/widgets/media.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push({ name, message: err.message })
  }
}

const ID = 'dQw4w9WgXcQ'

/* ------------------------------------------------------- youtube detection */

test('every ordinary YouTube URL form yields its id', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/watch?v=${ID}&list=PLabc&t=9`,
    `http://www.youtube.com/watch?v=${ID}`,
  ]) {
    assert.equal(youtubeId(url), ID, url)
  }
})

test('a lookalike host is not YouTube', () => {
  // The whole reason this parses the URL instead of matching a substring.
  for (const url of [
    `https://youtube.com.evil.test/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://evil.test/?x=youtube.com/watch?v=${ID}`,
    `https://vimeo.com/${ID}`,
  ]) {
    assert.equal(youtubeId(url), null, url)
  }
})

test('a YouTube page that is not a video yields nothing', () => {
  for (const url of [
    'https://www.youtube.com/results?search_query=carbonara',
    'https://www.youtube.com/channel/UCabc',
    'https://www.youtube.com/playlist?list=PLabc',
    'https://www.youtube.com/',
  ]) {
    assert.equal(youtubeId(url), null, url)
  }
})

test('an id has to be exactly eleven characters of the right alphabet', () => {
  for (const bad of ['short', 'waaaaaaytoolong', 'bad!chars!!', '../../../etc', '']) {
    assert.equal(youtubeId(`https://www.youtube.com/watch?v=${bad}`), null, bad)
  }
})

test('invalid and dangerous URLs yield nothing', () => {
  for (const url of [
    '', null, undefined, 'not a url', '//youtube.com/watch?v=' + ID,
    `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    'data:text/html,<iframe src=x>',
    'file:///etc/passwd',
  ]) {
    assert.equal(youtubeId(url), null, String(url))
  }
})

test('the embed URL is built from the id, never borrowed', () => {
  assert.equal(embedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}`)
})

/* -------------------------------------------------------------- playability */

test('only a file a browser can play counts as playable', () => {
  for (const url of [
    'https://example.com/clip.mp4', 'https://example.com/clip.webm',
    'https://example.com/a/CLIP.MP4', 'https://example.com/clip.mp4?token=abc',
  ]) assert.equal(isPlayable(url), true, url)

  for (const url of [
    'https://example.com/page.html', 'https://example.com/video', '',
    `https://www.youtube.com/watch?v=${ID}`, 'not a url',
  ]) assert.equal(isPlayable(url), false, url)
})

test('only http and https are safe to put in an attribute', () => {
  assert.equal(isSafe('https://example.com/a.jpg'), true)
  assert.equal(isSafe('http://example.com/a.jpg'), true)
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///etc/passwd', '', null]) {
    assert.equal(isSafe(url), false, String(url))
  }
})

/* ---------------------------------------------------------------- normalise */

test('a YouTube item becomes a player with an embed built here', () => {
  const item = normalise({
    kind: 'youtube', title: 'Carbonara', url: `https://www.youtube.com/watch?v=${ID}`,
    thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg', source: 'Some Cook', duration: '10:02',
  })
  assert.equal(item.kind, 'youtube')
  assert.equal(item.embed, `https://www.youtube-nocookie.com/embed/${ID}`)
  assert.equal(item.source, 'Some Cook')
  assert.equal(item.duration, '10:02')
})

test('a forged embed_url is ignored in favour of one derived from the link', () => {
  // The payload comes out of the transcript, so this is the case that matters:
  // claiming to be a video while pointing the frame somewhere else.
  const item = normalise({
    kind: 'youtube', title: 'Innocent', url: `https://www.youtube.com/watch?v=${ID}`,
    embed_url: 'https://evil.test/takeover',
  })
  assert.equal(item.embed, `https://www.youtube-nocookie.com/embed/${ID}`)
  assert.ok(!JSON.stringify(item).includes('evil.test'))
})

test('a non-YouTube item claiming to be a YouTube video gets no player', () => {
  const item = normalise({
    kind: 'youtube', title: 'Nope', url: 'https://evil.test/page',
    embed_url: 'https://evil.test/takeover',
  })
  // It falls back to a link, which is the honest thing it actually is.
  assert.equal(item.kind, 'link')
  assert.equal(item.embed, undefined)
})

test('an image keeps its full-size URL and its attribution', () => {
  const item = normalise({
    kind: 'image', title: 'Carbonara', url: 'https://example.com/page',
    direct_url: 'https://example.com/full.jpg', thumbnail: 'https://example.com/t.jpg',
    source: 'A Photographer', license: 'cc-by',
  })
  assert.equal(item.kind, 'image')
  assert.equal(item.direct, 'https://example.com/full.jpg')
  assert.equal(item.url, 'https://example.com/page')
  assert.equal(item.license, 'cc-by')
})

test('a directly playable file becomes a video', () => {
  const item = normalise({
    kind: 'video', title: 'Clip', url: 'https://example.com/watch',
    direct_url: 'https://example.com/clip.mp4',
  })
  assert.equal(item.kind, 'video')
  assert.equal(item.direct, 'https://example.com/clip.mp4')
})

test('a video that is not directly playable falls back to a link', () => {
  // The rule the brief asks for: a player only when the URL supports playback.
  const item = normalise({
    kind: 'video', title: 'Some video page', url: 'https://example.com/watch',
    direct_url: 'https://example.com/watch',
  })
  assert.equal(item.kind, 'link')
})

test('an unsafe thumbnail is dropped, not the card', () => {
  const item = normalise({
    kind: 'image', title: 'X', url: 'https://example.com/page',
    direct_url: 'https://example.com/full.jpg', thumbnail: 'javascript:alert(1)',
  })
  assert.equal(item.thumbnail, null)
  assert.equal(item.kind, 'image')
})

test('an item with no usable link is dropped entirely', () => {
  for (const bad of [
    null, undefined, {}, { url: '' }, { url: 'javascript:alert(1)' }, { url: 'not a url' },
  ]) {
    assert.equal(normalise(bad), null, JSON.stringify(bad))
  }
})

test('normaliseAll drops the bad and keeps the good, in order', () => {
  const items = normaliseAll([
    { kind: 'link', title: 'ok', url: 'https://example.com/a' },
    { kind: 'image', title: 'bad', url: 'javascript:alert(1)' },
    { kind: 'youtube', title: 'vid', url: `https://youtu.be/${ID}` },
  ])
  assert.deepEqual(items.map((i) => i.kind), ['link', 'youtube'])
})

test('no media at all is an empty gallery, not an error', () => {
  for (const empty of [undefined, null, [], 'not an array', {}]) {
    assert.deepEqual(normaliseAll(empty), [], String(empty))
  }
})

/* ---------------------------------------------------------------- report */

for (const f of failures) console.log(`FAIL  ${f.name}\n      ${f.message}`)
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
