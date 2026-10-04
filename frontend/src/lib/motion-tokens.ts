export const motionTokens = {
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    standard: [0.2, 0, 0, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  duration: {
    instant: 0.1,
    fast: 0.15,
    standard: 0.25,
    moderate: 0.35,
    slow: 0.5,
  },
  spring: {
    snappy: { type: "spring", stiffness: 450, damping: 35 },
    smooth: { type: "spring", stiffness: 300, damping: 30 },
    bouncy: { type: "spring", stiffness: 400, damping: 20 },
  },
  blur: {
    subtle: 4,
    moderate: 8,
    strong: 16,
  },
};

export default motionTokens;
