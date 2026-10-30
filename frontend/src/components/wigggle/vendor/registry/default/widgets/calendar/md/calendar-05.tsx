import { cn } from "cn";
import { VideoIcon } from "lucide-react";

import { Button } from "@/components/wigggle/vendor/components/ui/button";
import { Label } from "@/components/wigggle/vendor/components/ui/label";
import { Widget, WidgetContent } from "@/components/wigggle/vendor/registry/default/ui/widget";

const WidgetDemo = () => {
  const meetings = [
    {
      borderColor: "border-destructive",
      room: "Online",
      time: "7:00 - 8:30 AM",
      title: "Daily Scrum",
    },
    {
      borderColor: "border-(--ui-accent)",
      room: "Figma Room",
      time: "11:15 - 12:00 PM",
      title: "Design Roundup",
    },
    {
      borderColor: "border-(--tile-waiting)",
      room: "Jest Room",
      time: "1:00 - 2:00 PM",
      title: "UAT Testing",
    },
    {
      borderColor: "border-productive",
      room: "SpaceX Room",
      time: "6:00 PM",
      title: "PROD Launch",
    },
  ];

  return (
    <Widget design="mumbai" size="md">
      <WidgetContent className="grid grid-cols-2 items-center gap-5">
        {meetings.map((el) => (
          <div
            key={el.title}
            className={cn(
              el.borderColor,
              "flex w-full items-center justify-between border-l-4 ps-3"
            )}
          >
            <div className="space-y-1">
              <Label size="sm">{el.title}</Label>
              <Label size="xs" variant="muted-foreground">
                {el.room}
              </Label>
              <Label size="xs" weight="light">
                {el.time}
              </Label>
            </div>
            {el.room === "Online" && (
              <Button variant="outline" size="icon-sm">
                <VideoIcon />
              </Button>
            )}
          </div>
        ))}
      </WidgetContent>
    </Widget>
  );
};

export default WidgetDemo;
