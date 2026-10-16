import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// 1. Files exist
const splitPaneFile = join(baseDir, 'components', 'damon', 'DamonSplitPane.jsx');
const previewFile = join(baseDir, 'components', 'damon', 'DamonPreview.jsx');

assert(existsSync(splitPaneFile), 'DamonSplitPane.jsx must exist');
assert(existsSync(previewFile), 'DamonPreview.jsx must exist');

// 2. CSS classes exist in index.css
const css = readFileSync(join(baseDir, 'index.css'), 'utf8');
assert(css.includes('.damon-split-pane'), 'index.css must define .damon-split-pane');
assert(css.includes('.damon-results-pane'), 'index.css must define .damon-results-pane');
assert(css.includes('.damon-preview-pane'), 'index.css must define .damon-preview-pane');

// 3. CommandPalette imports or uses split pane
const paletteCode = readFileSync(join(baseDir, 'components', 'CommandPalette.jsx'), 'utf8');
assert(paletteCode.includes('DamonSplitPane') || paletteCode.includes('damon-split-pane'), 'CommandPalette must integrate split-pane layout');

console.log('launcher-splitpane: split-pane components and CSS layout tokens verified — ok');
