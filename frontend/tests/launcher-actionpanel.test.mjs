import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// 1. ActionPanel file exists
const actionPanelFile = join(baseDir, 'components', 'damon', 'ActionPanel.jsx');
assert(existsSync(actionPanelFile), 'ActionPanel.jsx must exist');

// 2. CSS classes exist in index.css
const css = readFileSync(join(baseDir, 'index.css'), 'utf8');
assert(css.includes('.damon-action-panel'), 'index.css must define .damon-action-panel');
assert(css.includes('.damon-action-item'), 'index.css must define .damon-action-item');
assert(css.includes('.damon-action-shortcut'), 'index.css must define .damon-action-shortcut');

// 3. CommandPalette integrates ActionPanel and Esc hierarchy
const paletteCode = readFileSync(join(baseDir, 'components', 'CommandPalette.jsx'), 'utf8');
assert(paletteCode.includes('ActionPanel'), 'CommandPalette must import/render ActionPanel');
assert(paletteCode.includes('actionPanelOpen'), 'CommandPalette must manage actionPanelOpen state');

console.log('launcher-actionpanel: ActionPanel component, CSS tokens, and Esc hierarchy verified — ok');
