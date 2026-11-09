import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyIntentWithRules } from '../src/components/damon/intentCore.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = JSON.parse(
  readFileSync(join(repoRoot, 'backend', 'launcher', 'intent_rules.json'), 'utf8'),
);
const classify = (query, mode = 'all') => classifyIntentWithRules(query, mode, rules);

const cases = [
  ['', 'home', ''],
  ['chrome', 'local', 'chrome'],
  ['chrome release notes', 'search', 'chrome release notes'],
  ['how do i center a div', 'question', 'how do i center a div'],
  ['2+2', 'math', '2+2'],
  ['10 km to miles', 'math', '10 km to miles'],
  ['/etc/hosts', 'files', '/etc/hosts'],
  ['report.pdf', 'files', 'report.pdf'],
  ['volume up', 'system', 'volume up'],
  ['clipboard', 'clipboard', ''],
  ['switch to chrome', 'windows', 'switch to chrome'],
  ['open chrome', 'apps', 'open chrome'],
  ['go to settings', 'commands', 'go to settings'],
  ['>google rust lifetimes', 'web', 'rust lifetimes'],
  ['> library dune', 'library', 'dune'],
  ['? what is rust', 'question', 'what is rust'],
  ['youtube lofi beats', 'youtube', 'lofi beats'],
  ['github react', 'github', 'react'],
];

for (const [query, mode, subject] of cases) {
  const intent = classify(query);
  assert.equal(intent.mode, mode, `mode for ${JSON.stringify(query)}`);
  assert.equal(intent.subject, subject, `subject for ${JSON.stringify(query)}`);
}

assert.equal(classify('>yt lofi').explicit, true, 'prefix marks intent explicit');

const explicit = classify('youtube cats', 'web');
assert.equal(explicit.mode, 'web', 'explicit pill wins over prefix');
assert.equal(explicit.subject, 'youtube cats', 'explicit pill keeps full query');
assert.equal(explicit.explicit, true, 'explicit pill marked explicit');

const local = classify('chrome');
assert.deepEqual(local.providers, ['apps', 'commands', 'library'], 'local providers');
assert.deepEqual(local.external, [], 'local never calls external sources');

const search = classify('rust async book');
assert.deepEqual(search.external, ['web'], 'search is web only');
assert.equal(search.ask, false, 'search does not spend an answer call');

const question = classify('why is the sky blue');
assert.equal(question.ask, true, 'question asks');
assert.deepEqual(question.evidence, ['wiki'], 'question uses wiki evidence');

for (const query of ['', 'chrome', 'report.pdf', 'volume up', 'how tall is everest']) {
  assert.ok(!classify(query).providers.includes('nope'), `no unknown provider for ${query}`);
}

console.log('launcher-intent: routing matrix, prefix precedence and provider gating verified — ok');
