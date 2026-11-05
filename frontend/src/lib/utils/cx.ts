import { extendTailwindMerge } from "tailwind-merge";

export const TYPOGRAPHY_SCALE_CLASSES = [
    // Large Title
    "large-title-regular",
    "large-title-medium",
    "large-title-semibold",
    "large-title-bold",

    // Display 1
    "display-1-regular",
    "display-1-medium",
    "display-1-semibold",
    "display-1-bold",

    // Display 2
    "display-2-regular",
    "display-2-medium",
    "display-2-semibold",
    "display-2-bold",

    // Display 3
    "display-3-regular",
    "display-3-medium",
    "display-3-semibold",
    "display-3-bold",

    // Display 4
    "display-4-regular",
    "display-4-medium",
    "display-4-semibold",
    "display-4-bold",

    // Title 1
    "title-1-regular",
    "title-1-medium",
    "title-1-semibold",
    "title-1-bold",

    // Title 2
    "title-2-regular",
    "title-2-medium",
    "title-2-semibold",
    "title-2-bold",

    // Title 3
    "title-3-regular",
    "title-3-medium",
    "title-3-semibold",
    "title-3-bold",

    // Headline
    "headline-regular",
    "headline-medium",
    "headline-semibold",
    "headline-bold",

    // Body
    "body-regular",
    "body-medium",
    "body-semibold",
    "body-bold",

    // Body 2
    "body-2-regular",
    "body-2-medium",
    "body-2-semibold",
    "body-2-bold",

    // Caption 1
    "caption-1-regular",
    "caption-1-medium",
    "caption-1-semibold",
    "caption-1-bold",

    // Caption 2
    "caption-2-regular",
    "caption-2-medium",
    "caption-2-semibold",
    "caption-2-bold",

    // Preserved display utilities
    "display-xs",
    "display-sm",
    "display-md",
    "display-lg",
    "display-xl",
    "display-2xl",
];

const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: TYPOGRAPHY_SCALE_CLASSES,
        },
    },
});

/**
 * This function is a wrapper around the twMerge function.
 * It is used to merge the classes inside style objects.
 */
export const cx = twMerge;

/**
 * This function does nothing besides helping us to be able to
 * sort the classes inside style objects which is not supported
 * by the Tailwind IntelliSense by default.
 */
export function sortCx<T extends Record<string, string | number | Record<string, string | number | Record<string, string | number>>>>(classes: T): T {
    return classes;
}
