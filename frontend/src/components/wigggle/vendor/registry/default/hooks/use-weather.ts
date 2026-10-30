import { useState } from "react";
import { useWeatherContext } from "@/components/wigggle/WeatherContext";
// Synthetic weather only for the explicitly labelled Wigggle design catalogue.
export function useWeather(_lat?: number, _lon?: number) {
  const live = useWeatherContext();
  const [now] = useState(() => new Date());
  if (live) return live.weather;
  return { isLoading: false, error: null, data: {
    temperature: 24, humidity: 60, windSpeed: 12, feelsLike: 25, chanceOfRain: 20, weatherCode: 2, isDay: true,
    hourly: { time: Array.from({ length: 48 }, (_, i) => new Date(now.getTime() + i * 3600000).toISOString()), temperature: Array(48).fill(24), weatherCode: Array(48).fill(2) },
    daily: { time: Array.from({ length: 7 }, (_, i) => new Date(now.getTime() + i * 86400000).toISOString()), temperatureMax: Array(7).fill(26), temperatureMin: Array(7).fill(18), weatherCode: Array(7).fill(2) },
  } };
}
