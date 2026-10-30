# Kokonut widget grid

Installed with `npx shadcn@latest add https://kokonutui.com/r/bento-grid.json`.
Source: `frontend/src/components/kokonutui/bento-grid.tsx` (MIT attribution retained).

The existing Home grid continues to own persisted order, size, keyboard controls and resize. The Kokonut component is available for isolated compositions; its default item list is empty so it never displays demo measurements as user data. Upstream demo measurements have been removed; colors and controls use the app’s theme tokens and shared button primitive.

Use the component with real data already loaded by the dashboard:

```jsx
import WidgetGrid from '@/components/kokonutui/bento-grid'
import { ClockPreview } from '@/dashboard/widgets/Clock'

<WidgetGrid
  items={[{
    id: 'glance.clock',
    title: 'Clock',
    defaultSpan: 2,
    render: size => <ClockPreview data={clockPayload} size={size} />,
  }]}
  layout={layout}
  onLayoutChange={setLayout}
/>
```

`clockPayload` comes from the existing clock provider; `layout` contains `{ id, span }` entries. Span 2 selects S, 3–4 selects M, 5–6 selects L. On narrow containers, spans above 2 select M. Persist layout through the existing dashboard path when integrating; this example only controls local component state.

To review the shipped clock variants, open Home → Add widgets → Glance → Clock. Selecting S, M or L updates the live preview using saved world clocks. S shows the local dial and saved count, M adds two world clocks, L shows all four. Clock settings remain available from its Home card.
