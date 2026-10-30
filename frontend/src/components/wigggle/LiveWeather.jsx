import { TooltipProvider } from "./vendor/components/ui/tooltip"
import { lazy, Suspense } from 'react'
import { WeatherContext, liveWeather } from './WeatherContext.jsx'
import catalog from './catalog.json'
const modules = import.meta.glob('./vendor/registry/default/widgets/weather/*/*.tsx')
const designs = Object.fromEntries(catalog.filter(row => row.category === 'weather').map(row => [row.id, lazy(modules[row.module])]))
export default function LiveWeather({ data, design = 'weather-md-02' }) {
  const Face = designs[design] || designs['weather-md-02']
  return <WeatherContext.Provider value={liveWeather(data)}><div className="wigggle-live-weather"><Suspense fallback={<p role="status">Loading weather design…</p>}><TooltipProvider><Face /></TooltipProvider></Suspense>{design === 'weather-sm-09' && !data?.daily?.length && <p role="status">No daily forecast is cached. Refresh weather after saving a location.</p>}</div></WeatherContext.Provider>
}
