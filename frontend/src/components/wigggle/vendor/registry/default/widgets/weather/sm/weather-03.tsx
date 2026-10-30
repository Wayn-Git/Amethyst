

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
  WidgetHeader,
  WidgetTitle,
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
      <WidgetHeader>
        <WidgetTitle className="text-4xl">
          {weather?.temperature}&deg;
        </WidgetTitle>
      </WidgetHeader>
      <WidgetContent className="items-end">
        <div className="flex w-full flex-col items-end gap-1.5">
          {weather && getWeatherIcon(weather.weatherCode, "size-8")}
          <Label size="lg" weight="medium">
            {city || "Unknown"}
          </Label>
        </div>
      </WidgetContent>
    </Widget>
  );
};

export default WidgetDemo;
