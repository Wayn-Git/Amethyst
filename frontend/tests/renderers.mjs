/* Every widget renderer, rendered.
 *
 * `widgets.mjs` covers reading a widget out of the transcript; this covers what
 * happens to it afterwards. It renders each of the eight renderers with a
 * realistic payload and asserts what a reader would end up seeing -- the
 * servings arithmetic, the padded comparison cell, one step of a step guide and
 * not twelve.
 *
 *     npm run test:renderers
 *
 * Vite does the JSX, React renders to a string, and nothing here needs a
 * browser, a backend or a model -- so unlike `smoke.mjs` it is free, offline
 * and deterministic. What it cannot see is interaction: clicking an answer,
 * dragging the slider, switching a day. Those are `smoke.mjs`'s to cover, and
 * the effects they run (Chart.js, Leaflet) do not execute in this pass at all.
 */

import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const here = new URL('.', import.meta.url).pathname
/* Built inside `node_modules` rather than in a temp directory: React and
   Chart.js stay external to the bundle, so the output has to sit somewhere
   node can resolve them from. Already gitignored, for the same reason. */
const out = join(here, '../node_modules/.widget-test')
mkdirSync(out, { recursive: true })

/* One entry re-exporting the dispatcher, bundled for node. Going through
   `WidgetRenderer` rather than importing each renderer directly means the
   type -> component table is under test too: a renderer that is written but
   never wired up fails here. */
const entry = join(out, 'entry.jsx')
writeFileSync(entry, `export { default } from ${JSON.stringify(join(here, '../src/components/widgets/WidgetRenderer.jsx'))}\n`)

const result = await build({
  root: out,
  logLevel: 'silent',
  plugins: [react()],
  build: {
    ssr: entry,
    outDir: out,
    emptyOutDir: false,
    // React and the two heavy widget libraries resolve from node_modules at
    // run time rather than being bundled into the fixture.
    rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'chart.js', 'leaflet'] },
  },
})

/* The emitted extension depends on the nearest package.json's `type`, so it is
   read off the build result rather than guessed at. */
const [{ output }] = [result].flat()
const bundled = output.find((chunk) => chunk.isEntry)
const { default: WidgetRenderer } = await import(pathToFileURL(join(out, bundled.fileName)).href)

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

/** The markup a reader would get for one widget. */
const render = (type, data, media) =>
  renderToStaticMarkup(WidgetRenderer({ widget: { type, data, media } }))

/** Markup with the tags taken out, for asserting on what is actually legible. */
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/* ------------------------------------------------------------- step_guide */

const GUIDE = {
  title: 'Change a tyre',
  steps: [
    { title: 'Loosen the nuts', text: 'Before you lift it.', timer_seconds: null },
    { title: 'Jack it up', text: 'Use the jacking point.', timer_seconds: 90 },
    { title: 'Swap the wheel', text: 'Finger-tight first.', timer_seconds: null },
  ],
}

test('step_guide shows one step, not all of them', () => {
  const text = textOf(render('step_guide', GUIDE))
  assert.match(text, /Loosen the nuts/)
  // The whole reason this is a stepper rather than a list.
  assert.doesNotMatch(text, /Jack it up/)
  assert.doesNotMatch(text, /Swap the wheel/)
})

test('step_guide counts its steps', () => {
  assert.match(textOf(render('step_guide', GUIDE)), /1 \/ 3/)
})

test('step_guide offers a timer only where the step has one', () => {
  // The first step's timer is null, so no clock.
  assert.doesNotMatch(render('step_guide', GUIDE), /widget-timer/)
  const timed = { ...GUIDE, steps: [GUIDE.steps[1]] }
  assert.match(render('step_guide', timed), /widget-timer/)
  assert.match(textOf(render('step_guide', timed)), /1:30/)
})

test('an empty payload renders nothing rather than an empty frame', () => {
  // The frame wraps the renderer and cannot see that it drew nothing, so a
  // header over a blank space is exactly what this is here to prevent.
  assert.equal(render('step_guide', { title: 'Empty', steps: [] }), '')
  assert.equal(render('quiz', { title: 'Empty', questions: [] }), '')
  assert.equal(render('comparison', { title: 'Empty', items: [] }), '')
  assert.equal(render('itinerary', { title: 'Empty', days: [] }), '')
  assert.equal(render('chart', { title: 'Empty', type: 'bar', labels: [], series: [] }), '')
  assert.equal(render('options', { title: 'Empty', selection_mode: 'single', options: [] }), '')
})

/* -------------------------------------------------------------------- quiz */

const QUIZ = {
  title: 'Water cycle',
  questions: [
    {
      question: 'What is evaporation?',
      options: ['Liquid to gas', 'Gas to liquid', 'Solid to gas'],
      correct_index: 0,
      explanation: 'Heat turns liquid water into vapour.',
    },
    { question: 'And condensation?', options: ['a', 'b'], correct_index: 1, explanation: 'x' },
  ],
}

test('quiz shows the question and every option', () => {
  const text = textOf(render('quiz', QUIZ))
  assert.match(text, /What is evaporation\?/)
  for (const option of QUIZ.questions[0].options) assert.match(text, new RegExp(option))
})

test('quiz does not give the answer away before it is answered', () => {
  const html = render('quiz', QUIZ)
  // No option is marked, and the explanation is not on screen yet.
  assert.doesNotMatch(html, /is-right|is-wrong/)
  assert.doesNotMatch(textOf(html), /Heat turns liquid water into vapour/)
})

test('quiz starts at zero and knows how many questions there are', () => {
  const text = textOf(render('quiz', QUIZ))
  assert.match(text, /0 correct/)
  assert.match(text, /1 \/ 2/)
})

/* ------------------------------------------------------------------ recipe */

const RECIPE = {
  title: 'Pancakes',
  servings: 4,
  ingredients: [
    { name: 'flour', amount: 200, unit: 'g' },
    { name: 'eggs', amount: 2, unit: '' },
  ],
  steps: [{ title: 'Mix', text: 'Combine everything.', timer_seconds: null }],
}

test('recipe opens at the servings it was written for', () => {
  const text = textOf(render('recipe', RECIPE))
  assert.match(text, /200 g/)
  assert.match(text, /flour/)
  // The slider's value, which is what the quantities are scaled against.
  assert.match(render('recipe', RECIPE), /value="4"/)
})

test('recipe renders its method as a step guide', () => {
  assert.match(textOf(render('recipe', RECIPE)), /Method/)
  assert.match(textOf(render('recipe', RECIPE)), /Combine everything/)
})

/* -------------------------------------------------------------- comparison */

test('comparison lines every value up under its item', () => {
  const html = render('comparison', {
    title: 'Rust vs Go',
    items: ['Rust', 'Go'],
    attributes: [{ name: 'GC', values: ['no', 'yes'] }],
  })
  const cells = [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1])
  assert.deepEqual(cells, ['no', 'yes'])
})

test('comparison pads a short row rather than shifting the columns', () => {
  // A model that answers two values for three items must leave a visible gap,
  // not silently move "yes" under the wrong heading.
  const html = render('comparison', {
    title: 'Three ways',
    items: ['A', 'B', 'C'],
    attributes: [{ name: 'GC', values: ['no', 'yes'] }],
  })
  const cells = [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1])
  assert.equal(cells.length, 3)
  assert.equal(cells[2], '—')
})

/* --------------------------------------------------------------- itinerary */

const ITINERARY = {
  title: 'Kyoto',
  days: [
    {
      day: 1,
      stops: [{ name: 'Fushimi Inari', description: 'Torii gates.', latitude: 34.96, longitude: 135.77 }],
    },
    { day: 2, stops: [{ name: 'Arashiyama', description: 'Bamboo.', latitude: null, longitude: null }] },
  ],
}

test('itinerary shows a tab per day and the first day\'s stops', () => {
  const text = textOf(render('itinerary', ITINERARY))
  assert.match(text, /Day 1/)
  assert.match(text, /Day 2/)
  assert.match(text, /Fushimi Inari/)
  // Day two is behind its tab.
  assert.doesNotMatch(text, /Bamboo/)
})

test('itinerary asks for a map only when a stop has coordinates', () => {
  assert.match(render('itinerary', ITINERARY), /widget-map/)
  const unplotted = { title: 'Ideas', days: [{ day: 1, stops: [{ name: 'Somewhere', description: 'TBC', latitude: null, longitude: null }] }] }
  const html = render('itinerary', unplotted)
  // No coordinates, no map -- and the stop is still listed.
  assert.doesNotMatch(html, /widget-map/)
  assert.match(textOf(html), /Somewhere/)
})

/* ------------------------------------------------------------- translation */

test('translation shows both sides and labels them', () => {
  const text = textOf(render('translation', {
    source_language: 'English', target_language: 'French',
    source: 'hello', translation: 'bonjour',
  }))
  assert.match(text, /English/)
  assert.match(text, /French/)
  assert.match(text, /hello/)
  assert.match(text, /bonjour/)
})

/* ------------------------------------------------------------------- chart */

test('chart renders a canvas for the effect to draw into', () => {
  const html = render('chart', {
    title: 'Sales', type: 'bar', labels: ['Jan', 'Feb'],
    series: [{ name: '2024', data: [1, 2] }],
  })
  assert.match(html, /<canvas/)
  assert.match(textOf(html), /Sales/)
})

/* ----------------------------------------------------------------- options */

test('options is a radiogroup when only one may be chosen', () => {
  const html = render('options', {
    title: 'Pick one', selection_mode: 'single',
    options: [{ title: 'A', description: 'the first' }, { title: 'B', description: 'the second' }],
  })
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /role="radio"/)
  assert.match(textOf(html), /the first/)
})

test('options is a group of checkboxes when several may be', () => {
  const html = render('options', {
    title: 'Pick any', selection_mode: 'multi',
    options: [{ title: 'A', description: 'the first' }],
  })
  assert.match(html, /role="group"/)
  assert.match(html, /role="checkbox"/)
})

test('nothing is selected until someone selects it', () => {
  const html = render('options', {
    title: 'Pick one', selection_mode: 'single',
    options: [{ title: 'A', description: 'the first' }],
  })
  assert.match(html, /aria-checked="false"/)
})

/* ------------------------------------------------------------- the unknown */

test('an unknown type renders nothing, so the caller can fall back to prose', () => {
  assert.equal(render('horoscope', { sign: 'leo' }), '')
  assert.equal(render('recipe', null), '')
})

/* ------------------------------------------------------------------ frame */

test('every widget is framed with its title and a type label', () => {
  const html = render('quiz', QUIZ)
  assert.match(html, /widget-frame-head/)
  assert.match(html, /<span class="widget-frame-title">Water cycle<\/span>/)
  assert.match(html, /<span class="widget-frame-label">Quiz<\/span>/)
})

test('translation is titled by its languages, having no title of its own', () => {
  const html = render('translation', {
    source_language: 'English', target_language: 'French',
    source: 'hello', translation: 'bonjour',
  })
  assert.match(html, /<span class="widget-frame-title">English → French<\/span>/)
})

test('the frame titles every type without falling back to a generic label', () => {
  // A renderer wired up without furniture would show "Answer" here.
  for (const [type, data] of [
    ['recipe', RECIPE], ['step_guide', GUIDE], ['quiz', QUIZ],
    ['comparison', { title: 'C', items: ['a'], attributes: [] }],
    ['itinerary', ITINERARY],
    ['chart', { title: 'Ch', type: 'bar', labels: ['x'], series: [{ name: 's', data: [1] }] }],
    ['options', { title: 'O', selection_mode: 'single', options: [{ title: 'A', description: 'd' }] }],
  ]) {
    const title = render(type, data).match(/widget-frame-title">([^<]*)</)?.[1]
    assert.equal(title, data.title, `${type} was titled ${title}`)
  }
})

/* ------------------------------------------------------------------ media */

const ID = 'dQw4w9WgXcQ'

test('a widget with no media renders no gallery', () => {
  // Most widgets carry none, and an empty strip under every one of them would
  // be the feature announcing itself on answers it did not improve.
  for (const media of [undefined, [], null]) {
    assert.doesNotMatch(render('step_guide', GUIDE, media), /media-gallery/)
  }
})

test('a YouTube result renders a poster, not an iframe, until it is clicked', () => {
  const html = render('step_guide', GUIDE, [{
    kind: 'youtube', title: 'Carbonara in 10 minutes',
    url: `https://www.youtube.com/watch?v=${ID}`,
    thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg', source: 'Some Cook', duration: '10:02',
  }])
  assert.match(html, /media-gallery/)
  assert.match(html, /media-poster/)
  // No third-party frame is created for a video nobody has chosen to watch.
  assert.doesNotMatch(html, /<iframe/)
  assert.match(html, /Carbonara in 10 minutes/)
  assert.match(html, /Some Cook/)
  assert.match(html, /10:02/)
})

test('a forged embed never reaches the markup', () => {
  const html = render('step_guide', GUIDE, [{
    kind: 'youtube', title: 'x', url: 'https://evil.test/page',
    embed_url: 'https://evil.test/takeover',
  }])
  assert.doesNotMatch(html, /evil\.test\/takeover/)
  // It degrades to the link card it actually is.
  assert.match(html, /media-link/)
})

test('an image gets a thumbnail and keeps its attribution', () => {
  const html = render('recipe', RECIPE, [{
    kind: 'image', title: 'Carbonara', url: 'https://example.com/page',
    direct_url: 'https://example.com/full.jpg', thumbnail: 'https://example.com/t.jpg',
    source: 'A Photographer', license: 'cc-by',
  }])
  assert.match(html, /media-thumb/)
  assert.match(html, /src="https:\/\/example\.com\/t\.jpg"/)
  assert.match(html, /A Photographer/)
  assert.match(html, /cc-by/)
  // Attribution points at the landing page, where the licence is readable.
  assert.match(html, /href="https:\/\/example\.com\/page"/)
})

test('a directly playable file gets a real video element', () => {
  const html = render('step_guide', GUIDE, [{
    kind: 'video', title: 'Clip', url: 'https://example.com/watch',
    direct_url: 'https://example.com/clip.mp4', source: 'example.com',
  }])
  assert.match(html, /<video/)
  assert.match(html, /src="https:\/\/example\.com\/clip\.mp4"/)
})

test('a video that cannot be played inline falls back to a link card', () => {
  const html = render('step_guide', GUIDE, [{
    kind: 'video', title: 'Some video page', url: 'https://example.com/watch',
    direct_url: 'https://example.com/watch', source: 'example.com',
  }])
  assert.doesNotMatch(html, /<video/)
  assert.match(html, /media-link/)
  assert.match(html, /Some video page/)
})

test('an unrenderable item costs its own card and not the gallery', () => {
  const html = render('step_guide', GUIDE, [
    { kind: 'image', title: 'bad', url: 'javascript:alert(1)' },
    { kind: 'link', title: 'good', url: 'https://example.com/ok', source: 'example.com' },
  ])
  assert.doesNotMatch(html, /javascript:/)
  assert.match(html, /good/)
})

test('media sits inside the frame, under the widget', () => {
  const html = render('step_guide', GUIDE, [{
    kind: 'link', title: 'Read more', url: 'https://example.com/a', source: 'example.com',
  }])
  // The answer first, the garnish after it.
  assert.ok(html.indexOf('widget-steps') < html.indexOf('media-gallery'))
  assert.ok(html.indexOf('media-gallery') < html.lastIndexOf('</div>'))
})

/* ---------------------------------------------------------------- report */

for (const f of failures) console.log(`FAIL  ${f.name}\n      ${f.message}`)
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
