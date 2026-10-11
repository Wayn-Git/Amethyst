# Intelligent Component Experience Design Specification

- **Date:** 2026-10-11
- **Status:** Draft / Ready for Review
- **Scope:** End-to-end intelligent component orchestration: backend intent classification & prompt steering (Jev/Director/Prompt) and frontend bidirectional interactivity (Itinerary, Leaflet map-feed synchronization, reactive tailoring).

---

## 1. Problem Statement & Motivation

### 1.1 Model Underutilization of Native UI Components
Amethyst possesses rich, design-token-compliant native widget components:
- `itinerary`: Magazine-grade road trip experience with Leaflet maps, photo mosaics, and day-by-day feeds.
- `comparison`: Multi-item side-by-side spec and feature comparison tables.
- `recipe`: Ingredient checklists, scaled servings, and preparation steps with timers.
- `step_guide`: Numbered sequential tutorial steps with status markers.
- `quiz`: Multiple-choice knowledge evaluations with immediate feedback.
- `chart`: Data visualizations and time-series representations.
- `data_table`: Formatted sortable and filterable data matrices.

However, the agent frequently outputs raw markdown prose or markdown tables for queries that would be drastically more usable as interactive widgets. 
* **Root Cause:** In `backend/agent/prompt.py` and `backend/agent/director.py`, the only steered interactive format communicated to the model is `generate_sandboxed_ui`. Native widgets are only extracted after the turn in `backend/agent/widgets.py` via rigid heuristics, or completely missed. Furthermore, in `backend/agent/director.py`, the `itinerary` steer instructed the model to call `generate_sandboxed_ui` rather than utilizing the existing native itinerary widget.

### 1.2 Disconnected Frontend Components
In `frontend/src/components/widgets/Itinerary.jsx`, the Leaflet route map and the day-by-day stops feed sit side-by-side without communicating:
- Clicking or hovering on a stop in the itinerary feed does not highlight or center the marker on the map.
- Clicking a map marker pin does not scroll to or emphasize the corresponding stop in the feed.
- The map overlay filter ("All groups") is non-interactive.
- The "Let's tailor the trip" customizer at the bottom dispatches a raw chat prompt with zero immediate visual feedback or parameter preview.

---

## 2. Architecture & Component Inventory

The system operates across two complementary tiers:

```
                          ┌─────────────────────────────┐
                          │     User Query / Context    │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │  Jev Presentation Classifier │
                          │     (System One / Fast)      │
                          └──────────────┬──────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │ Tier 1: Native Widget │                       │  Tier 2: Generative   │
     │      Envelopes        │                       │     Sandboxed UI      │
     ├───────────────────────┤                       ├───────────────────────┤
     │ • itinerary           │                       │ • calculator          │
     │ • comparison          │                       │ • simulation (3D/2D)  │
     │ • recipe              │                       │ • diagram             │
     │ • step_guide          │                       │ • custom canvas tool  │
     │ • quiz                │                       └───────────────────────┘
     │ • chart               │
     └───────────────────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │    Frontend Widget Layer    │
                          │ • Bidirectional Map-Feed    │
                          │ • Reactive Customizer       │
                          │ • Token-aligned Visuals     │
                          └─────────────────────────────┘
```

### 2.1 Tier 1: Native Widgets (Deterministic, Fast, Token-Efficient)
- Rendered natively in React using Amethyst's core design tokens (`--canvas`, `--surface`, `--accent`, `--hairline`).
- Transported via fenced envelopes in markdown:
  ````markdown
  ```amethyst:widget
  {
    "type": "itinerary",
    "data": { ... }
  }
  ```
  ````
- Zero iframe overhead, instant rendering, theme-reactive, and accessible.

### 2.2 Tier 2: Generative Sandboxed UI (Arbitrary Interactive Code)
- Reserved for user requests requiring live stateful logic that does not fit a standard schema:
  - Custom financial calculators (mortgage, compound interest, split bill).
  - 3D models and simulations (Three.js, physics canvas).
  - Custom interactive SVG diagrams and animations.
- Generated via the `generate_sandboxed_ui` tool and executed within an isolated `<iframe>`.

---

## 3. Backend Specification

### 3.1 Taxonomy & Heuristics (`backend/agent/jev.py`)
Expand `ALLOWED_PRESENTATIONS` to include the full spectrum:
```python
ALLOWED_PRESENTATIONS = {
    "text",
    "table",
    "chart",
    "calculator",
    "diagram",
    "simulation",
    "itinerary",
    "comparison",
    "recipe",
    "step_guide",
    "quiz",
}
```

Update `_local_heuristic(text)` to accurately detect:
- `comparison`: "vs", "versus", "compare", "differences between", "which is better", "pros and cons of".
- `recipe`: "recipe", "how to bake", "how to cook", "ingredients for", "cocktail recipe".
- `step_guide`: "step by step guide", "how to install", "how to set up", "tutorial", "instructions to".
- `quiz`: "quiz me", "trivia", "test my knowledge", "practice questions".
- `itinerary`: "itinerary", "road trip", "travel route", "trip plan", "coastal map", "sf to la", "highway 1".

### 3.2 Dynamic Presentation Steering (`backend/agent/director.py`)
Refine `VISUALIZATION_STEER_INSTRUCTIONS`:
- For `itinerary`:
  `"PRESENTATION STEER: The user is planning a trip or route. Provide a concise intro (1-2 sentences), then output a complete native itinerary widget using ```amethyst:widget containing {type: 'itinerary', data: {...}} with days, stops (including coordinates when known), driving times, and practical tips. Do not output a plain markdown list."`
- For `comparison`:
  `"PRESENTATION STEER: The user wants a comparison. Provide a concise summary, then output a native comparison widget using ```amethyst:widget containing {type: 'comparison', data: {items: [...], criteria: [...]}}."`
- For `recipe`:
  `"PRESENTATION STEER: The user wants a recipe. Provide a brief culinary intro, then output a native recipe widget using ```amethyst:widget containing {type: 'recipe', data: {servings, ingredients, steps}}."`
- For `quiz` and `step_guide`:
  Steer toward their respective native envelopes.
- For `calculator`, `simulation`, `diagram`:
  Steer toward `generate_sandboxed_ui` with live inputs and theme variable bindings.

### 3.3 Prompt Instructions (`backend/agent/prompt.py`)
In `BASE_PROMPT` under `# Interactive UI`:
- Teach the model the two-tier principle:
  1. If structured data fits a standard presentation (`itinerary`, `comparison`, `recipe`, `step_guide`, `quiz`, `chart`), emit the native ````amethyst:widget```` envelope.
  2. If the user requires a bespoke interactive calculating tool, 3D simulation, or custom visual app, call `generate_sandboxed_ui`.
- Enforce the presentation tone:
  - Lead with the answer or brief scene-setter.
  - Deliver the component.
  - Follow with at most 1–2 actionable next steps or caveats. Never narrate the widget line-by-line.

---

## 4. Frontend Specification: Bidirectional Component Sync

### 4.1 State & Interaction Protocol in `Itinerary.jsx`

#### A. Active Stop Selection & Sync
1. **Feed → Map Interaction**:
   - Each stop in `itinerary-day-row` gains an interactive focus card.
   - When clicked or hovered:
     - The map smoothly navigates: `map.flyTo([lat, lng], 14, { duration: 0.6 })` (or `panTo` if already in close bounds).
     - The corresponding marker's Leaflet popup opens.
     - The marker icon receives an active pulse ring (`.itinerary-pin.is-active`).
     - The stop card highlights with a subtle `--accent-soft` ground and `--accent` indicator.

2. **Map → Feed Interaction**:
   - When a user clicks a Leaflet marker:
     - The stop's DOM card is located via `data-stop-id` or ref.
     - The page smoothly scrolls the card into center view:
       `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
     - The stop row flashes a brief 800ms accent ring animation to indicate focus.

#### B. Group / Day Map Filtering
- The overlay pill currently reading `"All groups ▼"` becomes an interactive toggle:
  - Options: `"All Days"`, `"Day 1"`, `"Day 2"`, ...
  - Selecting a day:
    - Filters the visible map markers to that day's stops.
    - Highlights that day's specific polyline segment.
    - Fits the map bounds to that day's stops.
    - Scrolls the feed to that day.

#### C. Reactive Customizer
- When the user selects choices in "Let's tailor the trip":
  - Active radio cards gain an instant selected border and checkmark indicator.
  - The submit button ("Customize my road trip") previews the action dynamically.

---

## 5. Aesthetics & Design Tokens (AGENTS.md Compliance)

- **Typography**:
  - UI labels and headings: `--font-sans` (Inter / OpenAI Sans fallback).
  - Numbers, mileage, and driving durations: `--font-mono` (Geist Mono).
- **Colors**:
  - Backgrounds: `--canvas`, `--surface`, `--surface-2`.
  - Borders: hairline `--hairline` (`rgba(255,255,255,0.08)` dark / `rgba(0,0,0,0.08)` light).
  - Accent highlights: `var(--accent)`, `var(--accent-soft)`, `var(--accent-wash)`. Never hardcoded hexes.
- **Motion**:
  - Smooth camera pan duration: 400ms–600ms using `--ease-out`.
  - Micro-interactions (hover, press, pulse): 120ms (`--press`).
  - Strict support for `@media (prefers-reduced-motion: reduce)`.

---

## 6. Verification & Test Plan

1. **Backend Tests**:
   - `tests/test_jev.py`: Verify that queries for comparisons, recipes, itineraries, and calculators correctly classify into their respective categories under both local heuristics and mocked TypeSafe responses.
   - `tests/test_widgets.py`: Verify that generated widget envelopes for all types validate cleanly and produce correct JSON payloads.

2. **Frontend Tests**:
   - `npm run test:widgets`: Ensure all widget envelopes parse correctly.
   - `npm run test:renderers`: Ensure all renderers build cleanly and render static HTML markup.
   - `oxlint`: Clean pass on `Itinerary.jsx` and all modified files with 0 errors and 0 warnings.
   - `npm run build`: Clean production bundle compile.

3. **Runtime Smoke Verification**:
   - Test queries:
     - "Plan a 4-day coastal trip from San Francisco to Los Angeles" -> renders rich `itinerary` widget with working bidirectional map clicks.
     - "Compare Vite vs Webpack vs Turbopack" -> renders native `comparison` widget.
     - "Interactive mortgage payment calculator" -> invokes `generate_sandboxed_ui`.
