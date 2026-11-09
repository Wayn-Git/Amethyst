import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
const file = new URL('../src/dashboard/__ui_lint_fixture.jsx', import.meta.url)
try {
 writeFileSync(file, 'export default function Fixture() { return <div><button/><input/><select/><textarea/></div> }')
 const result = spawnSync('./node_modules/.bin/oxlint', ['-c', '.oxlintrc.json', 'src/dashboard/__ui_lint_fixture.jsx'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
 const output = result.stdout + result.stderr
 assert.equal(result.status, 1, output)
 assert.equal((output.match(/amethyst-ui\(no-raw-controls\)/g) || []).length, 4, output)
 console.log('PASS: Home raw control lint emits four errors and rejects the file')
} finally { unlinkSync(file) }
