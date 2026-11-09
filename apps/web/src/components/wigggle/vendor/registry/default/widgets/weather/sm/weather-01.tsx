

import { Label } from "@/components/wigggle/vendor/components/ui/label";
import {
  DEFAULT_LOCATION,
  useLocation,
} from "@/components/wigggle/vendor/registry/default/hooks/use-location";
import { useWeather } from "@/components/wigggle/vendor/registry/default/hooks/use-weather";
import { getWeatherIcon } from "@/components/wigggle/vendor/registry/default/lib/weather-utils";
import {
  Widget,
  WidgetContent,
  WidgetFooter,
} from "@/components/wigggle/vendor/registry/default/ui/widget";

const WidgetDemo = () => {
  const { coordinates, city, isLoading: isLoadingLocation } = useLocation();
  const { data: weather, isLoading: isLoadingWeather } = useWeather(
    coordinates?.lat ?? DEFAULT_LOCATION.lat,
    coordinates?.lon ?? DEFAULT_LOCATION.lon
  );

  const isLoading = isLoadingLocation || isLoadingWeather;

  if (isLoading) {
    return (
      <Widget>
        <WidgetContent className="flex items-center justify-center">
          <Label>
            <span className="animate-pulse">Loading...</span>
          </Label>
        </WidgetContent>
      </Widget>
    );
  }

  return (
    <Widget>
      <WidgetContent className="flex-col gap-4">
        {weather &&
          getWeatherIcon(weather.weatherCode, "size-16", { strokeWidth: 2 })}
        <Label size="xxxl">{weather?.temperature}&deg;</Label>
      </WidgetContent>
      <WidgetFooter className="justify-center">
        <Label>{city || "Unknown Location"}</Label>
      </WidgetFooter>
    </Widget>
  );
};

export default WidgetDemo;
