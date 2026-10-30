import { createContext, useContext } from 'react'
export const WeatherContext = createContext(null)
export const useWeatherContext = () => useContext(WeatherContext)
export function liveWeather(data) {
  const hours = (data?.hours || []).filter(hour => Number.isFinite(hour.temperature))
  return {
    location: { coordinates: { lat: 0, lon: 0 }, city: data?.timezone?.replaceAll('_', ' ') || 'Location unavailable', isLoading: false, error: null },
    weather: { isLoading: false, error: null, data: {
      temperature: Number.isFinite(data?.temperature) ? data.temperature : '—', humidity: '—', windSpeed: '—', feelsLike: '—', chanceOfRain: '—', weatherCode: null, isDay: null,
      hourly: { time: hours.map(hour => hour.time), temperature: hours.map(hour => hour.temperature), weatherCode: hours.map(() => null) },
      daily: { time: [], temperatureMax: ['—'], temperatureMin: ['—'], weatherCode: [] },
    } },
  }
}
