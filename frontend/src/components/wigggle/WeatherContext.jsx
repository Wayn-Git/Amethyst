import { createContext, useContext } from 'react'
export const WeatherContext = createContext(null)
export const useWeatherContext = () => useContext(WeatherContext)
export function liveWeather(data) {
  const hours = (data?.hours || []).filter(hour => Number.isFinite(hour.temperature))
  const days = (data?.daily || []).filter(day => typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date))
  const reading = value => Number.isFinite(value) ? value : '—'
  return {
    location: { coordinates: { lat: 0, lon: 0 }, city: data?.timezone?.replaceAll('_', ' ') || 'Location unavailable', isLoading: false, error: null },
    weather: { isLoading: false, error: null, data: {
      temperature: reading(data?.temperature), humidity: reading(data?.humidity), windSpeed: reading(data?.wind_speed), feelsLike: reading(data?.feels_like), chanceOfRain: reading(data?.precipitation), weatherCode: data?.weather_code ?? null, isDay: data?.is_day === 1 ? true : data?.is_day === 0 ? false : null,
      hourly: { time: hours.map(hour => hour.time), temperature: hours.map(hour => hour.temperature), weatherCode: hours.map(hour => hour.weather_code ?? null) },
      daily: { time: days.map(day => day.date), temperatureMax: days.length ? days.map(day => reading(day.temperature_max)) : ['—'], temperatureMin: days.length ? days.map(day => reading(day.temperature_min)) : ['—'], weatherCode: days.map(day => day.weather_code ?? null) },
    } },
  }
}
