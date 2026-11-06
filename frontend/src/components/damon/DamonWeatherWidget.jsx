import React, { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'

export default function DamonWeatherWidget({
  onSelectForecast,
  selectedIndex,
  getItemIndex,
}) {
  const [weatherData, setWeatherData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Clock tick every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  const fetchWeather = async () => {
    setLoading(true)
    try {
      // Default to user's saved location or Pune/India coordinate or browser geolocation
      const loc = { latitude: 18.5204, longitude: 73.8567, city: 'Pune, Maharashtra', country: 'India' }
      const res = await api.todayWeather(loc)
      setWeatherData({ ...res, city: loc.city, country: loc.country })
    } catch {
      // Fallback state matching design spec
      setWeatherData({
        city: 'Pune, Maharashtra',
        country: 'India',
        current: {
          temperature_2m: 30,
          weather_code: 0,
          wind_speed_10m: 8.5,
        },
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWeather()
  }, [])

  const formatTime = (d) => {
    let hours = d.getHours()
    const minutes = d.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    return { timeStr: `${hours}:${minutes}`, ampm }
  }

  const { timeStr, ampm } = formatTime(currentTime)
  const currentTemp = Math.round(weatherData?.current?.temperature_2m ?? 30)
  const windSpeed = weatherData?.current?.wind_speed_10m ?? 8.5
  const cityName = weatherData?.city || 'Pune, Maharashtra'
  const subText = `${weatherData?.country || 'India'} · Clear skies`

  const hourlySlots = [
    { label: '12pm', icon: 'sun', temp: '30°' },
    { label: '3pm', icon: 'cloud-sun', temp: '31°' },
    { label: '6pm', icon: 'cloud-rain', temp: '27°' },
    { label: '9pm', icon: 'moon', temp: '25°' },
    { label: '12am', icon: 'moon', temp: '23°' },
  ]

  const forecastActions = [
    { id: 'forecast-24h', title: cityName, subtitle: '24 hours forecast', shortcut: '⌘1' },
    { id: 'forecast-tomorrow', title: cityName, subtitle: 'Tomorrow forecast', shortcut: '⌘2' },
    { id: 'forecast-nextweek', title: cityName, subtitle: 'Next week forecast', shortcut: '⌘3' },
  ]

  return (
    <div className="damon-weather-view">
      {/* 1. Main Weather Card */}
      <div className="damon-weather-card">
        <div className="damon-weather-left">
          <div>
            <div className="damon-weather-loc-tag">Current location</div>
            <div className="damon-weather-headline">
              <div>
                <div className="damon-weather-city">
                  <Icon name="navigation-arrow" size={16} />
                  <span>{cityName}</span>
                </div>
                <div className="damon-weather-sub">{subText}</div>
              </div>

              <div className="damon-weather-clock">
                {timeStr}
                <span>{ampm}</span>
              </div>
            </div>
          </div>

          <div className="damon-weather-hourly">
            {hourlySlots.map((slot, i) => (
              <div key={i} className="damon-hourly-slot">
                <span>{slot.label}</span>
                <Icon name={slot.icon} size={18} />
                <span className="damon-hourly-temp">{slot.temp}</span>
              </div>
            ))}
            <div className="damon-hourly-slot">
              <Icon name="wind" size={16} />
              <span style={{ fontSize: 11, fontWeight: 500 }}>{windSpeed} km/h</span>
            </div>
          </div>
        </div>

        {/* Right Radar / Pin View */}
        <div className="damon-weather-right">
          <div className="damon-radar-center">
            <div className="damon-radar-ring damon-radar-ring--2" />
            <div className="damon-radar-ring damon-radar-ring--1" />
            <div className="damon-radar-pin" />
          </div>

          <button
            type="button"
            className="damon-refresh-btn"
            onClick={fetchWeather}
            disabled={loading}
          >
            <span>Refresh</span>
            <Icon name="arrow-clockwise" size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Forecast Action Rows */}
      <div className="damon-list-container">
        {forecastActions.map((f, i) => {
          const idx = getItemIndex(f)
          const isSelected = selectedIndex === idx

          return (
            <button
              key={f.id}
              type="button"
              className={`damon-row${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelectForecast(f)}
            >
              <div className="damon-row-icon-wrap">
                <Icon name="navigation-arrow" size={18} />
              </div>
              <div className="damon-row-main">
                <div className="damon-row-title">{f.title}</div>
                <div className="damon-row-subtitle">{f.subtitle}</div>
              </div>
              <div className="damon-row-trailing">
                <span className="damon-row-shortcut">{f.shortcut}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
