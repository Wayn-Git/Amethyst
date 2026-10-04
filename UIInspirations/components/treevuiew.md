# Tree view

> Navigate nested folders and structured content.

- Type: Component (data)
- Access: Free, open source
- Page: https://uiarc.dev/components/tree-view
- Markdown: https://uiarc.dev/components/tree-view/markdown
- Registry item: https://uiarc.dev/r/tree-view.json
- Source file: `registry/components/tree-view/tree-view.tsx`
- Dependencies: motion, lucide-react
- Keywords: data, navigation, react tree view, file tree, file explorer component, nested tree, folder tree, treeview keyboard navigation

## When to use

- Files, folders, and nested categories people expand and select.
- Side panels next to code-block or a detail view where selection drives content.
- Hierarchies that need full keyboard navigation with arrow keys.

## When not to use

- Use accordion for a few collapsible sections of content.
- Use breadcrumb to show the path to the current page.

## Installation

### CLI

Run one of these in a project set up with `shadcn init`:

```bash
npx shadcn@latest add @uiarc/tree-view
pnpm dlx shadcn@latest add @uiarc/tree-view
yarn dlx shadcn@latest add @uiarc/tree-view
bunx --bun shadcn@latest add @uiarc/tree-view
```

The `@uiarc` name needs `"registries": { "@uiarc": "https://uiarc.dev/r/{name}.json" }` in `components.json`. Without it, use the full URL:

```bash
npx shadcn@latest add https://uiarc.dev/r/tree-view.json
```

### Manual

1. Install the dependencies:

```bash
npm install motion lucide-react
```

2. Copy the source into your project. Main file: `registry/components/tree-view/tree-view.tsx`

   The source is in the registry item: https://uiarc.dev/r/tree-view.json

3. Arc imports use the `@/` alias for `registry/` and `lib/`. Keep the same folders or update the import paths.

## Usage

```tsx
import { TreeView, type TreeNode } from "@/components/arc/tree-view/tree-view";

const files: TreeNode[] = [
  { id: "app", label: "app", children: [
    { id: "page", label: "page.tsx" },
    { id: "layout", label: "layout.tsx" },
  ] },
  { id: "readme", label: "README.md" },
];

export function Files() {
  return <TreeView nodes={files} defaultExpandedIds={["app"]} onSelect={node => open(node.id)} />;
}
```

## API reference

### TreeView

A keyboard navigable file tree with animated expand and a gliding selection.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nodes` (required) | `{ id: string; label: string; children?: TreeNode[]; icon?: ReactNode }[]` | – | Root nodes. Nodes with children are folders. |
| `defaultExpandedIds` | `string[]` | `[]` | Folders open on first render when uncontrolled. |
| `expandedIds` | `string[]` | – | Controlled open folders. |
| `onExpandedChange` | `(expandedIds: string[]) => void` | – | Called with the new open set. |
| `onSelect` | `(node: TreeNode) => void` | – | Called when a row is clicked or activated. |
| `aria-label` | `string` | `"File tree"` | Accessible name for the tree. |

## Keyboard interactions

| Keys | Action |
| --- | --- |
| ArrowDown / ArrowUp | Moves to the next or previous visible row. |
| ArrowRight | Opens a folder, or moves to its first child if open. |
| ArrowLeft | Closes an open folder, or moves to the parent. |
| Home / End | Moves to the first or last visible row. |
| Enter / Space | Selects the row and toggles a folder. |

## Accessibility

- Uses role="tree" and role="treeitem" with aria-level, aria-posinset, aria-setsize, aria-expanded, and aria-selected.
- Roving tabindex keeps one row in the tab order.
- Icons, chevrons, and branch lines are aria-hidden.

## Motion

- Opening a folder grows the space and staggers its children in; closing collapses rows smoothly.
- The selection highlight glides between rows and the chevron rotates on a snappy spring.
- Reduced motion shows and hides rows instantly.

## Responsive behavior

- Rows are a fixed 36px and labels ellipsize, so deep paths clip rather than overflow on narrow panels.
- Each level indents 18px, so very deep trees lose label space on mobile.
- Hover highlights apply only on hover-capable fine pointers.

## Performance

- Every visible row renders with position layout animation; nodes are not virtualized, so keep open folders reasonable.
- Closed folders do not render their children.

## Notes for AI

- Use for hierarchical data such as files or nested categories. Use accordion for a few collapsible sections of content.
- IDs must be unique across the whole tree. Control expandedIds when the open set must persist or sync with routing.

## Related

- [Accordion](https://uiarc.dev/components/accordion/markdown): Progressively reveal supporting information in place.
- [Code block](https://uiarc.dev/components/code-block/markdown): Present code with legible hierarchy and copy access.
- [Breadcrumb](https://uiarc.dev/components/breadcrumb/markdown): Show where a page sits in a hierarchy.

## Also in tables

- [Sortable data table](https://uiarc.dev/components/sortable-data-table/markdown): Compare structured records with sortable columns.
- [Filter toolbar](https://uiarc.dev/components/filter-toolbar/markdown): Keep collection filters close and easy to reset.
- [JSON viewer](https://uiarc.dev/components/json-viewer/markdown): A collapsible JSON tree with search, paging for long arrays, and copy value or path.

## Guidance for AI tools

Tree view: Navigate nested folders and structured content. Follow the declared prop types and do not invent props. Keep keyboard access, reduced motion support, and both light and dark themes intact when adapting it.

Full library index: https://uiarc.dev/llms.txt
