import { useWeatherContext } from "@/components/wigggle/WeatherContext";
// Design samples never locate the user or call a location service.
export const DEFAULT_LOCATION = { lat: 0, lon: 0 };
export function useLocation() { const live = useWeatherContext(); return live?.location || { coordinates: DEFAULT_LOCATION, city: 'Sample city', isLoading: false, error: null }; }
