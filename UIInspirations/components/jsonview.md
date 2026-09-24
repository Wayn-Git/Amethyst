# JSON viewer

> A collapsible JSON tree with search, paging for long arrays, and copy value or path.

- Type: Component (data)
- Access: Free, open source
- Page: https://uiarc.dev/components/json-viewer
- Markdown: https://uiarc.dev/components/json-viewer/markdown
- Registry item: https://uiarc.dev/r/json-viewer.json
- Source file: `registry/components/json-viewer/json-viewer.tsx`
- Dependencies: motion, lucide-react
- Keywords: data, new, react json viewer, json tree, json inspector, collapsible json, json explorer, copy json path, search json, api response viewer

## When to use

- Inspecting a JSON payload in a developer dashboard, such as webhooks or API logs.
- Large nested objects where search and copy path save time.
- Arrays with hundreds of items, which load in pages of pageSize.

## When not to use

- Use code-block to show JSON as formatted source for copying whole.
- Use tree-view for folders, navigation, or other non-JSON hierarchies.
- Use data-grid when the data is a flat list of records.

## Installation

### CLI

Run one of these in a project set up with `shadcn init`:

```bash
npx shadcn@latest add @uiarc/json-viewer
pnpm dlx shadcn@latest add @uiarc/json-viewer
yarn dlx shadcn@latest add @uiarc/json-viewer
bunx --bun shadcn@latest add @uiarc/json-viewer
```

The `@uiarc` name needs `"registries": { "@uiarc": "https://uiarc.dev/r/{name}.json" }` in `components.json`. Without it, use the full URL:

```bash
npx shadcn@latest add https://uiarc.dev/r/json-viewer.json
```

### Manual

1. Install the dependencies:

```bash
npm install motion lucide-react
```

2. Copy the source into your project. Main file: `registry/components/json-viewer/json-viewer.tsx`

   The source is in the registry item: https://uiarc.dev/r/json-viewer.json

3. Arc imports use the `@/` alias for `registry/` and `lib/`. Keep the same folders or update the import paths.

## Usage

```tsx
import { JsonViewer } from "@/components/arc/json-viewer/json-viewer";

export function WebhookPayload({ payload }: { payload: unknown }) {
  return (
    <JsonViewer
      data={payload}
      rootName="event"
      defaultExpandDepth={2}
      maxHeight={360}
      onCopy={({ kind }) => toast(kind === "path" ? "Path copied" : "Value copied")}
    />
  );
}
```

## API reference

### JsonViewer

A collapsible JSON tree with type colors, search that opens matching branches, paged long branches, and copy value or path per row.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` (required) | `unknown` | – | Any JSON-like value. |
| `rootName` | `string` | `"root"` | Name of the root in paths, as in root.users[0].name. |
| `defaultExpandDepth` | `number` | `1` | Levels open on first render when defaultExpanded is not set. 1 opens the root. |
| `expanded` | `string[]` | – | Controlled paths of open branches. |
| `defaultExpanded` | `string[]` | – | Open branch paths on first render when uncontrolled. |
| `onExpandedChange` | `(paths: string[]) => void` | – | Called when branches open or close. |
| `searchable` | `boolean` | `true` | Shows the search field. |
| `query` | `string` | – | Controlled search text. |
| `defaultQuery` | `string` | `""` | Starting search text when uncontrolled. |
| `onQueryChange` | `(query: string) => void` | – | Called as the search text changes. |
| `pageSize` | `number` | `50` | Children shown per page in a long array or object. |
| `copyable` | `boolean` | `true` | Shows copy value and copy path actions. |
| `onCopy` | `(detail: JsonViewerCopyDetail) => void` | – | Called after a copy with { kind: "value" \| "path", path, text }. |
| `onSelect` | `(detail: { path: string; value: unknown; type: JsonValueType }) => void` | – | Called when a row becomes the current one. |
| `showPath` | `boolean` | `true` | Shows the current row's path under the tree. |
| `maxHeight` | `number \| string` | `420` | Height of the scrolling tree area. Numbers are pixels. |
| `label` | `string` | `"JSON"` | Accessible name of the tree. |
| `className` | `string` | – | Class on the root. |
| `ref` | `Ref<HTMLDivElement>` | – | The root element. |

## Keyboard interactions

| Keys | Action |
| --- | --- |
| ArrowDown / ArrowUp | Moves to the next or previous visible row. |
| ArrowRight | Opens a closed branch, or moves into an open one. |
| ArrowLeft | Closes an open branch, or moves to the parent. |
| Home / End | Jumps to the first or last visible row. |
| Enter / Space | Toggles a branch, or loads the next page on a Show more row. |
| Cmd/Ctrl + C | Copies the focused row's value; add Shift to copy its path. Ignored while text is selected. |
| / | Focuses the search field. |
| Enter / Shift + Enter (in search) | Jumps to the next or previous match. |
| Escape (in search) | Clears the query. |
| ArrowDown (in search) | Moves focus into the tree. |

## Accessibility

- Follows the WAI-ARIA tree pattern: role="tree" with treeitems carrying aria-level, aria-posinset, aria-setsize, aria-expanded, and aria-selected.
- One row is tabbable at a time; each row's label reads its key and value, or its type and item count.
- The match counter is aria-live polite, and a status region announces copies and failures.
- Row copy buttons are out of the tab order; use Cmd or Ctrl with C, or the path bar's copy button, from the keyboard.

## Motion

- Each row unfolds its own height, so opening a branch, loading a page, or expanding all share one motion.
- The current-row highlight glides between rows with a shared layout id, and the tree scroll springs to where the row will sit once rows settle.
- Copy glyphs swap to a check or cross with a small scale and blur.
- Reduced motion, or more than 400 visible rows, makes row changes instant; reduced motion also jumps the scroll and highlight.

## Responsive behavior

- The tree scrolls inside maxHeight; long keys and values truncate with an ellipsis and strings over 40 characters show in full on hover.
- At 420px viewport width and below the indent drops from 16px to 12px, keys cap at 40% of the row, and the path type hides.
- Row copy actions show on hover with a fine pointer; on touch they show on the current row.

## Performance

- Rows are a flat list rebuilt only when data, open branches, pages, or search change; nothing is virtualized, so paging keeps the DOM small.
- Above 400 visible rows the height animations switch off to keep expand all fast.
- Search walks the whole value on each keystroke; for multi-megabyte payloads control query and debounce it.

## Notes for AI

- Use for API responses, webhook payloads, logs, and config inspection in developer tools.
- Search matches keys and primitive values case-insensitively, opens the branches that hold them, and stops at 2000 matches.
- Control expanded to persist open branches across reloads, or to open a path from elsewhere in the page.
- For formatted source code use code-block; for tabular data use data-grid.

## Related

- [Tree view](https://uiarc.dev/components/tree-view/markdown): Navigate nested folders and structured content.
- [Code block](https://uiarc.dev/components/code-block/markdown): Present code with legible hierarchy and copy access.
- [Search field](https://uiarc.dev/components/search-field/markdown): A recognizable search entry point with clear affordances.
- [Copy button](https://uiarc.dev/components/copy-button/markdown): Copy a value with immediate confirmation.

## Also in tables

- [Sortable data table](https://uiarc.dev/components/sortable-data-table/markdown): Compare structured records with sortable columns.
- [Filter toolbar](https://uiarc.dev/components/filter-toolbar/markdown): Keep collection filters close and easy to reset.

## Guidance for AI tools

JSON viewer: A collapsible JSON tree with search, paging for long arrays, and copy value or path. Follow the declared prop types and do not invent props. Keep keyboard access, reduced motion support, and both light and dark themes intact when adapting it.

Full library index: https://uiarc.dev/llms.txt
