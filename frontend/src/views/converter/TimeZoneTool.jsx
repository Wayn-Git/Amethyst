import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useApp } from '../../store.jsx'

const POPULAR_ZONES = [
  { id: 'UTC', label: 'Coordinated Universal Time', city: 'UTC', region: 'Global' },
  { id: 'America/New_York', label: 'New York (EDT/EST)', city: 'New York', region: 'US East' },
  { id: 'America/Chicago', label: 'Chicago (CDT/CST)', city: 'Chicago', region: 'US Central' },
  { id: 'America/Los_Angeles', label: 'San Francisco (PDT/PST)', city: 'San Francisco', region: 'US West' },
  { id: 'Europe/London', label: 'London (BST/GMT)', city: 'London', region: 'United Kingdom' },
  { id: 'Europe/Paris', label: 'Paris / Berlin (CEST/CET)', city: 'Paris', region: 'Central Europe' },
  { id: 'Asia/Dubai', label: 'Dubai (GST)', city: 'Dubai', region: 'Gulf' },
  { id: 'Asia/Kolkata', label: 'New Delhi / Mumbai (IST)', city: 'New Delhi', region: 'India' },
  { id: 'Asia/Singapore', label: 'Singapore (SGT)', city: 'Singapore', region: 'Southeast Asia' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)', city: 'Tokyo', region: 'Japan' },
  { id: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', city: 'Sydney', region: 'Australia' },
  { id: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)', city: 'Auckland', region: 'New Zealand' },
]

function getFormattedTime(date, timeZone) {
  try {
    const timeStr = date.toLocaleTimeString('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })

    const dateStr = date.toLocaleDateString('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

    // Determine hour in target timezone to check day/night
    const hourPart = date.toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    })
    const hour = parseInt(hourPart, 10)
    const isDay = hour >= 6 && hour < 19

    return { timeStr, dateStr, isDay }
  } catch (err) {
    return { timeStr: 'Invalid Timezone', dateStr: '', isDay: true }
  }
}

export default function TimeZoneTool() {
  const { toast } = useApp()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [baseZone, setBaseZone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  })

  // Format base date for input[type="datetime-local"]
  const dateInputValue = useMemo(() => {
    const d = new Date(selectedDate.getTime() - selectedDate.getTimezoneOffset() * 60000)
    return d.toISOString().slice(0, 16)
  }, [selectedDate])

  const handleDateChange = (valStr) => {
    if (!valStr) return
    const next = new Date(valStr)
    if (!isNaN(next.getTime())) {
      setSelectedDate(next)
    }
  }

  const setNow = () => {
    setSelectedDate(new Date())
    toast('Reset to current time', 'good')
  }

  return (
    <div className="fc-tool-workspace">
      {/* Top Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Date & Time</span>
            <input
              type="datetime-local"
              className="fc-input font-mono w-60"
              value={dateInputValue}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Base Timezone</span>
            <select
              className="fc-select w-64"
              value={baseZone}
              onChange={(e) => setBaseZone(e.target.value)}
            >
              {POPULAR_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          className="fc-btn fc-btn-secondary"
          onClick={setNow}
        >
          <Icon name="clock" size={15} />
          <span>Reset to Now</span>
        </button>
      </div>

      {/* Grid of World Timezones */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {POPULAR_ZONES.map((zone) => {
          const { timeStr, dateStr, isDay } = getFormattedTime(selectedDate, zone.id)
          const isBase = zone.id === baseZone

          return (
            <div
              key={zone.id}
              className={`p-4 rounded-xl border transition flex flex-col justify-between gap-2 ${
                isBase
                  ? 'bg-violet-950/20 border-violet-800/60 shadow-sm'
                  : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-white text-base flex items-center gap-1.5">
                    <span>{zone.city}</span>
                    {isBase && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-violet-600/30 text-violet-300">
                        Base
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{zone.region}</div>
                </div>

                <span
                  className={`p-1.5 rounded-lg text-sm ${
                    isDay ? 'bg-amber-500/10 text-amber-400' : 'bg-indigo-500/10 text-indigo-400'
                  }`}
                  title={isDay ? 'Daytime' : 'Nighttime'}
                >
                  <Icon name={isDay ? 'sun' : 'moon'} size={16} />
                </span>
              </div>

              <div className="mt-2">
                <div className="text-2xl font-bold font-mono text-white tracking-tight">
                  {timeStr}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{dateStr}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
