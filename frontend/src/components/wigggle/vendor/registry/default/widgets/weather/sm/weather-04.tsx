

import { Label } from "@/components/wigggle/vendor/components/ui/label";
import {
  DEFAULT_LOCATION,
  useLocation,
} from "@/components/wigggle/vendor/registry/default/hooks/use-location";
import { useWeather } from "@/components/wigggle/vendor/registry/default/hooks/use-weather";
import { getWeatherDescription } from "@/components/wigggle/vendor/registry/default/lib/weather-utils";
import { Widget, WidgetContent } from "@/components/wigggle/vendor/registry/default/ui/widget";

const date = new Date();

const currentDate = date.toLocaleDateString("en-US", {
  day: "numeric",
  month: "short",
  weekday: "short",
});

const WidgetDemo = () => {
  const { coordinates, isLoading: isLoadingLocation } = useLocation();
  const { data: weather, isLoading: isLoadingWeather } = useWeather(
    coordinates?.lat ?? DEFAULT_LOCATION.lat,
    coordinates?.lon ?? DEFAULT_LOCATION.lon
  );

  const isLoading = isLoadingLocation || isLoadingWeather;

  if (isLoading) {
    return (
      <Widget>
        <WidgetContent className="mx-auto flex-col items-center justify-center">
          <Label>
            <span className="animate-pulse">Loading...</span>
          </Label>
        </WidgetContent>
      </Widget>
    );
  }

  return (
    <Widget>
      <WidgetContent className="mx-auto flex-col items-start">
        <Label weight="medium" size="xxxxl">
          {weather?.temperature}&deg;
        </Label>
        <Label size="xxl" weight="light">
          {weather ? getWeatherDescription(weather.weatherCode) : "Sunny"}
        </Label>
        <Label weight="light">{currentDate}</Label>
      </WidgetContent>
    </Widget>
  );
};

export default WidgetDemo;
