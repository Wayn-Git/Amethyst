import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export interface TooltipProps {
  children: ReactNode;
  title?: string;
  className?: string;
}

export function AriaTooltip({ title, children }: TooltipProps) {
  if (!title) return <>{children}</>;
  return (
    <TooltipProvider>
      <Tooltip>
        {children}
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { AriaTooltip as Tooltip };
export { TooltipTrigger };
export { TooltipTrigger as AriaTooltipTrigger };
