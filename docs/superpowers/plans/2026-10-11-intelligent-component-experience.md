# Intelligent Component Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Amethyst's component usage into an intelligent end-to-end experience by equipping the backend agent to autonomously route between native widgets and generative sandboxed UI, while equipping frontend components (especially Itinerary) with bidirectional map-feed synchronization and interactive filtering.

**Architecture:** A dual-tier presentation architecture where Jev/Director directs structured needs to native widget envelopes (`itinerary`, `comparison`, `recipe`, `step_guide`, `quiz`, `chart`) and custom programmatic tools to `generate_sandboxed_ui`. The frontend components subscribe to bidirectional state so user interactions in the feed seamlessly pan, highlight, and filter Leaflet map layers, and marker clicks center feed cards.

**Tech Stack:** Python 3.12 (FastAPI, Pytest), React 19, Leaflet 1.9, Vanilla CSS (tokens per AGENTS.md).

**Spec:** [docs/superpowers/specs/2026-10-11-intelligent-component-experience-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-11-intelligent-component-experience-design.md)

## Global Constraints

- Never break Leaflet lifecycle safety: no `map.remove()` without defensive try/catch, and container `_leaflet_id` must be cleared on unmount.
- Token and design fidelity per AGENTS.md: Use `--canvas`, `--surface`, `--accent`, `--hairline`, `--font-sans`, `--font-mono`. No ad-hoc hex values.
- Animation constraints: Transitions over keyframes, durations under 140ms for press/hover, 400-600ms for camera pan, respect `prefers-reduced-motion`.
- All tests must pass: `tests/test_jev.py`, `tests/test_widgets.py`, `npm run test:widgets`, `npm run test:renderers`, `npx oxlint`.

## Review Focus

1. **Stale Leaflet Popup or FlyTo on quick unmount:** Ensure `mapRef.current` exists and is mounted before triggering `flyTo` or `openPopup`.
2. **Missing Lat/Lng on itinerary stops:** Verify filtering `Number.isFinite(stop.latitude)` prevents errors when pinning or zooming.
3. **Empty or Malformed Widget Payloads:** Verify `parseWidgetEnvelope` gracefully rejects invalid JSON without throwing errors.
4. **Theme mode toggle while map active:** Verify Carto tile layer swaps cleanly between Voyager (light) and Dark All (dark) via `setUrl()`.
5. **Jev fallback on API timeout:** Verify `classify_presentation` gracefully falls back to `_local_heuristic` in sub-millisecond time if the external API is unreachable.

---

### Task 1: Backend Jev Routing Taxonomy & Heuristics

**Files:**
- Modify: `backend/agent/jev.py:25-90`
- Test: `tests/test_jev.py`

**Interfaces:**
- Produces: `classify_presentation(messages: list[dict] | str) -> str` supporting `comparison`, `recipe`, `step_guide`, `quiz`, `itinerary`, `calculator`, `simulation`, `diagram`, `chart`, `table`, `text`.

- [x] **Step 1: Write the failing test in `tests/test_jev.py`**

```python
import pytest
from backend.agent.jev import classify_presentation, ALLOWED_PRESENTATIONS

@pytest.mark.asyncio
async def test_jev_classifies_expanded_presentations():
    assert "comparison" in ALLOWED_PRESENTATIONS
    assert "recipe" in ALLOWED_PRESENTATIONS
    assert "step_guide" in ALLOWED_PRESENTATIONS
    assert "quiz" in ALLOWED_PRESENTATIONS

    assert await classify_presentation("Compare React vs Svelte vs Vue") == "comparison"
    assert await classify_presentation("Recipe for sourdough bread with ingredients and steps") == "recipe"
    assert await classify_presentation("Step by step guide to install Docker on Debian") == "step_guide"
    assert await classify_presentation("Quiz me on world capitals trivia") == "quiz"
    assert await classify_presentation("Plan a 4-day road trip from SF to LA") == "itinerary"
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_jev.py -v`
Expected: FAIL on `assert "comparison" in ALLOWED_PRESENTATIONS` or classification result.

- [x] **Step 3: Update `backend/agent/jev.py`**

Add `comparison`, `recipe`, `step_guide`, and `quiz` to `ALLOWED_PRESENTATIONS`.
Expand `_local_heuristic(text: str) -> str` with regex/substring detectors for comparison, recipe, step guide, and quiz before falling back to text.

- [x] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_jev.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add backend/agent/jev.py tests/test_jev.py
git commit -m "feat(agent): expand Jev presentation taxonomy for native widgets"
```

---

### Task 2: Backend Presentation Steering & System Prompt

**Files:**
- Modify: `backend/agent/director.py:145-185`
- Modify: `backend/agent/prompt.py:65-80`
- Test: `tests/test_widgets.py`

**Interfaces:**
- Consumes: Jev decisions from Task 1.
- Produces: `VISUALIZATION_STEER_INSTRUCTIONS` mapping each presentation decision to either a native widget envelope instruction or `generate_sandboxed_ui`.

- [x] **Step 1: Write the failing test in `tests/test_widgets.py`**

```python
from backend.agent.director import VISUALIZATION_STEER_INSTRUCTIONS

def test_visualization_steer_instructions_coverage():
    assert "itinerary" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "amethyst:widget" in VISUALIZATION_STEER_INSTRUCTIONS["itinerary"]
    assert "comparison" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "recipe" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "step_guide" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "quiz" in VISUALIZATION_STEER_INSTRUCTIONS
    assert "generate_sandboxed_ui" in VISUALIZATION_STEER_INSTRUCTIONS["calculator"]
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_widgets.py::test_visualization_steer_instructions_coverage -v`
Expected: FAIL on missing keys or instruction wording.

- [x] **Step 3: Implement steering in `director.py` and `prompt.py`**

In `backend/agent/director.py`:
- Update `VISUALIZATION_STEER_INSTRUCTIONS`:
  - `itinerary`: Direct model to output native ````amethyst:widget```` envelope with `{type: "itinerary", data: {...}}`.
  - `comparison`: Direct model to output native ````amethyst:widget```` envelope with `{type: "comparison", data: {...}}`.
  - `recipe`: Direct model to output native ````amethyst:widget```` envelope with `{type: "recipe", data: {...}}`.
  - `step_guide`: Direct model to output native ````amethyst:widget```` envelope with `{type: "step_guide", data: {...}}`.
  - `quiz`: Direct model to output native ````amethyst:widget```` envelope with `{type: "quiz", data: {...}}`.
  - Keep `calculator`, `simulation`, `diagram` directed to `generate_sandboxed_ui`.

In `backend/agent/prompt.py`:
- Under `# Interactive UI`, document the dual-tier pattern: native widget envelope for structured domain content vs `generate_sandboxed_ui` for live interactive computation tools.

- [x] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_widgets.py -v`
Expected: PASS (all 62 tests pass)

- [x] **Step 5: Commit**

```bash
git add backend/agent/director.py backend/agent/prompt.py tests/test_widgets.py
git commit -m "feat(agent): steer native widget envelopes and generative sandboxed UI"
```

---

### Task 3: Bidirectional Map & Feed Synchronization in Itinerary Widget

**Files:**
- Modify: `frontend/src/components/widgets/Itinerary.jsx`
- Modify: `frontend/src/components/widgets/itinerary.css`
- Test: `frontend/tests/renderers.mjs`

**Interfaces:**
- Consumes: `stops`, `allStops`, `data.days`.
- Produces: Bidirectional focus synchronization between Leaflet markers and day stop cards, plus group/day filter dropdown.

- [x] **Step 1: Write the failing / validating assertions in `frontend/tests/renderers.mjs`**

Add renderer assertions in `frontend/tests/renderers.mjs` to ensure interactive attributes (`data-stop-index`, `data-day-num`, `itinerary-stop-interactive`, day filter pills) render properly in static SSR markup without throwing.

- [x] **Step 2: Run test to verify it fails or runs**

Run: `npm run test:renderers`
Expected: Confirmed baseline status.

- [x] **Step 3: Implement Bidirectional State & Interactivity in `Itinerary.jsx` and `itinerary.css`**

In `frontend/src/components/widgets/Itinerary.jsx`:
1. Add `focusedStop` state in `Itinerary` component:
   `const [focusedStop, setFocusedStop] = useState(null)`
   Passed down to `Map` as `focusedStop` prop, with `onSelectStop={(stop) => setFocusedStop(stop)}`.
2. In `Map`:
   - Store marker instances in a ref `markersMapRef = useRef(new Map())`.
   - Key markers by stop coordinates/index.
   - When marker is clicked, trigger `onSelectStop(stop)`.
   - When `focusedStop` changes:
     - If `focusedStop` has coordinates, smoothly pan:
       `mapRef.current.flyTo([focusedStop.latitude, focusedStop.longitude], Math.max(mapRef.current.getZoom(), 13), { duration: 0.5 })`
     - Open the marker popup for `focusedStop`.
3. In `Itinerary` feed:
   - Make each stop row in the day feed clickable with hover state.
   - On click or hover of a stop row, call `setFocusedStop(stop)`.
   - When a stop is clicked from the map, scroll it into view:
     Find element via `id={`itinerary-stop-${dayIdx}-${stopIdx}`}` and call `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
4. Interactive Day Filter:
   - Turn the overlay pill `"All groups ▼"` into an active filter dropdown/popover:
     Allows selecting `"All stops"`, `"Day 1"`, `"Day 2"`, etc.
     Filters the map route and markers to only the selected day.
5. In `frontend/src/components/widgets/itinerary.css`:
   - Add styles for `.itinerary-stop-interactive`, `.is-active-stop`, marker pulse glow `.itinerary-pin.is-active`, and filter popover `.itinerary-map-filter-menu`.

- [x] **Step 4: Verify with tests and linter**

Run: `npm run test:widgets && npm run test:renderers && npx oxlint src/components/widgets/Itinerary.jsx`
Expected: 0 errors, 0 warnings, all tests pass.

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/widgets/Itinerary.jsx frontend/src/components/widgets/itinerary.css frontend/tests/renderers.mjs
git commit -m "feat(ui): add bidirectional map-feed sync and day filtering in Itinerary"
```

---

### Task 4: Reactive Customizer & End-to-End Verification

**Files:**
- Modify: `frontend/src/components/widgets/Itinerary.jsx`
- Modify: `frontend/src/components/widgets/itinerary.css`

- [x] **Step 1: Implement instant reactive feedback on customizer controls**

In `frontend/src/components/widgets/Itinerary.jsx`:
- Add instant badge preview to the customizer card showing selected parameters.
- Provide a clear status indicator when "Customize my road trip" is triggered.
- Ensure all inputs and buttons follow AGENTS.md design tokens: capsule buttons, `--radius-inputs`, `--accent` highlights.

- [x] **Step 2: Run full automated verification suite**

Run:
```bash
.venv/bin/pytest tests/test_jev.py tests/test_widgets.py -v
npm --prefix frontend run test:widgets
npm --prefix frontend run test:renderers
npx --prefix frontend oxlint src/components/widgets/Itinerary.jsx
npm --prefix frontend run build
```
Expected: All tests pass, linter passes with 0 warnings, Vite production build succeeds.

- [x] **Step 3: Commit**

```bash
git add frontend/src/components/widgets/Itinerary.jsx frontend/src/components/widgets/itinerary.css
git commit -m "feat(ui): reactive customizer and interactive component enhancements"
```
