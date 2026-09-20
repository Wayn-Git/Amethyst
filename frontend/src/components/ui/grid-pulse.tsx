"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type GridPulseProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "children"
> & {
  /** Cell size in px. The hairlines and the lit cells share it. */
  cell?: number;
  /** How far from the pointer a cell can still catch light, in cells. */
  reach?: number;
  /** How many cells light on their own each beat, so the grid is never dead. */
  ambient?: number;
  /** A lid, so a fast sweep cannot light the whole field at once. */
  maxLit?: number;
  /**
   * Elements whose lines of text the light holds back from, looked up
   * inside the grid's parent.
   */
  avoid?: string;
  /** Custom accent color (hex, rgb, hsl, or CSS variable). Defaults to var(--accent). */
  accentColor?: string;
  /** Custom secondary color (hex, rgb, hsl, or CSS variable). Defaults to var(--secondary-accent) or derived secondary tone. */
  secondaryColor?: string;
};

/**
 * Each cell takes one of these lightnesses, so a sweep reads as a field of
 * tints rather than one flat colour. On a dark ground the pale end of the
 * ladder would fade through grey, so it starts deeper there.
 */
const TINTS = [88, 80, 72, 64, 56];
const TINTS_DARK = [72, 65, 58, 51, 44];
/** How faint a cell goes right behind a line of text. */
const FAINT = 0.35;
/** How many cells it takes to come back up to full strength. */
const FADE = 2.2;
/** Clearing kept around each line of text, in px. */
const PAD = 5;
const FADE_IN = 160;
const FADE_OUT = 750;

type Cell = {
  col: number;
  row: number;
  colour: string;
  /** How much of its colour the cell is allowed, 0 to 1. */
  dim: number;
  born: number;
  /** When it starts to fade out. */
  until: number;
};

const easeOut = (t: number) => 1 - (1 - t) ** 2;
const easeIn = (t: number) => t * t;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

/**
 * A fine grid that takes colour where the pointer passes and lets it go a
 * moment later, with a few cells lighting on their own. The spectrum runs
 * down the field matching the theme's accent and secondary colors like a
 * printed colour chart, so a sweep reveals one coherent band of colour.
 *
 * Place it inside a positioned container, under the content. It is
 * decoration only: hidden from assistive tech, transparent to the pointer,
 * drawn on one canvas that sleeps whenever nothing is lit, paused off screen,
 * and still for readers who ask for reduced motion.
 */
export function GridPulse({
  cell = 24,
  reach = 2.6,
  ambient = 3,
  maxLit = 180,
  avoid = "[data-grid-avoid], .hero-headline, .hero-subheadline",
  accentColor,
  secondaryColor,
  className,
  style,
  ...props
}: GridPulseProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const el = box.current;
    const paper = canvas.current;
    const ctx = paper?.getContext("2d");
    if (!el || !paper || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cols = 1;
    let rows = 1;
    let width = 0;
    let height = 0;
    let clear: DOMRect[] = [];
    let tints = TINTS;
    const cells = new Map<string, Cell>();

    let themeColors = {
      accentHue: 260,
      accentSat: 90,
      secondaryHue: 200,
      secondarySat: 85,
    };

    // Light or dark ground, read from the text colour the grid inherits,
    // so it follows any theme switch: a class, an attribute or the system.
    // Also probes the active accent and secondary colors.
    const probe = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });

    const readTheme = () => {
      if (!probe) return;

      // Read light vs dark ground
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = getComputedStyle(el).color || "#ffffff";
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
      tints = light ? TINTS_DARK : TINTS;

      // Probe accent color from prop or CSS variable
      const computed = getComputedStyle(el);
      const accVal =
        accentColor ||
        computed.getPropertyValue("--accent").trim() ||
        "#7132f5";

      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = accVal;
      probe.fillRect(0, 0, 1, 1);
      const [ar, ag, ab] = probe.getImageData(0, 0, 1, 1).data;
      const [aH, aS] = rgbToHsl(ar, ag, ab);

      // Probe secondary color from prop or CSS variables
      const secVal =
        secondaryColor ||
        computed.getPropertyValue("--secondary-accent").trim() ||
        computed.getPropertyValue("--secondary").trim() ||
        "";

      let sH = (aH + 40) % 360;
      let sS = Math.max(75, aS);

      if (secVal) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = secVal;
        probe.fillRect(0, 0, 1, 1);
        const [sr, sg, sb] = probe.getImageData(0, 0, 1, 1).data;
        const [rawSH, rawSS] = rgbToHsl(sr, sg, sb);
        if (rawSS > 15) {
          sH = rawSH;
          sS = rawSS;
        } else {
          // If secondary is neutral/grayscale, derive a harmonious secondary accent
          probe.clearRect(0, 0, 1, 1);
          probe.fillStyle = `color-mix(in srgb, ${accVal} 60%, #38bdf8)`;
          probe.fillRect(0, 0, 1, 1);
          const [mr, mg, mb] = probe.getImageData(0, 0, 1, 1).data;
          const [mixH, mixS] = rgbToHsl(mr, mg, mb);
          sH = mixH;
          sS = Math.max(75, mixS);
        }
      } else {
        // Harmonious secondary tone blending accent with vibrant sky/cyan
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = `color-mix(in srgb, ${accVal} 60%, #38bdf8)`;
        probe.fillRect(0, 0, 1, 1);
        const [mr, mg, mb] = probe.getImageData(0, 0, 1, 1).data;
        const [mixH, mixS] = rgbToHsl(mr, mg, mb);
        sH = mixH;
        sS = Math.max(75, mixS);
      }

      themeColors = {
        accentHue: aH,
        accentSat: Math.max(75, aS),
        secondaryHue: sH,
        secondarySat: Math.max(75, sS),
      };
    };

    // Protect the lines of text, not the boxes that hold them: a paragraph
    // set to a measure keeps that width on its short last line too, and the
    // box would hold a band of cells dark where there is nothing to read.
    const measureText = () => {
      const bounds = el.getBoundingClientRect();
      const scope = el.parentElement ?? document;
      clear = [...scope.querySelectorAll(avoid)].flatMap((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = [...range.getClientRects()].filter(
          (r) => r.width > 0 && r.height > 0,
        );
        const boxes = lines.length > 0 ? lines : [node.getBoundingClientRect()];
        return boxes.map(
          (r) =>
            new DOMRect(
              r.left - bounds.left - PAD,
              r.top - bounds.top - PAD,
              r.width + PAD * 2,
              r.height + PAD * 2,
            ),
        );
      });
    };

    const measure = () => {
      width = el.clientWidth;
      height = el.clientHeight;
      cols = Math.max(1, Math.ceil(width / cell));
      rows = Math.max(1, Math.ceil(height / cell));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      paper.width = Math.round(width * dpr);
      paper.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readTheme();
      measureText();
      wake();
    };

    /**
     * How bright a cell may be, by its distance from the nearest line of
     * text. Cells behind the words go faint rather than dark: a hole cut in
     * the grid reads as a fault, a dip in brightness reads as depth.
     */
    const brightness = (col: number, row: number) => {
      const x = col * cell + cell / 2;
      const y = row * cell + cell / 2;
      let nearest = Number.POSITIVE_INFINITY;
      for (const r of clear) {
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        nearest = Math.min(nearest, Math.hypot(dx, dy));
        if (nearest === 0) break;
      }
      if (nearest === Number.POSITIVE_INFINITY) return 1;
      return FAINT + (1 - FAINT) * Math.min(1, nearest / (FADE * cell));
    };

    const ink = (row: number) => {
      const t = rows > 1 ? Math.min(1, row / (rows - 1)) : 0;
      // Shortest arc around the color wheel between accent and secondary hue
      let dHue = (themeColors.secondaryHue - themeColors.accentHue) % 360;
      if (dHue > 180) dHue -= 360;
      if (dHue < -180) dHue += 360;
      const hue = (themeColors.accentHue + t * dHue + 360) % 360;
      const sat = themeColors.accentSat * (1 - t) + themeColors.secondarySat * t;
      const tint = tints[Math.floor(Math.random() * tints.length)];
      return `hsl(${Math.round(hue)} ${Math.round(Math.max(65, sat))}% ${tint}%)`;
    };

    // One loop draws every cell; it runs only while something is lit.
    let frame = 0;
    const draw = (now: number) => {
      frame = 0;
      ctx.clearRect(0, 0, width, height);
      for (const [key, c] of cells) {
        let alpha: number;
        if (now < c.until) {
          alpha = easeOut(Math.min(1, (now - c.born) / FADE_IN));
        } else {
          const t = (now - c.until) / FADE_OUT;
          if (t >= 1) {
            cells.delete(key);
            continue;
          }
          alpha = 1 - easeIn(t);
        }
        ctx.globalAlpha = alpha * c.dim;
        ctx.fillStyle = c.colour;
        // Inset by the hairline, so the grid still shows between lit cells.
        ctx.fillRect(c.col * cell + 1, c.row * cell + 1, cell - 1, cell - 1);
      }
      ctx.globalAlpha = 1;
      if (cells.size > 0) frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    /** Lights one cell, unless it is off the grid or already lit. */
    const light = (col: number, row: number, hold: number) => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return;
      if (cells.size >= maxLit) return;
      const key = `${col},${row}`;
      const now = performance.now();
      const lit = cells.get(key);
      if (lit && now < lit.until) return;
      // A cell caught again while fading picks up from where it had got to,
      // instead of blinking out and back in.
      let born = now;
      if (lit) {
        const faded = 1 - easeIn(Math.min(1, (now - lit.until) / FADE_OUT));
        born = now - (1 - Math.sqrt(1 - faded)) * FADE_IN;
      }
      cells.set(key, {
        col,
        row,
        colour: lit?.colour ?? ink(row),
        dim: brightness(col, row),
        born,
        until: now + hold,
      });
      wake();
    };

    // The pointer paints. Cells further from it catch light less often, so
    // the edge of the trail breaks up instead of moving as a block.
    let pending = 0;
    let at: { x: number; y: number } | null = null;
    const paint = () => {
      pending = 0;
      if (!at) return;
      const cx = Math.floor(at.x / cell);
      const cy = Math.floor(at.y / cell);
      const span = Math.ceil(reach);
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const away = Math.hypot(dx, dy);
          if (away > reach) continue;
          if (Math.random() > 1 - away / (reach + 0.6)) continue;
          light(cx + dx, cy + dy, 260 + Math.random() * 900);
        }
      }
    };
    // Listened for on the window, because the grid sits under the content
    // and never receives the pointer itself.
    const onMove = (event: PointerEvent) => {
      const bounds = el.getBoundingClientRect();
      at = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      if (!pending) pending = requestAnimationFrame(paint);
    };

    // A few cells find their own way on, so the grid is alive on arrival and
    // on a screen with no pointer at all. Paused while out of sight.
    let visible = true;
    let beat = 0;
    const drift = () => {
      beat = window.setTimeout(drift, 1200 + Math.random() * 1600);
      if (!visible || document.hidden) return;
      for (let i = 0; i < ambient; i++) {
        light(
          Math.floor(Math.random() * cols),
          Math.floor(Math.random() * rows),
          900 + Math.random() * 1600,
        );
      }
    };
    beat = window.setTimeout(drift, 300);

    // Initial pulse of ambient cells on mount
    const initialSeedTimer = window.setTimeout(() => {
      const count = Math.min(20, Math.max(6, Math.floor((cols * rows) / 35)));
      for (let i = 0; i < count; i++) {
        light(
          Math.floor(Math.random() * cols),
          Math.floor(Math.random() * rows),
          1200 + Math.random() * 2000,
        );
      }
    }, 150);

    const sight = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    sight.observe(el);
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    // Text added, removed or rewritten moves the lines to hold back from.
    let recheck = 0;
    const copy = new MutationObserver(() => {
      if (!recheck) {
        recheck = requestAnimationFrame(() => {
          recheck = 0;
          measureText();
        });
      }
    });
    copy.observe(el.parentElement ?? document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const theme = new MutationObserver(readTheme);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readTheme);
    measure();
    // Lines of text move once the web fonts arrive.
    document.fonts?.ready.then(measureText).catch(() => {});
    window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      sight.disconnect();
      resize.disconnect();
      copy.disconnect();
      cancelAnimationFrame(recheck);
      theme.disconnect();
      scheme.removeEventListener("change", readTheme);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
      clearTimeout(beat);
      clearTimeout(initialSeedTimer);
      window.removeEventListener("pointermove", onMove);
    };
  }, [cell, reach, ambient, maxLit, avoid, accentColor, secondaryColor]);

  return (
    <div
      ref={box}
      aria-hidden
      data-slot="grid-pulse"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={
        {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 0,
          "--grid-pulse-cell": `${cell}px`,
          "--grid-pulse-line":
            "color-mix(in srgb, var(--accent, #7132f5) 15%, var(--hairline, rgba(255, 255, 255, 0.08)))",
          backgroundImage:
            "linear-gradient(to right, var(--grid-pulse-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-pulse-line) 1px, transparent 1px)",
          backgroundSize: `${cell}px ${cell}px`,
          maskImage: "linear-gradient(to bottom, #000 85%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 85%, transparent 100%)",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      <canvas
        ref={canvas}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
export default GridPulse;
