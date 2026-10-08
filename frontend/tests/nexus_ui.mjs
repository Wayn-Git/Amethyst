import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const here = new URL('.', import.meta.url).pathname
const out = join(here, '../node_modules/.nexus-ui-test')
mkdirSync(out, { recursive: true })

const entry = join(out, 'entry.jsx')
writeFileSync(
  entry,
  `
export {
  Questions,
  QuestionsHeader,
  QuestionsTitle,
  QuestionsDismiss,
  QuestionsCarousel,
  QuestionsCarouselContent,
  QuestionsCarouselItem,
  QuestionsCarouselPagination,
  QuestionsCarouselPrev,
  QuestionsCarouselIndex,
  QuestionsCarouselNext,
  Question,
  QuestionOptions,
  QuestionOption,
  QuestionOther,
  QuestionsFooter,
  QuestionsSkip,
  QuestionsSubmit,
  QUESTION_OTHER_VALUE,
  QUESTION_NO_PREFERENCE_VALUE,
  QUESTION_NO_PREFERENCE_LABEL
} from ${JSON.stringify(join(here, '../src/components/nexus-ui/questions.tsx'))}

export {
  Image,
  ImagePreview,
  ImageLoader,
  ImageLightbox,
  ImageLightboxOverlay,
  ImageLightboxPreview,
  ImageLightboxClose,
  ImageActions,
  ImageActionGroup,
  ImageAction
} from ${JSON.stringify(join(here, '../src/components/nexus-ui/image.tsx'))}
`
)

await build({
  root: out,
  logLevel: 'silent',
  plugins: [react()],
  build: {
    ssr: entry,
    outDir: out,
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: 'bundle.mjs' },
    },
  },
})

const Nexus = await import(`${pathToFileURL(join(out, 'bundle.mjs')).href}?t=${Date.now()}`)

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

test('Questions constants are exported correctly', () => {
  assert.equal(Nexus.QUESTION_OTHER_VALUE, '__other__')
  assert.equal(Nexus.QUESTION_NO_PREFERENCE_VALUE, '__no_preference__')
  assert.equal(Nexus.QUESTION_NO_PREFERENCE_LABEL, '[No Preference]')
})

test('Questions component renders single choice question cleanly', () => {
  const item = {
    id: 'depth',
    type: 'single',
    prompt: 'How detailed should the explanation be?',
    options: [
      { value: 'brief', label: 'Brief overview' },
      { value: 'standard', label: 'Standard depth' },
    ],
  }

  const html = renderToStaticMarkup(
    React.createElement(
      Nexus.Questions,
      { items: [item] },
      React.createElement(
        Nexus.QuestionsHeader,
        null,
        React.createElement(Nexus.QuestionsTitle, null)
      ),
      React.createElement(
        Nexus.Question,
        { key: item.id, id: item.id },
        React.createElement(
          Nexus.QuestionOptions,
          null,
          ...item.options.map((opt) =>
            React.createElement(
              Nexus.QuestionOption,
              { key: opt.value, value: opt.value },
              opt.label
            )
          ),
          React.createElement(Nexus.QuestionOther, { key: "other" })
        )
      ),
      React.createElement(
        Nexus.QuestionsFooter,
        null,
        React.createElement(Nexus.QuestionsSubmit, null)
      )
    )
  )

  assert(html.includes('How detailed should the explanation be?'), 'should contain prompt')
  assert(html.includes('Brief overview'), 'should contain first option')
  assert(html.includes('Standard depth'), 'should contain second option')
  assert(html.includes('Submit') || html.includes('Send answer'), 'should contain submit button')
  assert(html.includes('data-slot="questions"') || html.includes('data-slot="questions-card"'), 'should have questions slot')
})

test('Questions component renders multi-question carousel header and pagination', () => {
  const items = [
    {
      id: 'q1',
      type: 'single',
      prompt: 'Select your preferred framework',
      header: 'FRAMEWORK',
      options: [{ value: 'react', label: 'React' }, { value: 'vue', label: 'Vue' }],
    },
    {
      id: 'q2',
      type: 'multiple',
      prompt: 'Select features needed',
      options: [{ value: 'auth', label: 'Auth' }, { value: 'db', label: 'Database' }],
    },
  ]

  const html = renderToStaticMarkup(
    React.createElement(
      Nexus.Questions,
      { items },
      React.createElement(
        Nexus.QuestionsHeader,
        null,
        React.createElement(Nexus.QuestionsTitle, null),
        React.createElement(
          Nexus.QuestionsCarouselPagination,
          null,
          React.createElement(Nexus.QuestionsCarouselPrev, null),
          React.createElement(Nexus.QuestionsCarouselIndex, { format: 'of' }),
          React.createElement(Nexus.QuestionsCarouselNext, null)
        )
      ),
      React.createElement(
        Nexus.QuestionsFooter,
        null,
        React.createElement(Nexus.QuestionsSkip, null),
        React.createElement(Nexus.QuestionsSubmit, null)
      )
    )
  )

  assert(html.includes('FRAMEWORK'), 'should render header tag')
  assert(html.includes('1 of 2'), 'should render pagination index')
  assert(html.includes('Skip'), 'should render skip button')
})

test('Image component renders with loader and preview structure', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Nexus.Image,
      { src: 'https://example.com/photo.png', alt: 'Test Photo' },
      React.createElement(Nexus.ImagePreview, null),
      React.createElement(
        Nexus.ImageActions,
        { align: 'block-end' },
        React.createElement(
          Nexus.ImageActionGroup,
          null,
          React.createElement(Nexus.ImageAction, { tooltip: 'Copy' }, 'Copy')
        )
      )
    )
  )

  assert(html.includes('data-slot="nexus-image-root"'), 'should render image root')
  assert(html.includes('data-slot="image-loader"'), 'should render image loader slot')
  assert(html.includes('data-slot="image-actions"'), 'should render action slot')
  assert(html.includes('https://example.com/photo.png'), 'should contain image source')
})

console.log(`${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f.name} -> ${f.message}`)
  process.exit(1)
}
