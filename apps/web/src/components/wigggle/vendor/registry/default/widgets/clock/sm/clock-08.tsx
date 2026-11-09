import { Label } from "@/components/wigggle/vendor/components/ui/label";
import {
  Widget,
  WidgetContent,
  WidgetTitle,
} from "@/components/wigggle/vendor/registry/default/ui/widget";

const WidgetDemo = () => (
  <Widget>
    <WidgetContent className="flex-col justify-between">
      <div className="flex w-full items-center justify-between gap-2">
        <Label size="sm">Mumbai</Label>
        <WidgetTitle>8:15 AM</WidgetTitle>
      </div>
      <div className="flex w-full items-center justify-between gap-2">
        <Label size="sm">London</Label>
        <WidgetTitle>6:45 PM</WidgetTitle>
      </div>
      <div className="flex w-full items-center justify-between gap-2">
        <Label size="sm">Tokyo</Label>
        <WidgetTitle>8:15 AM</WidgetTitle>
      </div>
      <div className="flex w-full items-center justify-between gap-2">
        <Label size="sm">Seoul</Label>
        <WidgetTitle>6:45 PM</WidgetTitle>
      </div>
    </WidgetContent>
  </Widget>
);

export default WidgetDemo;
