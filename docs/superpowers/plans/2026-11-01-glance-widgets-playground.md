# Glance Widgets Playground Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining 5 Glance widgets (`glance.air`, `glance.sun`, `glance.weather`, `glance.travel`, `glance.next-event`) strictly according to `docs/widget-playground/WIDGET_LOOP.md` using `@tugan/widgets` WidgetRenderer.

**Architecture:** Install `@tugan/widgets` as the generative UI runtime. For each widget, construct master prompts from the shared baseline, drive the playground (`https://widgets.gan.dev/playground`) to generate the template and fixture, save widget artifacts under `widgets/<widget-id>/`, build a pure adapter that maps real backend payloads to the template contract, and render via `<WidgetRenderer />`.

**Tech Stack:** React 19, `@tugan/widgets`, Vite, FastAPI backend, Open-Meteo, Composio (Google Calendar & Google Maps).

**Spec:** `docs/superpowers/specs/2026-11-01-glance-widgets-playground-design.md`

## Global Constraints

- **No hand-rolled UI**: Never re-create widgets by hand in bespoke React/CSS. All widget visuals are defined by playground templates rendered with `WidgetRenderer`.
- **Zero Mock Data**: No fixture or mock data may be reachable at runtime in the app. Unknown values display `"Not available"`, never `0` or fake fallbacks.
- **Honest States**: Every widget must support `loading`, `ready`, `refreshing`, `empty`, `not_connected`, `error`, and `stale` driven by `data.status`.
- **One Widget Per Commit**: Process widgets sequentially; each widget loop ends with tests passing and a dedicated commit.
- **Permission Gate**: Writes must pass through `backend/security/confirmation.py`.

## Review Focus

1. **Missing Location for Weather/Air/Sun**: Returns `set_location: True`; adapter must map this to `status: "empty"` with clear copy rather than crashing.
2. **Missing Connector for Calendar/Travel**: Returns `SourceUnavailable`; adapter must map to `status: "not_connected"` with Connect action.
3. **No Upcoming Events with Locations for Travel**: Empty items array; adapter must map to `status: "empty"` ("No upcoming event with a location").
4. **Timezone Shifts on Open-Meteo Sun Times**: Wall times must be preserved without parsing as local browser Date (which shifts hours).
5. **Memoized Data Reference**: `data` passed to `WidgetRenderer` must be memoized with `useMemo` to prevent resetting widget state on every render.

---

### Task 1: Foundation (Step 0) - Install `@tugan/widgets` & Create Shared Prompts

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/main.jsx`
- Create: `widget-prompts/_shared.md`

**Interfaces:**
- Consumes: None
- Produces: `@tugan/widgets` available in frontend; `widget-prompts/_shared.md` available for prompt generation.

- [ ] **Step 1: Install `@tugan/widgets` in frontend**
Run: `npm install @tugan/widgets --prefix frontend`

- [ ] **Step 2: Import `@tugan/widgets/styles.css` in `frontend/src/main.jsx`**
Add `import "@tugan/widgets/styles.css";` to `frontend/src/main.jsx`.

- [ ] **Step 3: Create `widget-prompts/_shared.md`**
Extract the verbatim Shared Baseline and Production Rules blocks from `docs/widget-playground/WIDGET_LOOP.md`.

- [ ] **Step 4: Verify frontend builds cleanly**
Run: `npm run build --prefix frontend`
Expected: Build passes without module resolution or React 19 compatibility errors.

- [ ] **Step 5: Commit Step 0**
```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.jsx widget-prompts/_shared.md
git commit -m "feat(dashboard): setup @tugan/widgets renderer and shared playground prompts"
```

---

### Task 2: Widget Loop 1 — `glance.air` (Air Quality)

**Files:**
- Create: `widget-prompts/glance.air-s.md`
- Create: `widgets/glance.air/template.txt`
- Create: `widgets/glance.air/data.fixture.json`
- Create: `widgets/glance.air/meta.json`
- Create: `widgets/glance.air/wiring.md`
- Create: `frontend/src/dashboard/widgets/AirQuality.jsx`
- Modify: `frontend/src/dashboard/registry.js`
- Modify: `docs/dashboard-changelog.md`

**Interfaces:**
- Consumes: `GET /api/widgets/glance.air/data` (`european_aqi`, `pm2_5`, `pm10`, `time`)
- Produces: `glance.air` rendered with `WidgetRenderer`

- [ ] **Step 1: Write `widget-prompts/glance.air-s.md`**
Assemble `_shared.md` + widget prompt for `glance.air` (purpose: European AQI, PM2.5, PM10).

- [ ] **Step 2: Generate via Playground and capture artifacts**
Navigate to `https://widgets.gan.dev/playground`, generate template, and save:
- `widgets/glance.air/template.txt`
- `widgets/glance.air/data.fixture.json`
- `widgets/glance.air/meta.json`
- `widgets/glance.air/wiring.md`

- [ ] **Step 3: Implement `frontend/src/dashboard/widgets/AirQuality.jsx`**
Implement adapter converting backend `european_aqi`, `pm2_5`, `pm10` into template `data` and render `WidgetRenderer`.

- [ ] **Step 4: Register in `frontend/src/dashboard/registry.js`**
Update `glance.air` to lazy import `AirQuality.jsx`.

- [ ] **Step 5: Verify zero mock data, parity, lint, and build**
Verify no fixtures imported in `AirQuality.jsx`. Run `npm run lint --prefix frontend` and `npm run build --prefix frontend`.

- [ ] **Step 6: Update changelog and commit**
```bash
git add widgets/glance.air/ widget-prompts/glance.air-s.md frontend/src/dashboard/widgets/AirQuality.jsx frontend/src/dashboard/registry.js docs/dashboard-changelog.md
git commit -m "feat(dashboard): migrate glance.air to @tugan/widgets playground loop"
```

---

### Task 3: Widget Loop 2 — `glance.sun` (Sunrise & Sunset)

**Files:**
- Create: `widget-prompts/glance.sun-s.md`
- Create: `widgets/glance.sun/template.txt`
- Create: `widgets/glance.sun/data.fixture.json`
- Create: `widgets/glance.sun/meta.json`
- Create: `widgets/glance.sun/wiring.md`
- Create: `frontend/src/dashboard/widgets/Sun.jsx`
- Modify: `frontend/src/dashboard/registry.js`
- Modify: `docs/dashboard-changelog.md`

**Interfaces:**
- Consumes: `GET /api/widgets/glance.sun/data` (`sunrise`, `sunset`, `timezone`)
- Produces: `glance.sun` rendered with `WidgetRenderer`

- [ ] **Step 1: Write `widget-prompts/glance.sun-s.md`**
Assemble prompt for sunrise and sunset times.

- [ ] **Step 2: Generate via Playground and capture artifacts**
Save `widgets/glance.sun/template.txt`, `data.fixture.json`, `meta.json`, `wiring.md`.

- [ ] **Step 3: Implement `frontend/src/dashboard/widgets/Sun.jsx`**
Adapter extracts wall clock times without zone conversion and supplies `WidgetRenderer`.

- [ ] **Step 4: Register in `frontend/src/dashboard/registry.js`**
Point `glance.sun` to `Sun.jsx`.

- [ ] **Step 5: Verify zero mock data, lint, build, and tests**
Run `npm run lint --prefix frontend` and `npm run build --prefix frontend`.

- [ ] **Step 6: Update changelog and commit**
```bash
git add widgets/glance.sun/ widget-prompts/glance.sun-s.md frontend/src/dashboard/widgets/Sun.jsx frontend/src/dashboard/registry.js docs/dashboard-changelog.md
git commit -m "feat(dashboard): migrate glance.sun to @tugan/widgets playground loop"
```

---

### Task 4: Widget Loop 3 — `glance.weather` (Weather)

**Files:**
- Create: `widget-prompts/glance.weather-m.md`
- Create: `widgets/glance.weather/template.txt`
- Create: `widgets/glance.weather/data.fixture.json`
- Create: `widgets/glance.weather/meta.json`
- Create: `widgets/glance.weather/wiring.md`
- Create: `frontend/src/dashboard/widgets/WeatherGlance.jsx`
- Modify: `frontend/src/dashboard/registry.js`
- Modify: `docs/dashboard-changelog.md`

**Interfaces:**
- Consumes: `GET /api/widgets/glance.weather/data` (`temperature`, `humidity`, `feels_like`, `precipitation`, `weather_code`, `hours`, `days`, `rain_alert`)
- Produces: `glance.weather` rendered with `WidgetRenderer`

- [ ] **Step 1: Write `widget-prompts/glance.weather-m.md`**
Assemble prompt for weather with temperature and hourly forecast.

- [ ] **Step 2: Generate via Playground and capture artifacts**
Save `widgets/glance.weather/template.txt`, `data.fixture.json`, `meta.json`, `wiring.md`.

- [ ] **Step 3: Implement `frontend/src/dashboard/widgets/WeatherGlance.jsx`**
Build adapter for weather conditions, temperature, and hourly forecast; render `WidgetRenderer`.

- [ ] **Step 4: Register in `frontend/src/dashboard/registry.js`**
Point `glance.weather` to `WeatherGlance.jsx`.

- [ ] **Step 5: Verify zero mock data, lint, build, and tests**
Run `npm run lint --prefix frontend` and `npm run build --prefix frontend`.

- [ ] **Step 6: Update changelog and commit**
```bash
git add widgets/glance.weather/ widget-prompts/glance.weather-m.md frontend/src/dashboard/widgets/WeatherGlance.jsx frontend/src/dashboard/registry.js docs/dashboard-changelog.md
git commit -m "feat(dashboard): migrate glance.weather to @tugan/widgets playground loop"
```

---

### Task 5: Widget Loop 4 — `glance.travel` (Travel Time to Next Event)

**Files:**
- Create: `widget-prompts/glance.travel-m.md`
- Create: `widgets/glance.travel/template.txt`
- Create: `widgets/glance.travel/data.fixture.json`
- Create: `widgets/glance.travel/meta.json`
- Create: `widgets/glance.travel/wiring.md`
- Create: `frontend/src/dashboard/widgets/TravelGlance.jsx`
- Modify: `frontend/src/dashboard/registry.js`
- Modify: `docs/dashboard-changelog.md`

**Interfaces:**
- Consumes: `GET /api/widgets/glance.travel/data` (`items`, `timezone`, `set_location`)
- Produces: `glance.travel` rendered with `WidgetRenderer`

- [ ] **Step 1: Write `widget-prompts/glance.travel-m.md`**
Assemble prompt for travel duration and next event destination.

- [ ] **Step 2: Generate via Playground and capture artifacts**
Save `widgets/glance.travel/template.txt`, `data.fixture.json`, `meta.json`, `wiring.md`.

- [ ] **Step 3: Implement `frontend/src/dashboard/widgets/TravelGlance.jsx`**
Adapter handles route duration, destination event name, `not_connected`, and `empty` states.

- [ ] **Step 4: Register in `frontend/src/dashboard/registry.js`**
Point `glance.travel` to `TravelGlance.jsx`.

- [ ] **Step 5: Verify zero mock data, lint, build, and tests**
Run `npm run lint --prefix frontend` and `npm run build --prefix frontend`.

- [ ] **Step 6: Update changelog and commit**
```bash
git add widgets/glance.travel/ widget-prompts/glance.travel-m.md frontend/src/dashboard/widgets/TravelGlance.jsx frontend/src/dashboard/registry.js docs/dashboard-changelog.md
git commit -m "feat(dashboard): migrate glance.travel to @tugan/widgets playground loop"
```

---

### Task 6: Widget Loop 5 — `glance.next-event` (Next Event Countdown)

**Files:**
- Create: `widget-prompts/glance.next-event-s.md`
- Create: `widgets/glance.next-event/template.txt`
- Create: `widgets/glance.next-event/data.fixture.json`
- Create: `widgets/glance.next-event/meta.json`
- Create: `widgets/glance.next-event/wiring.md`
- Create: `frontend/src/dashboard/widgets/NextEventGlance.jsx`
- Modify: `frontend/src/dashboard/registry.js`
- Modify: `docs/dashboard-changelog.md`

**Interfaces:**
- Consumes: `GET /api/widgets/glance.next-event/data` (`items`, `timezone`, `limited`)
- Produces: `glance.next-event` rendered with `WidgetRenderer`

- [x] **Step 1: Write `widget-prompts/glance.next-event-s.md`**
Assemble prompt for next event countdown, title, time, and location.

- [x] **Step 2: Generate via Playground and capture artifacts**
Save `widgets/glance.next-event/template.txt`, `data.fixture.json`, `meta.json`, `wiring.md`.

- [x] **Step 3: Implement `frontend/src/dashboard/widgets/NextEventGlance.jsx`**
Adapter calculates countdown minutes, formats event time strings, and handles `empty` / `not_connected`.

- [x] **Step 4: Register in `frontend/src/dashboard/registry.js`**
Point `glance.next-event` to `NextEventGlance.jsx`.

- [x] **Step 5: Verify zero mock data, lint, build, and tests**
Run `npm run lint --prefix frontend` and `npm run build --prefix frontend`.

- [x] **Step 6: Update changelog and commit**
```bash
git add widgets/glance.next-event/ widget-prompts/glance.next-event-s.md frontend/src/dashboard/widgets/NextEventGlance.jsx frontend/src/dashboard/registry.js docs/dashboard-changelog.md
git commit -m "feat(dashboard): migrate glance.next-event to @tugan/widgets playground loop"
```

---

### Task 7: Parity Verification & Spec Completion

**Files:**
- Modify: `docs/dashboard-spec.md`
- Modify: `docs/agent-context/sections/today.md`
- Modify: `docs/agent-context/components/widget-system.md`

- [x] **Step 1: Run whole-suite parity and verification checks**
Run: `python scripts/check-widget-map.py`
Run: `npm run lint --prefix frontend`
Run: `npm run build --prefix frontend`
Run: `pytest tests/test_dashboard_shell.py -q`

- [x] **Step 2: Update documentation**
Tick Done boxes for the 5 Glance widgets in `docs/dashboard-spec.md`. Update `docs/agent-context/components/widget-system.md`.

- [x] **Step 3: Commit final verification**
```bash
git add docs/dashboard-spec.md docs/agent-context/sections/today.md docs/agent-context/components/widget-system.md
git commit -m "docs(dashboard): mark 5 glance widgets migrated to playground loop"
```

