/**
 * The spotlight window's box, checked in the file rather than by eye.
 *
 * This exists because of a bug nobody could see. `[data-native] .palette--bar`
 * and `.palette.palette--bar` are both two-class selectors, so the cascade
 * decided between them on source order -- and the later one won. The native
 * window therefore took its width (100%), its height (100vh) and its radius
 * (14px) from the wrong rule while still applying the other rule's 12px
 * margin. A 100%-wide box with a 12px margin on each side is 24px wider than
 * the window it is in, which is where a horizontal scrollbar came from that
 * nothing in the markup could explain, and the 20px radius that was written
 * down was never the radius that was drawn.
 *
 * Nothing in a build or a screenshot catches that: the page renders, the card
 * looks roughly right, and the only symptom is "it looks a bit off". So the
 * two things that were wrong are asserted directly.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'),
  'utf8',
);

/** Every `selector { ... }` block, in source order.
 *
 * Comments are stripped first. They are not decoration in this file -- some of
 * them are paragraphs, and one of them sits between a `margin` and a `width`,
 * which was enough to make an earlier version of this test read the wrong
 * declaration and pass a stylesheet that was broken.
 */
function blocks(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(bare))) {
    found.push({ selector: m[1].trim(), body: m[2], at: m.index });
  }
  return found;
}

/** (ids, classes+attributes+pseudo-classes, elements) — enough for this file. */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) || []).length +
    (selector.match(/\[[^\]]+\]/g) || []).length +
    (selector.match(/:(?!:)(?!has|is|where)[\w-]+/g) || []).length;
  return [ids, classes];
}

function wins(a, b) {
  const [ai, ac] = specificity(a.selector);
  const [bi, bc] = specificity(b.selector);
  if (ai !== bi) return ai > bi;
  if (ac !== bc) return ac > bc;
  return a.at > b.at; // equal specificity: source order decides
}

const all = blocks(css);
const native = all.find((b) => /\[data-native\][^,{]*\.palette--bar\s*$/.test(b.selector));
const bar = all.find((b) => /^\.palette\.palette--bar\s*$/.test(b.selector));

assert.ok(native, 'no rule styles the spotlight in its own window');
assert.ok(bar, 'no rule styles the spotlight bar');

// 1. The native rule must actually apply.
assert.ok(
  wins(native, bar),
  `${native.selector} loses to ${bar.selector}, so the native window is styled by the wrong rule`,
);

// 2. Resolve the box the native window actually gets, by cascade, and check
//    that it fits. A margin plus a full-width box is wider than the window.
const declared = (block, prop) => {
  const m = block.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

/** What `.palette.palette--bar` inside `[data-native]` ends up with. */
const effective = (prop) => {
  let value = null;
  let winner = null;
  for (const block of [bar, native]) {
    const declaredHere = declared(block, prop);
    if (declaredHere === null) continue;
    if (winner === null || wins(block, winner)) {
      value = declaredHere;
      winner = block;
    }
  }
  return value;
};

const margin = effective('margin');
const width = effective('width');
const height = effective('height');
const hasMargin = margin && margin !== '0' && margin !== '0px';

if (hasMargin) {
  assert.ok(
    width !== '100%' && width !== '100vw',
    `the native card ends up width:${width} with a ${margin} margin -- wider than its window`,
  );
  assert.ok(
    height !== '100vh' && height !== '100%',
    `the native card ends up height:${height} with a ${margin} margin -- taller than its window`,
  );
}

// The radius that is written down must be the radius that is drawn.
const radius = effective('border-radius');
assert.ok(
  radius && parseFloat(radius) >= 16,
  `the native card's corner radius resolves to ${radius}, which is nearly square`,
);

// 3. A window that shows one fixed card must not scroll.
assert.ok(
  /html:has\(\.palette--bar\)[^{]*\{[^}]*overflow:\s*hidden/.test(css),
  'the spotlight window is allowed to scroll',
);

console.log('spotlight: native rule wins, no overflow, window does not scroll — ok');
