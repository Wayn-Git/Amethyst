import Image from "@/components/wigggle/PreviewImage";

import { Label } from "@/components/wigggle/vendor/components/ui/label";
import {
  Widget,
  WidgetContent,
  WidgetHeader,
  WidgetTitle,
} from "@/components/wigggle/vendor/registry/default/ui/widget";

const details = [
  {
    image: "/wigggle/assets/logos/fcb.png",
    name: "FCB",
    score: "2",
    teamName: "FC Barcelona",
  },
  {
    image: "/wigggle/assets/logos/rma.png",
    name: "RMA",
    score: "1",
    teamName: "Real Madrid FC",
  },
];

const WidgetDemo = () => (
  <Widget>
    <WidgetHeader>
      <WidgetTitle className="text-muted-foreground text-sm">
        La Liga
      </WidgetTitle>
      <WidgetTitle className="text-muted-foreground text-sm">
        21 Oct
      </WidgetTitle>
    </WidgetHeader>
    <WidgetContent className="items-end justify-between">
      {details.map((team) => (
        <div key={team.name} className="flex flex-col items-center gap-1">
          <Image
            className="size-8"
            src={team.image}
            alt={team.teamName}
            width={32}
            height={32}
          />
          <Label size="lg">{team.name}</Label>
          <Label size="xxxl">{team.score}</Label>
        </div>
      ))}
    </WidgetContent>
  </Widget>
);

export default WidgetDemo;
