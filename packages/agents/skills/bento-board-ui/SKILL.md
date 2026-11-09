---
name: bento-board
description: Turns brand assets or an existing design (logo, colors, photos, landing page) into a polished bento-style brand presentation board — the kind you see on Dribbble and Behance. Use when asked to present a brand, make a brand board, brand snapshot, or portfolio shot. Not for UI dashboards or app screens.
---

# Bento Brand Board

You are composing a single presentation frame that shows off a brand identity as a bento grid. The result should look like a top Dribbble shot: one strong hero, supporting tiles of varied sizes, everything unified by consistent spacing and corner radius.

This is a poster, NOT documentation. The board sells the brand's feeling; it does not explain or catalog it.

## Step 0 — image inventory (do this FIRST, before any layout work)

1. Scan the source design and list every raster image it contains: hero photos, lifestyle shots, product shots, mockup photos. Note where each one lives (which layer/frame).
2. All photo tiles on the board are filled ONLY from this list. The hero tile takes the largest/most prominent image from the list; the Photography tile takes a different one from the same list.
3. Fill photo tiles by COPYING the source layers that contain these images (duplicate the layer / reuse its image fill) — do not recreate, redraw, or generate a lookalike.
4. If the inventory is empty, there are no photo tiles: hero becomes a flat brand-color tile with the tagline, Photography uses its flat fallback. Skipping this inventory or using any image not on the list is a failed run.

## Step 0.5 — extract the visual language

Before styling anything, harvest the source's design vocabulary and reuse it throughout the board. The goal is maximum recreation of the brand's look, not a generic bento with the brand's colors dropped in. Pull and reuse:

- **Corner radius** of the source's own cards/buttons — echo it in inner elements (still one radius everywhere on the board).
- **Border/stroke treatment**: if the source uses outlined buttons, ringed avatars, or hairline dividers, reuse that exact stroke weight and color on the board's inner elements (buttons, pills, UI fragments). Tiles themselves stay borderless — strokes live INSIDE tiles, never on tile edges.
- **Icons**: reuse the source's actual icons — copy the real icon shapes/set. Never substitute a different icon style. If the source has no icons, add none.
- **Button and pill styles**: match fill vs outline, radius, padding, and label case exactly as the source draws them.
- **Shadows/elevation**: if the source is flat, stay flat; if it uses soft shadows on cards, echo that on inner UI fragments (never on the tiles).
- **Badges, tags, arrows, dividers, dots** and other recurring motifs: lift the real ones from the source rather than inventing lookalikes.
- **Gradients, textures, grain, patterns**: if the brand uses them, sample the same treatment; if not, keep surfaces clean.

Rule of thumb: if an element could be traced back to a specific part of the source, you did it right. If it looks like a generic design-tool default, replace it with the source's version.

## Carry the brand's mood — rule zero

Before choosing anything, read the source. The board must feel like the same brand:

- If the source design is dark, the board background is dark (near-black neutral, #0A0A14 range). If light, a warm light neutral (#ECEBE7–#F2F2F0 range).
- Pull accent colors, typefaces, and photo grade FROM the source. Do not substitute a generic palette.
- EVERY element on the board comes from the source design: photos, logo, UI cards, icons, badges, button styles, illustration fragments. The board is assembled from existing parts, never authored from scratch. Never generate new images, never draw new icons, never invent new UI.
- Identify the dominant photos already present in the source design and reuse those. If the source has no usable photo, use a flat brand-color tile with a headline instead of a photo tile.
- Text on the board is copied or lightly shortened from the source copy — never rewritten into new marketing language. No exceptions, including the Photography overlay line.
- A viewer who saw the source should recognize the brand from the board in one second. If the board could belong to a different brand, it failed.

## Canvas

- Frame: 1920×1080 (landscape) unless the user asks otherwise.
- Background: neutral only, light warm gray #EDEDEA (or a near-black neutral for dark brands). NEVER a brand color as background. The background is a shelf, not a tile.
- Gap between tiles: 16px. Outer board margin: 32px on all sides. Two different fixed values — never vary them per tile.
- Every tile: corner radius 28px, inner padding 40px (Colors tile 32px, Photography tile 32px). No tile borders, no drop shadows on tiles.
- Left zone total width ~1206px across 3 equal columns; hero column 650px full height.
- Left-zone row heights are fixed: row 1 (Mission / Key metrics) = 320px, row 2 (Logo / Typography / Colors) = 344px, row 3 (Photography / How it works) = 320px. The middle DNA row is the tallest.

## Grid logic

- 8 blocks by default (see The 8-block layout). Collapsing to 6–7 via the listed fallbacks is fine; going above 8 is not.
- If there isn't enough real content for a block, collapse per the fallbacks. Never invent filler content or abstract diagrams to fill space.
- Exactly ONE dominant hero: a full-height column occupying 30–40% of the board area. Never two tiles of equal visual weight competing.
- The left-zone tiles vary in height (row 1 taller, DNA row square-ish, row 3 tallest) but the three columns stay equal width. This is deliberate irregularity, not a uniform grid.
- One gap value between all tiles: 16px, everywhere. Outer margin: 32px on all four edges.
- One corner radius everywhere: 28px. Every tile, same radius. No exceptions, no mixed radii.
- Tiles never overlap each other. Decorative elements (stickers, floating cards) may overlap a photo INSIDE a tile but must never cross tile boundaries.

## The 8-block layout

The board uses a fixed structure of 8 blocks. Left zone is a strict 3-column grid stacked in 3 rows; right zone is one full-height hero column. Mirroring (hero on the left) is allowed; changing the block set is not.

**Column discipline (left zone):** all three columns are equal width. Logo, Typography, and Colors each take exactly one column. Key metrics (row 1) and Photography (row 3) take exactly one column too — the SAME width as the DNA tiles. Mission and How it works each span exactly two columns. Every tile edge in the left zone lands on the column grid; nothing is freeform.

**Block titles:** blocks carry an uppercase title naming them, set in a NEUTRAL sans-serif (Inter or similar) — NOT the brand's display typeface, NOT the type used in the specimen. Bold weight, letter-spaced slightly, dark on light tiles / light on dark tiles. Titles: OUR MISSION, KEY METRICS, LOGO, TYPOGRAPHY, COLORS, HOW IT WORKS. Two blocks carry no title: the hero (only the tagline) and Photography (a short verbatim line instead, see below). Title size: ~18px at 1920 width. Pinned to the top-left corner of the tile with consistent padding (~32px inset), same size and position on every titled block.

**Row 1 (top):**
1. **Mission** — spans 2 columns. Title: OUR MISSION, pinned top-left. The positioning statement taken from the source copy: what this brand does and for whom. The ONLY tile allowed a body paragraph (max 25 words). Set at 38px (at 1920 width), regular/medium weight, left-aligned, vertically CENTERED in the tile below the pinned top-left title. It breaks naturally across 3–4 lines. Not stretched to fill; centered as a block in the available space. This is the second-loudest text on the board after the hero tagline, not fine print.
2. **Key metrics** — 1 column. Title: KEY METRICS, pinned top-left. The stat sits at the BOTTOM-LEFT of the tile, left-aligned: a huge number (e.g. "39%", ~90px, brand display face) with a small label directly under it ("program completion rate", ~20px), both aligned to the left edge. Flex column with space-between — title top, number+label bottom. Nothing else. Choose the single most important data point in the source — the one that ADDS to the story the other blocks tell, not one that repeats the mission, hero, or how-it-works block. If several stats exist, pick the most consequential (users, funding, scale), not the most decorative.

**Row 2 (middle) — brand DNA, three dedicated blocks, one column each (height 344).** In all three the primary content (logo mark, type specimen + caption, color circles + hex row) is centered VERTICALLY within the tile and horizontally too — the three content centers sit on one shared horizontal midline across the row. The top-left block titles are pinned separately and do NOT shift the centered content. Verify all three read as one aligned row before finishing.

**Vertical centering also applies to Mission and Key metrics content:** the Mission body text is vertically centered in its tile (title stays pinned top-left, body centered in the remaining space), and likewise the Logo, Typography, and Colors content is vertically centered. Titles pinned top-left; all primary content optically centered vertically in each tile.
3. **Logo** — the brand's ACTUAL logo asset on a flat fill, nothing else, centered on both axes of the tile. Extraction is mandatory and comes first:
   a. Find the logo in the source — it usually exists as an image/vector/component (in the reference file it is the Pelago asset, 192×65). Locate it in the layer tree or assets.
   b. COPY that real asset (duplicate the layer / reuse its vector or image fill) into the tile. This is the required path.
   c. Only if there is genuinely NO logo anywhere in the source may you fall back to setting the brand NAME as a wordmark in the brand's display typeface. Text is the last resort, not the default — never skip straight to text when a real logo exists.
   Never leave this tile empty or with a placeholder box. Scale PROPORTIONALLY (contain, never cover, never stretch): aspect ratio locked, width and height scale together. Size so the LONGER dimension reaches ~65% of the tile, then stop. Never distort, squash, or stretch.
4. **Typography** — "Aa Bb 123" display-sized (~72px), centered on both axes, ALWAYS present. Set it in the brand's actual typeface if that font is available; if not, set it in the closest available match and still name the real font in the caption. The caption under it names the real typeface and weight from the source (e.g. "ES Rebond Grotesque Medium", ~18px) and is always shown. Specimen + caption centered as one group. This tile is often the dark tile of the board.
5. **Colors** — 4–6 swatches as circles in a single row, overlapping each other like fanned playing cards (each circle covers ~25–35% of the previous one, later circles on top). Each circle is 90×90px (perfect circles, equal width and height, never ovals). The hex values sit together on ONE line beneath the circles (e.g. "#A4BDFF  #EEBCFF  #FAE355  #212633  #F5F5F3"), evenly spaced, uppercase, muted gray, not stacked and not individually placed under each circle. The circle row + the hex line are centered as one group on both axes of the tile. Hex values match the real fills used.

**Row 3 (bottom):**
6. **Photography** — 1 column, same width as the DNA tiles, taller than the DNA row. A secondary photo or product shot lifted from the source, edge-to-edge, filling the tile. Must be a DIFFERENT image than the hero. No category title — instead, one SHORT line quoted VERBATIM from the source copy (3–5 words, e.g. "Propelling people forward"), word-for-word, never composed or paraphrased. Pick a line that complements the board and does not repeat the hero tagline or mission. If no source line fits, leave the photo clean. Type: Inter Medium, 32px, white, bottom-left, set directly over the photo with NO pill, plate, or frame — placed over a darker/quieter area of the photo for legibility.
7. **How it works** — spans 2 columns. Title: HOW IT WORKS, top-left corner, same size/position/inset as every other block title — never centered, never inside the illustration. Layout: headline on the LEFT, illustration on the RIGHT. The headline (~34px, left-aligned, from the source) is vertically CENTERED in the left half of the tile. The illustration (a UI fragment, chat card, transaction row, or chart lifted from the source) sits in the right portion, is the dominant object (~half the tile), and must fit ENTIRELY WITHIN the tile bounds — scale it down proportionally if needed so no edge is clipped by the tile; it never bleeds past or gets cropped by the tile edge. Keep the source's own card styling/shadow on this fragment. The one concrete/substance tile.

**Hero column (full height):**
8. **Main image and title** — the dominant source photo, edge-to-edge, full height, ~32% of board width. The main tagline sits bottom-left as the largest text on the board (~80px, Medium weight — not bold, Title Case or as the source sets it, white or high-contrast). A single sticker pill from the source (e.g. a category label) may sit top-right over the photo.

**Fallbacks when the source lacks content:**
- No stat → Key metrics becomes a proof tile of another kind from the source: client logos, avatars + count, or a short quote.
- No second image for Photography → Photography becomes a flat accent tile with a single oversized glyph or logo mark from the source.
- No UI or product visual → How it works becomes a flat accent tile with one short line from the source.
- Never fill an empty block with invented content — use the listed substitutes only.

## Exact specs (from the reference build, at 1920×1080)

Use these values directly; they are measured from the approved board.

- **Board**: 1920×1080, padding 32, gap 16, background #EDEDEA, tile radius 28.
- **Mission**: width 800 (2 cols), height 320, padding 40, gap 24, radius 28, fill #FFFFFF. Title "OUR MISSION" Inter Bold 16px uppercase, top-left. Body Inter Medium 38px, line-height 120%, black, vertically centered under the pinned top-left title.
- **Key metrics**: width 392 (1 col), height 320, padding 40, radius 28, fill #FAE355 (or the brand's brightest accent). Flex column, space-between, left-aligned: title top-left, number+label bottom-left. Number ~90px brand display face, label under it ~20px, both flush to the left padding edge.
- **Logo**: 1 col, height 344, padding 40, radius 28, flat tint fill (reference: lilac #EEBCFF). Logo asset scaled proportionally (reference logo 192×65), centered, contain — never stretched.
- **Typography**: 1 col, height 344, padding 40, gap 16, radius 28, dark fill (#212633). Specimen "Aa Bb 123" ~64px + caption (real font name) ~16px, centered as a group. Light text on dark.
- **Colors**: 1 col, height 344, padding 32/24, radius 28, fill #FFFFFF. Circles are Ellipses 90×90 fixed, overlapping ~25–35%, later on top. Hex row on ONE line under the circles, ~13px muted gray, matching the real fills.
- **Photography**: width 384 (1 col), height 320, padding 32, radius 28. Source photo as background fill + linear-gradient 0deg from rgba(0,0,0,0.4) so bottom text is legible. Overlay line Inter Medium 32px white, bottom-left, verbatim from source, no pill.
- **How it works**: width 800 (2 cols), height 320, padding 40, gap 24, radius 28, fill #A4BDFF (brand accent). Title top-left. Headline Inter Medium 36px left, vertically centered in its area. Chat/UI card lifted from source: white, radius 16, padding 24, its own soft shadow — must fit fully inside the tile.
- **Hero**: width 650, full height 1016 (1080 minus margins), radius 28. Source portrait as fill + linear-gradient 180deg #000 0%→80% bottom. Tagline bottom-left ~64–80px, Inter/display Medium (not bold), Title Case, white. One source pill (e.g. "VIRTUAL CLINIC") top-right.

## Block rules

- Logo, typography, and colors each occupy their OWN dedicated block. Never merge them into one "brand assets" tile, never tuck a palette strip into the corner of another tile, never put the type specimen under the logo. One asset — one block.
- Stat block: number huge, label small, nothing else. No paragraph under the number.
- The illustration inside How it works is partial (a card, a row, a fragment — never a full screen), but large within its tile: it dominates the block, the headline line supports it.

## Text sizes — reference

Full hierarchy, largest to smallest, at 1920px width:
- Hero tagline: ~80px
- Key-metric number: ~90px (the one exception that outsizes the tagline, because it's a single glyph-string)
- Mission statement: 38px
- How-it-works headline: ~34px
- Photography overlay line: 32px (Inter Medium)
- Type specimen "Aa Bb 123": ~72px
- Block titles: ~18px, neutral sans, bold
- Captions (typeface name, hex, metric label): ~18–20px, muted

Every content text is large and legible; the only small text on the board is the block titles and the three caption types. Nothing else is small.

## Composition rules

- One message per tile. A tile contains a photo OR a headline OR a stat OR the palette — never headline + body + button + image stacked together (How it works, which pairs a headline with one UI fragment, is the sole intended combination).
- No two adjacent tiles share the same fill. Check every neighbor pair before finishing.
- Fill quota for the whole board: at least 2 tiles with flat brand-accent fills, at least 1 dark, the rest light/neutral or photographic. Do not leave a column of same-fill tiles. (Reference board: white mission, yellow metric, lilac logo, dark type, white colors, photo, blue how-it-works, photo hero.)
- Small "sticker" pills and badges (rounded, high-contrast) may sit over photos: short labels lifted from the source. 1–3 per board maximum.

## Typography

- Two type roles only: the brand's DISPLAY/brand typeface (hero tagline, mission, metric number, specimen) and a NEUTRAL sans (Inter or similar) for block titles and captions. Never set block titles in the brand display face.
- Hero tagline: large, Medium weight (NOT bold/heavy), Title Case unless the source clearly uses all-caps. It must read from across the room.
- Hierarchy comes from the hero and metric being far larger than everything else — not from shrinking other text. One shout, everything else speaks clearly, nothing whispers.

## Photos

- Source only: every photo on the board must be taken from the source design or from assets the user provided. Never generate, synthesize, or fetch new imagery.
- Choose the DOMINANT photos from the source — the largest, most prominent ones — not incidental thumbnails.
- PHOTOS (hero, Photography, product shots) fill their tile completely (cover, not contain). This cover rule applies to photos ONLY — logos, icons, and graphic marks are always scaled proportionally (contain) and never cropped or stretched.
- Re-cropping a source photo to fit a tile is fine; replacing it is not.

## Never do

- Never make the left-zone columns unequal width, and never make all tiles the same height.
- Never add strokes or borders on tiles — separation comes from fill contrast and gaps only.
- Never use more than one tile gap value (16px) or more than one corner radius (28px).
- Never put a brand color as the board background.
- Never set block titles in the brand display typeface — titles are always the neutral sans.
- Never add small text beyond block titles, hex captions, the typeface caption, the metric label, and the Photography overlay line; never title the hero or Photography blocks.
- Never exceed one body paragraph (Mission) on the whole board.
- Never invent filler content, fake diagrams, or meaningless icon rows to fill a tile.
- Never generate new images or create any element from scratch — every photo, icon, UI card, and badge is lifted from the source.
- Never distort or stretch the logo; scale it proportionally.
- Never use drop shadows on the tiles themselves. Flat tiles on a flat background (inner UI fragments may keep the source's own shadows).

## Controls to expose when relevant

If asking follow-ups, offer: light/dark background, accent color, hero side (left / right).