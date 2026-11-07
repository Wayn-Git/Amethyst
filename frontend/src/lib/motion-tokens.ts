export const motionTokens = {
  duration: {
    instant: 0.12,
    fast: 0.16,
    exit: 0.18,
    standard: 0.24,
    moderate: 0.35,
    considered: 0.48,
    slow: 0.5,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.7, 0, 0.84, 0] as const,
    standard: [0.22, 1, 0.36, 1] as const,
    inOut: [0.65, 0, 0.35, 1] as const,
  },
  spring: {
    responsive: { type: "spring", stiffness: 520, damping: 44 } as const,
    gentle: { type: "spring", stiffness: 340, damping: 34 } as const,
    snappy: { type: "spring", visualDuration: 0.26, bounce: 0 } as const,
    smooth: { type: "spring", visualDuration: 0.4, bounce: 0 } as const,
    morph: { type: "spring", visualDuration: 0.42, bounce: 0 } as const,
    bouncy: { type: "spring", stiffness: 400, damping: 20 } as const,
  },
  stagger: {
    char: 0.016,
    word: 0.04,
    line: 0.08,
    item: 0.035,
  },
  blur: {
    subtle: 2,
    soft: 4,
    moderate: 8,
    text: 8,
    strong: 16,
  },
} as const;

export default motionTokens;

