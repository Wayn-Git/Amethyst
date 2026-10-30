import Image from "@/components/wigggle/PreviewImage";

import { Label } from "@/components/wigggle/vendor/components/ui/label";
import {
  Widget,
  WidgetContent,
  WidgetHeader,
  WidgetTitle,
} from "@/components/wigggle/vendor/registry/default/ui/widget";

const upcomingMatches = [
  {
    away: "/wigggle/assets/logos/bvb.png",
    date: "25 Oct",
    home: "/wigggle/assets/logos/fcb.png",
    time: "8:30 PM",
  },
  {
    away: "/wigggle/assets/logos/fcb.png",
    date: "29 Oct",
    home: "/wigggle/assets/logos/mci.png",
    time: "12:30 PM",
  },
  {
    away: "/wigggle/assets/logos/fcb.png",
    date: "31 Oct",
    home: "/wigggle/assets/logos/bvb.png",
    time: "8:30 PM",
  },
];

const WidgetDemo = () => (
  <Widget design="mumbai">
    <WidgetHeader>
      <WidgetTitle className="text-sm font-normal">Fixtures</WidgetTitle>
    </WidgetHeader>
    <WidgetContent className="mt-2 flex-col items-center gap-1.5">
      {upcomingMatches.map((match, i) => (
        <div
          key={i}
          className="bg-secondary flex w-full items-center justify-between rounded-lg px-2 py-1"
        >
          <Image
            className="size-7"
            src={match.home}
            alt={match.home}
            width={64}
            height={64}
          />
          <div className="flex flex-col items-center justify-center gap-0">
            <Label variant="muted-foreground" size="xs">
              {match.date}
            </Label>
            <Label variant="muted-foreground" size="xs">
              {match.time}
            </Label>
          </div>
          <Image
            className="size-7"
            src={match.away}
            alt={match.away}
            width={64}
            height={64}
          />
        </div>
      ))}
    </WidgetContent>
  </Widget>
);

export default WidgetDemo;
