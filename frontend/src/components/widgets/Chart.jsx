import { useEffect, useRef } from 'react'
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
} from 'chart.js'

/* Chart.js, registered piecemeal.
 *
 * `chart.js/auto` pulls every controller, scale and plugin the library has;
 * three chart types need eleven of them, and the rest is bundle nobody asked
 * for. Registering by hand is the difference between a widget and a download. */
ChartJS.register(
  BarController, BarElement, LineController, LineElement, ScatterController,
  PointElement, CategoryScale, LinearScale, Tooltip, Legend,
)

/* The series palette. Deliberately not the accent colour repeated at different
   opacities: series have to be told apart, and lightness alone does not do that
   for anyone reading in greyscale or with a colour vision deficiency. */
const COLOURS = ['#8b6ff5', '#3fb6a8', '#e2a03f', '#d96d8a', '#5b8ff9', '#9aa3ad']

/* Chart.js reads CSS colours once, at draw time, so the theme has to be sampled
   from the document rather than hard-coded -- otherwise a chart drawn in dark
   mode keeps its light-mode gridlines until something else forces a redraw. */
function themeColours() {
  const style = getComputedStyle(document.documentElement)
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback
  return {
    text: pick('--text-dim', '#8a8f98'),
    grid: pick('--hairline', 'rgba(140,140,150,0.18)'),
  }
}

export default function Chart({ data }) {
  const canvas = useRef(null)
  const chart = useRef(null)

  useEffect(() => {
    if (!canvas.current) return undefined
    const { text, grid } = themeColours()
    const scatter = data.type === 'scatter'

    chart.current = new ChartJS(canvas.current, {
      type: data.type,
      data: {
        labels: data.labels ?? [],
        datasets: (data.series ?? []).map((s, i) => ({
          label: s.name,
          // A scatter plot's points are (x, y) pairs, not values against a
          // category axis -- handing it the bare numbers draws every point at
          // x=0. The label index is the x it is missing.
          data: scatter
            ? (s.data ?? []).map((y, x) => ({ x, y }))
            : (s.data ?? []),
          borderColor: COLOURS[i % COLOURS.length],
          backgroundColor: COLOURS[i % COLOURS.length],
          borderWidth: 2,
          pointRadius: data.type === 'line' ? 2 : 4,
          tension: 0.25,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          // One series needs no key; more than one does.
          legend: { display: (data.series ?? []).length > 1, labels: { color: text, boxWidth: 10 } },
        },
        scales: {
          x: {
            type: scatter ? 'linear' : 'category',
            ticks: {
              color: text,
              // A scatter's x is an index into `labels`; show the label.
              callback: scatter
                ? (v) => (data.labels ?? [])[v] ?? v
                : undefined,
            },
            grid: { color: grid },
          },
          y: { ticks: { color: text }, grid: { color: grid } },
        },
      },
    })

    return () => {
      chart.current?.destroy()
      chart.current = null
    }
  }, [data])

  return (
    <div className="widget widget-chart">
      <div className="widget-canvas">
        <canvas ref={canvas} />
      </div>
    </div>
  )
}
