import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
const file = new URL('../src/__ui_lint_fixture.jsx', import.meta.url)
try {
 writeFileSync(file, 'export default function Fixture() { return <div><button/><input/><select/><textarea/></div> }')
 const output = execFileSync('./node_modules/.bin/oxlint', ['-c', '.oxlintrc.json', 'src/__ui_lint_fixture.jsx'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
 assert.equal((output.match(/amethyst-ui\(no-raw-controls\)/g) || []).length, 4, output)
 console.log('PASS: raw control lint emits four warnings with successful exit')
} finally { unlinkSync(file) }
