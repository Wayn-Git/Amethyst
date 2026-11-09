import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import type { RegistryItem } from "shadcn/schema";
import { twMerge } from "tailwind-merge";

import registry from "@/components/wigggle/vendor/registry.json";

const widgets = registry.items as unknown as RegistryItem[];

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const getWidgetsByNames = (names: string[]): RegistryItem[] => {
  const widgetsMap = new Map(widgets.map((widget) => [widget.name, widget]));

  return names
    .map((name) => widgetsMap.get(name))
    .filter((comp): comp is RegistryItem => comp !== undefined);
};

export const convertRegistryPaths = (content: string): string =>
  content
    .replaceAll("@/components/wigggle/vendor/registry/default/ui", "@/components/wigggle/vendor/components/ui")
    .replaceAll("@/components/wigggle/vendor/registry/default/hooks", "@/components/wigggle/vendor/hooks")
    .replaceAll("@/components/wigggle/vendor/registry/default/lib", "@/components/wigggle/vendor/lib");
