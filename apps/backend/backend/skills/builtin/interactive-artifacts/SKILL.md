---
name: interactive-artifacts
description: >
  How to create feature-packed, accurate, beautiful interactive visualizations
  as HTML artifacts. Use whenever the user asks for a chart, diagram, graph,
  image of a concept, animation, simulation, or any visual output the agent
  must generate itself.
version: 1.0.0
tags: [artifacts, visualization, html, charts]
---

# Creating interactive HTML artifacts

The HTML panel renders a full sandboxed `<iframe>` — JavaScript runs, CDN
libraries load, Canvas and SVG work. Use this power. A static hand-drawn SVG
is never acceptable when Chart.js, D3, or Plotly can do the job in a fraction
of the code and look far better.

---

## Rule 0 — get the data right first

Before drawing anything, verify the facts:

1. Use `search_web` or `fetch_url` to find the actual values, equations, or
   data you are visualizing. **Never invent numbers.**
2. If the topic is a well-known algorithm or concept (e.g. hill climbing, FFT,
   Dijkstra) — search for the canonical explanation to confirm the shape of the
   graph before coding it.
3. Cite the source inline: add a small `<footer>` or tooltip naming where the
   data came from.

---

## Library selection

| Goal | Library (CDN) |
|------|--------------|
| Line/bar/pie/scatter charts | **Chart.js 4** — `https://cdn.jsdelivr.net/npm/chart.js` |
| Complex data viz, force graphs, hierarchies | **D3 v7** — `https://cdn.jsdelivr.net/npm/d3@7` |
| Scientific / 3-D plots, heatmaps | **Plotly.js** — `https://cdn.plot.ly/plotly-latest.min.js` |
| Math typesetting | **MathJax 3** — `https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js` |
| Diagrams (flowcharts, state machines) | **Mermaid** — `https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js` |

Never roll your own SVG paths or canvas drawing for something these libraries
handle. The output will look amateur and almost certainly be wrong.

---

## Design requirements — every artifact must have all of these

### 1. Dark-mode aware palette
```css
:root {
  --bg: #0f0f13;
  --surface: #1a1a24;
  --border: rgba(255,255,255,0.08);
  --text: #e8e8f0;
  --muted: #8888aa;
  --accent: #8b5cf6;
  --accent2: #06b6d4;
  --accent3: #f59e0b;
}
@media (prefers-color-scheme: light) {
  :root { --bg:#f5f5fa; --surface:#fff; --text:#1a1a2e; --muted:#666; --border:rgba(0,0,0,0.08); }
}
```

### 2. Google Font
Always include Inter:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### 3. Responsive layout
- Use `max-width: 900px; margin: 0 auto;`
- Charts must be inside a `position:relative` container with explicit height

### 4. Hover tooltips on every data point
Chart.js: `interaction.mode: 'index'`, format the tooltip callback with value + units.
D3: use a `<div class="tooltip">` absolutely positioned.

### 5. Animated entrance
Chart.js: `animation: { duration: 800, easing: 'easeOutQuart' }`
D3 / custom: fade in with `opacity` transition over 400–600 ms.

### 6. Legible labels and legend
- Axis labels with units, title at the top
- Legend never overlaps data
- Grid lines: `rgba(255,255,255,0.06)`

### 7. A real title and subtitle in the page itself

---

## Hill climbing — canonical correct shape

For **hill climbing** the curve must show:
- A **smooth non-convex function** with multiple local maxima, a plateau, a
  ridge, and a global maximum
- Annotated points: Start, Plateau, Local Maximum, Global Maximum, Ridge
- An animated agent path showing the algorithm getting **stuck** at the local
  max when starting from the left
- Correct relative heights: global max > local max >> plateau

Good generating function (sample x 0→12 at 0.05 steps):
```js
function f(x) {
  return 2*Math.sin(x*0.8 - 1) + Math.sin(x*2.1)*0.6
       + Math.cos(x*0.3 + 0.5)*1.2 + 0.3*x;
}
```

Do NOT use a plain sine wave — it has no plateau or ridge.

---

## Minimum quality bar

- At least **200 lines** of real HTML/CSS/JS
- Interactive: something changes on hover or click
- Accurate: data matches the real concept
- Polished: dark surface, no default browser styling, Google Font
- Self-contained: one file, all libraries from CDN

---

## Anti-patterns — never do these

| Bad | Good |
|-----|------|
| Hand-drawn `<polygon>` SVG | Chart.js / D3 |
| Invented axis values | Verified equation or searched data |
| Plain white `<body>` | Dark surface with CSS tokens |
| No interactivity | Hover tooltips at minimum |
| `font-family: sans-serif` | Google Fonts Inter |

---

## Template skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TITLE</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f0f13; --surface: #1a1a24; --border: rgba(255,255,255,0.08);
    --text: #e8e8f0; --muted: #8888aa;
    --accent: #8b5cf6; --accent2: #06b6d4; --accent3: #f59e0b;
    --radius: 12px;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif;
         min-height: 100vh; padding: 2rem; }
  .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 1.5rem; }
  h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: .25rem; }
  .subtitle { color: var(--muted); font-size: .875rem; margin-bottom: 1.5rem; }
  .chart-wrap { position: relative; height: 420px; }
</style>
</head>
<body>
<div style="max-width:900px;margin:0 auto">
  <h1>TITLE</h1>
  <p class="subtitle">SUBTITLE</p>
  <div class="card">
    <div class="chart-wrap"><canvas id="chart"></canvas></div>
  </div>
  <footer style="margin-top:1rem;color:var(--muted);font-size:.75rem">Source: SOURCE</footer>
</div>
<script>
  // All visualization logic here
</script>
</body>
</html>
```
