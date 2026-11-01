# Design Spec: Glance Widgets Playground Loop Migration

- **Date:** 2026-11-01
- **Status:** Approved Draft
- **Target:** Home Dashboard Glance Widgets (`glance.air`, `glance.sun`, `glance.weather`, `glance.travel`, `glance.next-event`)
- **Reference Standard:** `docs/widget-playground/WIDGET_LOOP.md`

---

## 1. Goal

Migrate the remaining 5 Glance widgets from legacy or bespoke markup to the Generative UI kit engine (`@tugan/widgets`) strictly according to `docs/widget-playground/WIDGET_LOOP.md`.

Each widget's visual template is generated via the Widgets Playground (`https://widgets.gan.dev/playground`), rendered unchanged via `WidgetRenderer`, and wired to the real Amethyst backend through a pure adapter without hand-rolled React or CSS tile recreation.

---

## 2. Hard Requirements & Constraints

1. **Pure Playground Templates**: Never re-create widgets by hand in bespoke React/CSS. All widget tile visuals are defined by playground templates rendered with `WidgetRenderer`.
2. **Real Data Only**: No mock, sample, or fixture data reachable in the runtime application. Unknown values display `"Not available"`, never `0` or fake fallbacks.
3. **Honest States**: Every widget handles `loading`, `ready`, `refreshing`, `empty`, `not_connected`, `error`, and `stale` driven by `data.status`.
4. **Theme Alignment**: Color and fonts adhere to Amethyst semantic theme tokens via `--widget-*` CSS variables without hardcoded hex or gradients.
5. **One Widget Per Commit**: The loop processes one widget at a time from prompt generation to parity verification, test passage, and changelog update.
6. **Permission Gate**: Any action that writes routes strictly through `backend/security/confirmation.py`.

---

## 3. Architecture & Package Foundation (Step 0)

### 3.1 Dependencies
- Install `@tugan/widgets` in `frontend/package.json`.
- Add `import "@tugan/widgets/styles.css";` once in `frontend/src/main.jsx`.
- Verify build compatibility with React 19 (`npm run build --prefix frontend`).

### 3.2 Master Prompt Repository
Create `widget-prompts/_shared.md` holding the verbatim **Shared Baseline** and **Production Rules** specified in `WIDGET_LOOP.md`. For each widget and size, construct `widget-prompts/<widget-id>-<size>.md`.

---

## 4. File Layout per Widget

Each widget produces artifacts in two locations:

```text
widgets/<widget-id>/
  template.txt            # Unchanged template copied from playground
  data.fixture.json       # Sample playground payload (for tests/dev only)
  meta.json               # Design spec, chosen variant, prompt metadata
  wiring.md               # Field, action, and status trace tables

frontend/src/dashboard/widgets/
  <WidgetName>.jsx        # Pure adapter + WidgetRenderer component
```

### 4.1 Widget Component Blueprint

```jsx
import { useMemo } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { useTheme } from '../theme.js'
import template from '../../../widgets/<widget-id>/template.txt?raw'

export default function Widget({ data, onAction }) {
  const theme = useTheme()
  
  const widgetData = useMemo(() => {
    return adaptPayload(data)
  }, [data])

  return (
    <WidgetRenderer
      template={template}
      data={widgetData}
      theme={theme}
      onAction={onAction}
    />
  )
}
```

---

## 5. Scope & Widget Specifications

### 5.1 `glance.air` (Air Quality)
- **Source:** Open-Meteo Air Quality API via `backend/dashboard/weather.py`.
- **Payload:** `european_aqi`, `pm2_5`, `pm10`, `time`.
- **States:** `loading`, `ready`, `refreshing`, `error`, `stale`, `empty` (when location unset).
- **Actions:** Display only; refresh on trigger.

### 5.2 `glance.sun` (Sunrise & Sunset)
- **Source:** Open-Meteo via `backend/dashboard/weather.py`.
- **Payload:** `sunrise`, `sunset`, `timezone`.
- **States:** `loading`, `ready`, `refreshing`, `error`, `stale`, `empty`.
- **Actions:** Display only.

### 5.3 `glance.weather` (Weather)
- **Source:** Open-Meteo via `backend/dashboard/weather.py`.
- **Payload:** `temperature`, `humidity`, `feels_like`, `wind_speed`, `precipitation`, `weather_code`, `hours` (hourly forecast), `days` (daily forecast), `rain_alert`.
- **States:** `loading`, `ready`, `refreshing`, `error`, `stale`, `empty`.
- **Actions:** Refresh, switch forecast view (local visual state).

### 5.4 `glance.travel` (Travel Time to Next Event)
- **Source:** Google Maps via Composio + calendar event from `backend/dashboard/travel.py`.
- **Payload:** `items` (route summary, duration, destination event), `timezone`, `set_location`.
- **States:** `loading`, `ready`, `refreshing`, `not_connected` (Composio missing), `empty` (no upcoming event with location), `error`, `stale`.
- **Actions:** Save origin address, refresh estimate.

### 5.5 `glance.next-event` (Next Event Countdown)
- **Source:** Google Calendar via Composio (`backend/dashboard/agenda.py`).
- **Payload:** `items` (title, start, end, location, all_day), `timezone`, `limited`.
- **States:** `loading`, `ready`, `refreshing`, `not_connected`, `empty` (no events), `error`, `stale`.
- **Actions:** Display only; open calendar detail.

---

## 6. Playground Generation Workflow

For each widget and size:
1. Assemble master prompt: `_shared.md` + widget part.
2. Navigate to `https://widgets.gan.dev/playground` using browser automation (`cua-driver`).
3. Paste prompt into prompt box and click **Generate**.
4. Review generated preview against Production Rules (reject hex colors, `RunInterval`, multiple layouts).
5. Copy TEMPLATE editor contents to `widgets/<widget-id>/template.txt`.
6. Copy DATA editor contents to `widgets/<widget-id>/data.fixture.json`.
7. Capture Save PNG reference for parity testing.

---

## 7. Verification & Definition of Done

Each widget is complete only when:
- [ ] Runtime code search confirms 0 fixture imports or hardcoded fake values.
- [ ] `widgets/<widget-id>/wiring.md` fully documents fields, actions, and status mapping.
- [ ] Widget runs successfully against live backend payload.
- [ ] Parity verified against playground PNG across light and dark themes.
- [ ] `npm run build --prefix frontend` and `oxlint` pass cleanly.
- [ ] `pytest tests/test_dashboard_shell.py -q` passes.
- [ ] Entry added to `docs/dashboard-changelog.md`.
