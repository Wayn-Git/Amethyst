# Library Revamp — Mobile UI Design Spec

Single source of truth for implementing the 32 Library-section mobile design screens in React.
Extracted verbatim from the HTML mockups at `/tmp/opencode/library-design/final/slim/*.html`
(390 px-wide iOS liquid-glass canvases, Inter font, inline styles; values below are copied
unchanged from those files — none are invented).

Screens covered (32):

| # | Screen file | Screen name |
|---|---|---|
| 1 | library-full-scroll.html | Library list (full scroll) |
| 2 | library-grid-view.html | Library grid view |
| 3 | multi-select.html | Multi-select |
| 4 | empty-library.html | Empty library |
| 5 | search-new.html | Search (new) |
| 6 | no-search-results.html | No search results |
| 7 | collections-new.html | Collections (new) |
| 8 | empty-collections.html | Empty collections |
| 9 | collection-detail.html | Collection detail |
| 10 | create-sheet-new.html | Create sheet (new) |
| 11 | share-sheet-save.html | Share sheet save |
| 12 | saving-and-failed.html | Saving and failed |
| 13 | filter-and-sort.html | Filter and sort |
| 14 | tag-manager.html | Tag manager |
| 15 | item-menu.html | Item menu |
| 16 | confirm-delete.html | Confirm delete |
| 17 | add-to-collection.html | Add to collection |
| 18 | video-overview.html | Video / Overview |
| 19 | video-links.html | Video / Links |
| 20 | video-notes.html | Video / Notes |
| 21 | article-new.html | Article |
| 22 | movie.html | Movie |
| 23 | recipe.html | Recipe |
| 24 | recipe-cooking-mode.html | Recipe cooking mode |
| 25 | game.html | Game |
| 26 | book.html | Book |
| 27 | place.html | Place |
| 28 | places-map.html | Places map |
| 29 | podcast.html | Podcast |
| 30 | product.html | Product |
| 31 | note-checklist.html | Note / Checklist |
| 32 | settings.html | Settings |

---

# 1. GLOBAL DESIGN SYSTEM

## 1.1 Canvas and base

| Token | Value |
|---|---|
| Canvas width | 390 px |
| Canvas background (light) | `#F2F2F7` |
| Map screens canvas background | `#E8E7E1` |
| Share-sheet background (behind sheet) | `#fff` |
| Ink (primary text) | `#151517` |
| Body/dark text | `#2C2C2E` |
| Secondary text | `#3A3A3C` |
| Tertiary/muted text | `#48484A` |
| Muted/gray text | `#636366` |
| Placeholder text | `#8E8E93` |
| Strikethrough/done text | `#6E6E73` |
| Font family | `Inter`, system-ui, sans-serif; `-webkit-font-smoothing: antialiased` |
| Hairline border (rows) | `#ECECF0` |
| Chip border / outline | `#D8D8DE` |
| Filled-control border (checkbox, track) | `#C7C7CC` / `#B8B8C0` |
| Unchecked placeholder fill | `#E5E5EA` / `#EDEDF0` |
| iOS fill (segmented track, sub-buttons) | `rgba(118,118,128,.12)` (light) / `.16` (button) |
| Screen dim behind sheets/modals | `rgba(0,0,0,.35)`–`rgba(0,0,0,.42)` |

Semantic action colors:

| Role | Hex |
|---|---|
| Blue action (buttons, FAB) | `#0B5FD9` |
| Deep blue (links, text-blue accents) | `#0A55C4` |
| Dark blue text on blue surfaces | `#0A3D8F` (title) / `#1F4E9C` (subtitle) |
| Danger red | `#B3261E`, light bg `#FDECEA` |
| Error border | `#E8B4AF` |
| Success green (switch) | `#34C759` |
| Success badge | bg `#E3F3E9` text `#12663A` |
| Success toast check | `#5FD38D` |
| Tag/label blue tint | bg `#E4EDFC` text `#0A55C4` (alt bg `#D6E4FB` for search `<mark>`) |
| Green icon tint | bg `#E4F5EA` text `#14703A` |
| Orange icon tint | bg `#FDEBDD` text `#A8480E` |
| Teal icon tint | bg `#DDF1F3` text `#0B5560` |
| Star rating | `#F5A524` (on) / `#C7C7CC` (off) |
| Rating score chip | bg `#FBEBC8` text `#6B4300` |
| YouTube brand | `#E32D2D` |
| Skeleton fill | `#E5E5EA` (radius 6) |
| Timer inactive segment | `#D1D1D6` |
| Switch off track | `#D1D1D6` |

## 1.2 Glass classes (helper rules defined per file)

`.glass` — light glass (buttons, bars, cards). Two variants are used depending on what sits behind:

```css
/* list screens (.42) — library-full-scroll, detail screens, sheets' close buttons */
.glass{background:rgba(255,255,255,.42);backdrop-filter:blur(28px) saturate(200%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),
             inset 0 0 0 1px rgba(255,255,255,.55),
             0 0 0 .5px rgba(0,0,0,.10),
             0 8px 24px rgba(0,0,0,.12)}

/* imagery-behind screens (.55) — grid view, multi-select, places map */
.glass{background:rgba(255,255,255,.55);backdrop-filter:blur(28px) saturate(200%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),
             inset 0 0 0 1px rgba(255,255,255,.55),
             0 0 0 .5px rgba(0,0,0,.10),
             0 8px 24px rgba(0,0,0,.14)}   /* .12 on list screens */
```

`.glass-dark` — dark glass (badges on thumbnails, dark bottom bars, toasts):

```css
.glass-dark{background:rgba(28,28,30,.72);backdrop-filter:blur(28px) saturate(180%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),
             inset 0 0 0 1px rgba(255,255,255,.08),
             0 8px 24px rgba(0,0,0,.25)}
/* .72 → .78 and drops the .08 ring on grid/multi-select screens */
```

`.glass-tint` — translucent label pill on hero imagery (article/movie/recipe/game):

```css
.glass-tint{background:rgba(255,255,255,.22);backdrop-filter:blur(20px) saturate(170%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 0 0 1px rgba(255,255,255,.28)}
```

`.sheet` — bottom-sheet surface:

```css
.sheet{background:rgba(250,250,252,.8–.82);backdrop-filter:blur(32px) saturate(200%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 -8px 32px rgba(0,0,0,.14)}
```

`.alert` — centered dialog (confirm delete):

```css
.alert{background:rgba(250,250,252,.82);backdrop-filter:blur(32px) saturate(200%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.95),
             0 0 0 .5px rgba(0,0,0,.10),0 24px 60px rgba(0,0,0,.30)}
```

## 1.3 Typography scale (all Inter)

| Use | Size / line-height / weight / tracking |
|---|---|
| Page H1 (Library, Tags, Settings) | 40/44 (34/38 on Tags+Settings) px, 800, -0.035em |
| Detail H1 (video links/article/movie/podcast/product/place) | 26–28 / 31–33 px, 800, -0.03em |
| Detail H1 (recipe/game) | 30/34 px, 800, -0.03em |
| Cooking-mode step title | 38/42 px, 800, -0.035em |
| Empty-state H2 | 24 px, 800, -0.025em |
| No-results H2 | 22 px, 800, -0.025em |
| Sheet H1 | 22 px, 800, -0.025em (share sheet: 20/-0.02em) |
| Alert title | 20 px, 800, -0.02em |
| Section H2 (detail "Summary/Tags") | 22 px, 800, -0.02em |
| Section label (uppercase `h2.lbl`) | 13 px, 700, +0.07em (sheets use +0.06em), uppercase, `#636366` |
| Ways-to-save / suggested `h3` | 13 px, 700, +0.06em uppercase, `#636366` |
| Card title (list rows) | 17/22 px, 650, -0.01em (small variant 16/21) |
| Multi-select title | 16/21 px, 650, 2-line clamp |
| Detail list-row title | 17 px, 650, -0.01em |
| Meta line | 13–14 px, 500, `#636366` |
| Tab label | 16 px, 700 active / 500 inactive `#48484A` |
| Chip label | 15 px, 600 active / 500 inactive |
| Nav active tab | 15 px, 700, `#0A55C4` |
| Save/cancel link | 17 px, 600, `#0A55C4` |
| Primary button | 17 px, 700 |
| Secondary button | 16–17 px, 650 |
| Tile label | 13 px, 600 |
| Grid caption | 13 px, 600, line-height 17, single-line ellipsis |
| Alert body | 15/21 px, `#48484A` |
| Empty-state body | 16/23 px, `#636366` |
| Detail paragraph | 17/26 px, `#2C2C2E` (book synopsis 16/24) |
| Bullet/summary item | 16/25 px, `#2C2C2E` |
| Note body (note screen) | 18/28 px, `#2C2C2E` |
| Cooking-mode step subtitle | 22/30 px, `#3A3A3C` |
| Timer digits | 64/72 px, 800, -0.03em, tabular-nums |
| Jump-back eyebrow | 12 px, 700, +0.06em uppercase |
| Badge text | 10–11 px, 700, +0.08em uppercase |

## 1.4 Glass circular buttons (shared)

| Element | Style |
|---|---|
| Header glass button (list) | 46×46 px, radius 23, `.glass`, color `#151517`, icon 22×22 stroke 2 |
| Header glass button (detail/secondary screens) | 44×44 px, radius 22 (46/23 on article/movie/recipe/game/note/video screens) |
| Locate-me / primary icon button | 48×48 px, radius 24 (places map) |
| Hero quick action (favorite) | 58×58 px, radius 29, `.glass`, icon 24 |
| Sheet close ("X") | 44×44 px, radius 22, `.glass`, icon 18 stroke 2.6 |
| Back chevron icon | `M15 5l-7 7 7 7` stroke 2.4 |
| Share icon | `M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7` |
| More (kebab) | 3 filled circles r 1.8 at x 5.5/12/18.5, cy 12 |

## 1.5 Pills, chips and buttons

| Component | Exact style |
|---|---|
| Primary type chip (selected) | height 44, padding 0 18, radius 22, bg `#151517`, color `#fff`, 15px/600 (grid view: 40 h, 0 16, radius 20, 650; search chips on results row 15/500 inactive) |
| Type chip (idle) | height 44, padding 0 18, radius 22, border 1px `#D8D8DE`, bg `#fff`, color `#151517`, 15/500 |
| Chip small (`.c`, sheets) | height 40, padding 0 14, radius 20, border 1px `#D8D8DE`, bg `#fff`, 15/500 |
| Chip small selected (`.c.on`) | border 0, bg `#0B5FD9`, color `#fff`, 650 |
| Chips row container (`.chips`) | flex-wrap, gap 8 |
| Status segmented small (sheets) | container: flex, padding 3, radius 14, bg `rgba(118,118,128,.12)`; buttons flex:1 height 40 radius 11; selected: bg `#fff`, shadow `0 2px 8px rgba(0,0,0,.12)`, 14/700 `#151517`; idle: transparent, 14/500 `#48484A` |
| Status segmented large (Library) | container: padding 3, radius 20, bg `rgba(118,118,128,.12)`; buttons flex:1 height 44 radius 16; selected bg `#fff` shadow `0 2px 8px rgba(0,0,0,.14)` 16/700; idle transparent 16/500 `#48484A`; count badge: 13/700, padding 2 9, radius 10, bg `#E5E5EA` color `#3A3A3C` (selected) or bg `rgba(118,118,128,.16)` (idle) |
| Segmented (book/product/grid, tight) | container radius 14, buttons radius 11, selected shadow `0 2px 8px rgba(0,0,0,.12)` |
| Status trio (detail) | flex gap 8; `.st` flex:1 height 48 radius 24 border 1px `#D8D8DE` bg `#fff` 15/500; `.st.on` border 0 bg `#151517` color `#fff` 650. Video/recipe/game/mo use height 52 radius 26 |
| Pill button (tint) | height 44, padding 0 16, radius 22, bg `#E4EDFC`, color `#0A55C4`, 15/700 ("Save", "Create", "Set", "Paste") |
| Dashed add button | height 52 (56 in-sheet), radius 14 (28 in-sheet), border 1.5px dashed `#AEAEB8`, bg `transparent` or `rgba(255,255,255,.55)`, color `#0A55C4`, 16/700, plus icon 18 stroke 2.6 |
| Solid blue button | height 52, radius 14, bg `#0B5FD9`, color `#fff`, 17/700 (list-level) |
| Blue glass gradient button | + `box-shadow:inset 0 1.5px 0 rgba(255,255,255,.5),0 10px 24px rgba(11,95,217,.3–.35)` |
| Secondary neutral button | bg `rgba(118,118,128,.16)`, color `#151517`, 650 |
| Danger button | bg `#B3261E`, color `#fff`, 17/700 |
| Ghost cancel (item menu) | `.glass`, height 52, radius 14, color `#151517`, 17/700 |

## 1.6 Cards, rows and badges

| Component | Exact style |
|---|---|
| Library list card | flex gap 12, padding 10, radius 22, bg `#fff`, shadow `0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06)` (light variant `0 4px 14px rgba(0,0,0,.05)`) |
| Card thumb | 84×84 px, radius 16 (20 in Today/Yesterday big rows), solid per-kind color |
| Card thumb small | 64×64 radius 14 (multi-select), 52×52 radius 15–16 (linked rows), 48×48 radius 15 (source rows), 72×72 radius 18 (mentioned rows) |
| Kind badge (`.glass-dark`, on thumb) | absolute left 6–8 top/bottom 6–8, padding 3 8 (or 4 9), radius 8 (10), 10px/700 uppercase +0.08em, color `#fff` |
| Duration badge | absolute right 6–8 bottom 6–8, padding 2 7, radius 8, 11/600, `#fff`, `.glass-dark` |
| NOTE badge (no thumb art) | solid bg `#0A55C4`, same geometry |
| Kind label on hero | `.glass-tint` pill height 36–38, padding 0 14–16, radius 18–19, 13–15/700 +0.08em uppercase, `#fff` |
| Grouped row container (`.grp`) | padding 0 14, radius 22, bg `#fff`, shadow `0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)` |
| Grouped row (`.row`) | flex align-center gap 12, min-height 56 (54 settings/podcast rows), border-bottom 1px `#ECECF0`, font 16 (last row: border 0) |
| Row icon square | 32×32 radius 9–10, bg `#E4EDFC`, color `#0A55C4` (or `#` 800) |
| Key-value row (`.kv`) | flex space-between, min-height 46, font 16, border-bottom `#ECECF0`; left `#636366`, right 600 |
| List icon tile (place `.ic`) | 36×36 radius 11 bg `#E4EDFC` color `#0A55C4` (large 44×44 radius 14) |
| Checkbox (checked) | 28–30 circle (30 recipe, 32 note), radius 15–16, bg `#0B5FD9`, white check `M5 12.5l4.5 4.5L19 7.5` stroke 3 (13px icon in 24px circle) |
| Checkbox (unchecked) | same size, bg `#fff`, border 2px `#C7C7CC` |
| Progress bar | height 6 radius 3 bg `#E5E5EA` fill `#0B5FD9` (note checklist: track `rgba(118,118,128,.16)`; book: height 8 radius 4) |
| Count badge in tab | padding 2 9, radius 10, 13/700, bg `#E5E5EA` (active tab) / `rgba(118,118,128,.16)` (idle), color `#3A3A3C` |
| Tag pill on note rows | padding 3 10, radius 10, bg `#E8F0FD`/`#E4EDFC`, color `#0A55C4`, 12/600 |
| Meta pill (movie) | height 32, padding 0 12, radius 16, bg `#E5E5EA`, color `#2A2640`/`#3A3A3C`, 14/650–700 |
| Switch (detail inline, green) | 52×32 radius 16, bg `#34C759`; knob 26×26 radius 13 `#fff` right 3 top 3, shadow `0 2px 5px rgba(0,0,0,.25)`; off: bg `#D1D1D6`, knob left 3 |
| Switch (game alert) | 54×32 radius 16, bg `#0B5FD9`, shadow `inset 0 1px 2px rgba(0,0,0,.2)` |
| Switch (settings rows) | 51×31 radius 16, knob 27×27 radius 14 top 2 left 22 (on `#0B5FD9`) or left 2 (off `#D1D1D6`), knob shadow `0 2px 4px rgba(0,0,0,.25)` |
| Skeleton (`.sk`) | radius 6, bg `#E5E5EA` |

## 1.7 Sheet anatomy (shared by all bottom sheets)

- Position: absolute, left 0 right 0 bottom 0; radius `28px 28px 0 0`; padding `8px 16px 28–32px`; class `.sheet`.
- Grabber: 36×5 px, radius 3, bg `rgba(60,60,67,.3)`, margin `0 auto 6–10px`.
- Title row: height 44, flex space-between align-center. H1 22/800/-0.025em + close glass button (44×44 r22, X 18px stroke 2.6).
- Section label `.lbl`: margin `14px 2px 6px`, 13/700/+0.06em uppercase `#636366`.
- Field row (`.fld`): height 52, padding 0 14, radius 14, bg `#fff`, shadow `0 0 0 1px #E3E3E8`, font 16, gap 12.
- Full-width primary CTA: margin-top 16, height 52, radius 14, bg `#0B5FD9`, `#fff`, 17/700.
- Dim layer behind: `rgba(0,0,0,.35–.42)` full-screen inset 0.
- Sheets preserve the app behind: mocked as ghost tiles (title 40px at top:54px, cards 104px tall radius 22 at their scroll offsets).

## 1.8 Per-kind tile colors

Thumb fills used for content-kind placeholders (and their hero bands):

| Kind | Tile / hero | Notes |
|---|---|---|
| Video | `#2B3040` | hero `#2B3040`; grid alt `#2F4858`, `#4A3F6B`, `#334155` |
| Article | `#4C5A8A` | hero `#3D4663` |
| Post | `#1f3d2b` | Today row |
| Movie | `#1E2A4F` | hero `#1E2A4F`, poster `#34428a` |
| Recipe | `#c2561a` | hero `#9a4a18`, jump card `#C2561A` |
| Game | `#0c4a54` | hero `#0c3a46`, secondary `#103a8a` |
| Note | thumb `#E8E8ED` + icon `#0A55C4`; badge solid `#0A55C4` | grid alt `#334155` |
| Podcast | `#7A3550` | hero `#7A3550` |
| Place | `#3E5A47`, `#2F4858`, `#6B4B3A` (`#6B4A2B`) | map land `#E8E7E1`, water `#B7D4F0`, park `#CDE4C5` |
| Product | `#5A4B3A` | shot bg `#E5E5EA`, object `#3A3A3C` on `#F2F2F7` |
| Book | cover `#2F4B5C` on paper `#E7DFD0` | |
| Collection | 2×2 mosaic fills from above + `#0A55C4`, `#5E2B49`, `#E5E5EA`, `#E8E8ED` | |

## 1.9 SHARED CHROME (documented once, referenced everywhere)

### Bottom nav + Create FAB (all main-tab screens: 1, 2, 4, 7, 8, 12, 28, 30*)

```
Container: absolute left 0 right 0 bottom 0, padding 0 16px 26px, flex align-center gap 10, z 5
├─ nav.glass: flex:1, height 64, radius 32, padding 0 6, flex space-between align-center, color #3A3A3C
│   ├─ Home  — 44×48 transparent button, 24px grid icon (4 rounded rects 6.5, rx 1.5)
│   ├─ Agent — 44×48, sparkle icon
│   ├─ Library (active) — height 48, padding 0 14, radius 24, bg rgba(255,255,255,.92),
│   │     shadow 0 2px 8px rgba(0,0,0,.16), color #0A55C4, 15/700, book icon 22 + label "Library", gap 7
│   ├─ Tasks — 44×48, check-circle icon
│   └─ Screen — 44×48, display icon
└─ a Create FAB: 64×64, radius 32, bg #0B5FD9, color #fff, plus 28px stroke 2.6,
      shadow inset 0 1.5px 0 rgba(255,255,255,.45–.55),0 12px 28px rgba(11,95,217,.4)
      (full-scroll adds: inset 0 0 0 1px rgba(255,255,255,.18),0 2px 4px rgba(11,95,217,.3))
```

### Detail-screen pinned bottom bar (screens 18–27, 30, 31, 9)

```
Container: absolute left 0 right 0 bottom 0, padding 0 16px 28px, flex align-center gap 10, z 5
├─ Favorite button: 58×58, radius 29, .glass, star icon 24 stroke 2
└─ Discuss with Agent: flex:1, height 58, radius 29, .glass-dark, color #fff, 17/600,
      sparkle icon 22, gap 10
```

### Detail top bar (screens 9, 18–27, 30, 31, 14)

```
Absolute top 0 left 0 right 0, padding 48px 16px 0, flex space-between, z 5
├─ Back: glass 44×44 r22 (46×46 r23 on video/article/movie/recipe/game/note) chevron-left
└─ Right: Share + More, same glass buttons, gap 10
```

Hero band below top bar: `margin: 98px 16px 0`, height 190 (place map 250, book 210, product 210),
radius 32, overflow hidden, per-kind bg.

### Ghost/preview tiles behind sheets (screens 10, 13, 15, 16, 17)

Title `Library` 40/800 at `top:54px;left:16px`; behind cards 104px tall, radius 22, absolute,
widths 16px-inset; dim overlay `rgba(0,0,0,.35)` (confirm-delete `.42`, item-menu `.38`,
share-sheet `.38` over source app mock).

### TagManager/Settings section helpers

`.lbl` `margin:16px 4px 8px; 13/700/+0.07em uppercase #636366`; `.grp` `padding:0 14px; radius 22;
bg #fff; shadow 0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)`;
`.row` `flex align-center gap 12; min-height 56; border-bottom 1px #ECECF0; font 16`.

---

# 2. LIBRARY LIST

## 2.1 Library — full scroll (library-full-scroll.html, 390×1682)

Structure top→bottom (page padding `54px 16px 0`):

1. **Title row** — flex space-between align-start.
   - H1 "Library" 40/44/800/-0.035em.
   - Sync line: margin-top 6, flex gap 6, 14px `#636366`, refresh icon 14 stroke 2.2, text "Synced just now".
   - Right: Search + Sort glass buttons 46×46 r23, gap 10, icons 22.
2. **Segmented** — margin-top 12. "Saved" active (white, 16/700, count badge 371) / "Collections" idle (16/500 `#48484A`, badge "2").
3. **Type chips row** — margin-top 16, horizontal scroll, gap 8: All (selected, dark), Videos, Articles, Posts, Movies, Recipes, Games, Notes.
4. **Jump back in** — label `13/700/+0.07em uppercase #636366`, margin `16px 4px 8px`; then horizontal scroll cards, padding `0 16px 6px`, gap 12:
   - Card: 236×128, radius 24, padding 16, white text, bottom-aligned stack; bg per item with `box-shadow:0 8px 20px <kind-color 25%>`.
   - Eyebrow 12/700/+0.06em uppercase opacity .95 ("Recipe · Cooking" / "Movie · Watchlist" / "Note · Checklist").
   - Title 18/700/-0.01em margin-top 2 ("Creamy Garlic Pasta", "The Long Way Home", "Weekend trip ideas").
   - Sub 13px margin-top 2 ("2 of 6 ingredients ready", "Rated 3 of 5 by you", "1 of 4 done").
   - Bgs/shadows: `#C2561A` / `rgba(194,86,26,.25)`; `#1E2A4F` / `rgba(90,42,110,.28)`; `#3157C8` / `rgba(74,47,176,.28)`.
5. **Today group** — header row (label "Today" + right span "1 saved" 14 `#636366`), then one large card:
   - Card: flex gap 12, padding 10, radius 22, bg `#fff`, shadow `0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06)`.
   - Thumb 84×84 radius 20 bg `#1f3d2b` (post), POST badge `.glass-dark` left 8 bottom 8 padding 4 9 radius 10 10/700 +0.08em.
   - Body: title 17/22/650/-0.01em "A guy used Grok to fix his parents' slow Wi-Fi"; meta 13 `#636366` "Post"; tag chip `padding 3 10 radius 10 bg #E8F0FD color #0A55C4 12/600` "Artificial Intelligence (AI)". Gap 5.
6. **Yesterday group** — same header ("Yesterday", "1 saved"); card with thumb bg `#4C5A8A`, ARTICLE badge; title "carterpcs Welcome back #carterpcs"; meta "Article · tikvib.com".
7. **This week group** — header ("This week", "369 saved"); vertical stack gap 8 of standard cards:
   - Video card: thumb `#2B3040`, VIDEO badge top-left, duration 35:28 bottom-right (padding 3 8, 11/600); title "Capcom invited me to Gamescom in Thailand"; meta "Video · Shubhuuu".
   - Game card: thumb `#0c4a54`, GAME badge; title "Monster Hunter Wild Ascendance"; meta "Game · Capcom"; status chip "Wishlist" (`#E4EDFC`/`#0A55C4` 12/600).
   - Recipe card: thumb `#b5501a`, RECIPE badge; "Creamy Garlic Pasta"; "Recipe · 35 min · Easy".
   - Movie card: thumb `#1E2A4F`, MOVIE badge; "The Long Way Home"; "Movie · 2024 · Drama".
   - Note card: thumb `#E8E8ED` with document icon 34 stroke 1.8 color `#0A55C4`, NOTE badge solid `#0A55C4`; "Weekend trip ideas"; "Note · 1 of 4 done"; tag chips row gap 6 "#travel" "#ideas".
8. **Continuation stack** — margin-top 8, gap 8, compact cards (thumb radius 16, badges left 6/top 6, title 16/21):
   - "Setup Tour 2026" (Video · youtu.be, 12:04), "Singapore Vlog" (Video · youtu.be, 18:40), "carterpcs Welcome back #carterpcs" (Article · tikvib.com). Shadow `0 4px 14px rgba(0,0,0,.05)`.
9. **Bottom bar** — shared nav + FAB (§1.9).

Interactions implied: segmented tab switch (Saved/Collections), horizontal chip filter, horizontal
"Jump back in" rail, card tap → detail, search + filter buttons.

## 2.2 Library — grid view (library-grid-view.html, 390×868)

Structure:

1. **Header** — padding `54px 16px 0`, flex space-between align-center: H1 "Library" 40/800/-0.035em;
   right pair of glass buttons 44×44 r22 gap 8 — List view (icon rows, color `#636366`) and Grid view
   (icon 4-square, color `#0A55C4` = active).
2. **Type chips** — padding `12px 16px 0`, gap 8, overflow hidden (frozen): All (selected: height 40,
   padding 0 16, radius 20, bg `#151517`, `#fff`, 15/650) + Videos / Games / Recipes (idle: bg `#fff`,
   `box-shadow:0 0 0 1px #D8D8DE`, 15/500).
3. **Grid** — padding `14px 16px 0`, `grid-template-columns:repeat(3,1fr)`, `gap:12px 10px`.
   Item: square thumb `aspect-ratio:1/1; border-radius:18px; background:<kind color>`; caption
   margin `6px 2px 0`, 13/600/17, nowrap ellipsis. Items/colors:
   Gamescom trip `#2B3040`, Hades II `#0c4a54`, Pasta `#c2561a`, Dune `#1E2A4F`, Design post
   `#4C5A8A`, Podcast `#7A3550`, Cabin `#3E5A47`, Keyboard `#5A4B3A`, Old Town `#2F4858`,
   Berlin `#6B4A2B`, Notes `#334155`, Setup tour `#4A3F6B`.
4. Scroll spacer `height:120px`.
5. **Bottom bar** — shared nav + FAB.

No badges/durations on grid tiles. Glass on this screen uses the `.55` variant.

## 2.3 Multi-select (multi-select.html, 390×844)

Structure:

1. **Header** — padding `54px 16px 0`, flex space-between align-center:
   "Cancel" (transparent button h44, `#0A55C4` 17/600) · "3 selected" (17/700 centered) · "Select all" (same style).
2. **Rows** — padding `14px 16px 0`, flex column gap 10. Row:
   flex align-center gap 12, padding `10px 14px 10px 12px`, radius 22, bg `#fff`.
   - Selected: shadow `0 0 0 2px #0B5FD9,0 4px 14px rgba(0,0,0,.05)`; check circle 28×28 radius 14 bg `#0B5FD9`, white check 16 stroke 3.
   - Unselected: shadow `0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)`; empty circle 28×28 radius 14, bg `#fff`, border 2px `#B8B8C0`.
   - Thumb 64×64 radius 14 per-kind color. Title 16/21/650 2-line clamp. Meta 13 `#636366` margin-top 2 ("Video · 35:28", "Game · Wishlist", "Recipe · 35 min", "Movie · Watchlist", "Article · 6 min", "Video · 12:04").
   - Items: 4 selected (Gamescom video, Hades II, Dune) + 3 unselected (Creamy mushroom pasta `#c2561a`, Why side projects stall `#4C5A8A`, Setup Tour 2026 `#334155`).
3. Scroll spacer `height:140px`.
4. **Selection toolbar** (replaces bottom nav) — absolute bottom 0, padding `0 16px 28px`, z 5:
   `.glass-dark` container radius 32 padding `4px 6px` flex. Four equal buttons (flex:1, height 56,
   transparent, white, column, gap 3, 12/600, icon 22 stroke 2):
   **Collect** (folder+ icon), **Tag** (tag icon), **Share** (up-tray icon), **Delete** (trash, color `#FF8A80`).

Implies: long-press enters select; toolbar actions → Add to collection sheet, tag edit, share, delete confirm.

## 2.4 Empty library (empty-library.html, 390×844)

Structure:

1. **Header** — as 2.1 but only a Search glass button (no sort); segmented with radius 14/buttons 11,
   badges 0/0, Saved active, shadow `0 2px 8px rgba(0,0,0,.12)`.
2. **Illustration** — 200×150 centered, margin `34px auto 0`: two tilted cards
   (`120×104 r22`, left `#D6E4FB` rotate(-8deg) at left 14/top 18; right `#E5E5EA` rotate(7deg)),
   center card `120×120 r26 bg #fff` shadow `0 8px 24px rgba(0,0,0,.10)` holding a
   `52×52 r26 bg #0B5FD9` circle with white plus 26 stroke 2.6.
3. **Copy block** — text-align center, padding 0 40: H2 24/800/-0.025em "Nothing saved yet";
   p margin-top 8, 16/23 `#636366`: "Save links, videos, recipes, movies and notes. Everything lands here, sorted and searchable."
4. **Primary CTA** — margin `20px 16px 0`: full-width button height 52 radius 14 bg `#0B5FD9` 17/700 "Save your first link".
5. **Ways to save** — h3 margin `24px 20px 8px` 13/700/+0.06em uppercase `#636366` "Ways to save";
   group card (margin 0 16, padding 0 14, radius 22, bg `#fff`, shadow `0 1px 2px rgba(0,0,0,.05)`) with rows min-height 54, border-bottom `#ECECF0`:
   - "Share from any app" — icon 36×36 r11 `#E4EDFC`/`#0A55C4` (down-tray), 16/600.
   - "Paste a link" — link icon, same tile.
6. **Bottom bar** — shared nav + FAB.

## 2.5 Collections tab — new (collections-new.html, 390×1010)

Structure (Collections segmented active):

1. Header (H1 + sync + search glass 46). Segmented radius 20/16, Collections active (badge "2").
2. **New collection button** — margin-top 12, full-width height 56 radius 28, border 1.5px dashed
   `#AEAEB8`, bg `rgba(255,255,255,.55)`, color `#0A55C4`, 16/700, plus 18 stroke 2.6, gap 8: "New collection".
3. **Your collections** — label margin `16px 4px 8px`; 2-col grid gap 8. Collection card:
   - padding 8, radius 22, bg `#fff`, shadow `0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06)`.
   - Mosaic: 2×2 grid gap 4, height 150, radius 20, overflow hidden; 4 solid fills
     (Gaming: `#2B3040`,`#0c4a54`,`#c2561a`,`#5E2B49`; Travel: `#0A55C4`, note-icon cell `#E8E8ED`
     with 26px document icon `#0A55C4`, `#E5E5EA`, `#2B3040`).
   - Text: padding `12px 6px 6px`; name 17/700/-0.01em ("Gaming","Travel"); count 14 `#636366`
     margin-top 2, literal copy "[n] saves".
4. **Smart groups** — label; `.grp` list of rows min-height 54 (icon 44×44 r14 `#E4EDFC`/`#0A55C4`
   — star, check-circle; "Not opened yet" tile `#FDEBDD`/`#A8480E` clock; title 17/600; chevron-right 18 `#636366` stroke 2.2):
   "Favorites", "Wishlist and watchlist", "Not opened yet".
5. **Recently added** — label; standard compact cards (thumb 84 r16, badges left 6/top 6):
   "Capcom invited me to Gamescom in Thailand" (Video · Shubhuuu, 35:28) and
   "Monster Hunter Wild Ascendance" (Game · Capcom).
6. **Bottom bar** — shared nav + FAB.

## 2.6 Empty collections (empty-collections.html, 390×844)

1. Header + segmented (radius 14/11) with Collections active, badge "0", Saved idle badge "371".
2. **Illustration** — 180×120 centered margin `40px auto 0`: tilted `104×92 r20` cards
   (`#D6E4FB` rotate(-6deg), `#E5E5EA` rotate(6deg)), center `104×104 r24 #fff` shadow
   `0 8px 24px rgba(0,0,0,.10)` with folder icon 38 stroke 1.8 `#0A55C4`.
3. **Copy** — H2 24/800 "Group your saves"; p 16/23 `#636366`: "Collections keep related saves together, like a trip, a project or a watch list."
4. **CTA** — margin `18px 16px 0`, height 52 radius 14 `#0B5FD9` 17/700 "New collection".
5. **Suggested from your tags** — h3 "Suggested from your tags"; group rows min-height 60:
   `#` tile 40×40 r12 `#E4EDFC`/`#0A55C4` 16/800; name 16/650 ("Gaming","Travel"); sub 13 `#636366`
   ("From #gaming and #capcom" / "From #travel"); right "Create" pill button
   (h44 padding 0 16 radius 22 bg `#E4EDFC` `#0A55C4` 15/700).
6. **Bottom bar** — shared nav + FAB.

---

# 3. SEARCH

## 3.1 Search — new (search-new.html, 390×880)

1. **Search bar row** — padding `54px 16px 0`, flex gap 10:
   - Hidden `<label for=q>` "Search your library".
   - Field: `.glass` flex:1 height 52 radius 26 padding `0 8px 0 16px`, focused state
     `box-shadow:inset 0 0 0 1.5px #0B5FD9,0 0 0 4px rgba(11,95,217,.14)`.
     Inside: search icon 20 `#636366`; input 17px `#151517` value "capcom";
     Clear button 36×36 radius 18 bg `rgba(118,118,128,.18)` color `#3A3A3C`, X 14 stroke 3.
   - "Cancel" — h44 padding 0 4, transparent, `#0A55C4` 17/600.
2. **Type chips** — margin-top 16, horizontal scroll, gap 8: All (dark selected) + Videos, Games, Articles, Notes, Recipes.
3. **Results** — header flex space-between: label "Results" + "2 matches" (14 `#636366`).
   Stack gap 8 of link cards (flex gap 12, padding 10, radius 22, bg `#fff`, shadow
   `0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06)`):
   - Thumb 88×88 radius 18 (video with duration pill solid `rgba(28,28,30,.78)` right 6 bottom 6,
     padding 2 7 radius 8 11/700; game plain `#0c4a54`).
   - Title 16/21/650 with `<mark>` highlight: `background:#D6E4FB; color:inherit; border-radius:4px; padding:0 2px` around "Capcom".
   - Meta 13 `#636366` ("Video · Shubhuuu"; "Game · Capcom · Wishlist" — "Capcom" also marked).
4. **Recent searches** — header: label "Recent searches" + "Clear" button (h44, `#0A55C4` 15/600).
   Group card padding `2px 18px`, radius 22: rows min-height 48, border-bottom `#ECECF0`,
   clock icon 20 `#636366` stroke 2, text 17 ("pasta", "#travel", "wishlist games").
5. **Browse by** — label "Browse by"; 2-col grid gap 8. Tile: flex gap 12 padding `14px 16px`
   radius 24 bg `#fff` shadow `0 1px 2px rgba(0,0,0,.05)`; icon 40×40 radius 13
   (Tags: `#E4EDFC`/`#0A55C4` slider icon; Creators: same blue person icon; Sources:
   `#E4F5EA`/`#14703A` globe; Date saved: `#FDEBDD`/`#A8480E` calendar); label 16/650.

## 3.2 No search results (no-search-results.html, 390×844)

1. Search bar row (same as 3.1, value "capcom pasta"; focus ring without halo:
   `box-shadow:inset 0 0 0 1.5px #0B5FD9`).
2. **Active filter chips** — margin-top 12: "Videos" (dark selected), "Last 7 days", "#gaming" (idle).
3. **Empty state** — centered padding 0 40, margin-top 84:
   - Icon tile 88×88 radius 28 bg `#E5E5EA` color `#636366`, search-minus icon 40 stroke 1.8.
   - H2 22/800/-0.025em: `No results for "capcom pasta"` (curly quotes).
   - p 16/23 `#636366`: "Nothing matches that in Videos from the last 7 days with #gaming. Try fewer words or remove a filter."
   - Button margin-top 18: full-width height 52 radius 14 bg `#0B5FD9` 17/700 "Clear all filters".
4. **Try instead** — h3 margin `28px 20px 8px` "Try instead"; wrap row padding 0 16, gap 8:
   suggestion chips (h44 padding 0 16 radius 22 border 1px `#D8D8DE` bg `#fff` 15/500):
   "capcom", "pasta", "gamescom".

---

# 4. COLLECTIONS DETAIL

## 4.1 Collection detail (collection-detail.html, 390×844)

Local helpers: `.card` = compact list card; `.tag` = `position:absolute;left:6px;top:6px;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.08em;color:#fff` (applied over `.glass-dark`).

1. **Top bar** — absolute `48px 16px 0`, z 5: Back glass 44×44 r22 left; right Share + More glass, gap 10.
2. **Header** — padding `104px 16px 0`, flex align-center gap 14:
   - Mosaic 68×68 radius 18 (2×2 gap 3; fills `#2B3040`,`#0c4a54`,`#c2561a`,`#1E2A4F`).
   - H1 32/36/800/-0.03em "Gaming"; sub margin-top 2, 14 `#636366` "4 saves · Updated today".
3. **Sort chips** — margin-top 14, horizontal scroll, gap 8: "Recent" (dark selected),
   "Type", "A to Z", "Wishlist only" (idle).
4. **Cards** — margin-top 12, stack gap 8, `.card` (84×84 r16 thumb, VIDEO/GAME `.tag` badges,
   duration pills right 6 bottom 6 padding 2 7 radius 8 11/600):
   Gamescom video 35:28; "Monster Hunter Wild Ascendance" (Game · Capcom · Wishlist);
   "Setup Tour 2026" (Video · youtu.be, 12:04); "Mega Man Dual Overdrive" (thumb `#103a8a`, Game · Capcom).
5. **Add saves CTA** — margin-top 4: full-width h52 radius 14, border 1.5px dashed `#AEAEB8`,
   transparent bg, `#0A55C4` 16/700: "Add saves to Gaming".
6. **Bottom bar** — detail variant: Edit collection glass circle 58×58 r29 (pencil icon 24),
   + `.glass-dark` "Discuss with Agent" flex:1 h58 r29 (sparkle 22) — same as §1.9.

---

# 5. CREATE + SAVE FLOWS

## 5.1 Create sheet — new (create-sheet-new.html, 390×844)

Behind: ghost Library (title at top 54; segmented bar mock `height:44 radius:14 bg rgba(118,118,128,.12)` at top 150; card blocks 104 tall at 214/326/438/550 in `#2B3040`,`#0c4a54`,`#c2561a`,`#1E2A4F`); dim `rgba(0,0,0,.35)`.

Sheet (`.sheet`, padding `8px 16px 32px`, radius `28 28 0 0`):

1. Grabber 36×5, margin `0 auto 10px`.
2. Title row h44: H1 22/800/-0.025em "New save" + close glass X 44×44 r22.
3. **Link field** — label margin `12px 2px 6px` 13/700/+0.06em uppercase `#636366` "Link";
   field: flex gap 10 height 52 padding `0 6px 0 14px` radius 14 bg `#fff`
   `box-shadow:0 0 0 1.5px #0B5FD9`; link icon 20 `#636366`; input 16px value "youtu.be/capcom-gamescom";
   "Paste" button h40 padding 0 14 radius 10 bg `#E4EDFC` `#0A55C4` 15/700.
4. **Kind grid** — label margin `16px 2px 6px` "Or start from scratch"; grid 4 cols gap 8.
   Tile (`.tile`): height 76 radius 14 bg `#fff` shadow `0 0 0 1px #E3E3E8`, column, gap 6,
   icon 24 stroke 2 + label 13/600:
   Video (icon `#0A55C4`), Article (`#4C5A8A`), Post (`#14703A`), Movie (`#A3204F`),
   Recipe (`#A8480E`), Game (`#0B5560`), Note (`#3A3A3C` pencil), Checklist (`#3A3A3C` check-circle).
5. **CTA** — margin-top 16: full-width h52 radius 14 bg `#0B5FD9` 17/700 "Save to Library".

## 5.2 Share sheet — save (share-sheet-save.html, 390×844)

Behind: mocked source app (bg `#fff`; `#F2F2F7` band 96 tall; address bar mock `36×36px`—`height:36;radius:12;bg #E5E5EA` at top 54; hero block 230 tall `#2B3040` at top 116; text bars `300×22` `#E5E5EA` and `200×16` `#EDEDF0`); dim `rgba(0,0,0,.38)`.

Sheet (`.sheet`, padding `8px 16px 28px`):

1. Grabber 36×5 margin `0 auto 6px`.
2. Title row h44: app icon 32×32 r10 `#0B5FD9` (book logo 18 white) + H1 20/800/-0.02em "Save to Amethyst" (gap 10); right "Cancel" h44 padding 0 4 `#0A55C4` 17/600.
3. **Preview card** — margin-top 8: flex gap 12, padding 10, radius 14, bg `#fff`,
   `box-shadow:0 0 0 1px #E3E3E8`. Thumb 76×76 radius 10 `#2B3040` with duration pill
   (solid `rgba(28,28,30,.78)`, right 5 bottom 5, padding 2 6 radius 7, 11/600) "35:28".
   Title 16/21/650; meta 13 `#636366` "youtu.be · Shubhuuu". Gap 3.
4. **Saving as** — `.lbl` "Saving as"; `.fld` row: type tile 28×28 r9 `#E4EDFC`/`#0A55C4` (play-rect 16 stroke 2.2), "Video" 650, right "Detected" 13 `#636366` + chevron-down 16 stroke 2.4 `#636366`.
5. **Collection** — `.lbl`; `.fld`: folder icon 20 `#3A3A3C`, "Gaming" 650, chevron-down.
6. **Tags** — `.lbl` "Tags"; chips wrap gap 8: `#gaming` `#capcom` (`.c.on`: bg `#0B5FD9` white 650),
   `#travel` `+ Tag` (`.c`: white, border `#D8D8DE`, 15/500).
7. **Note** — `.lbl`; `.fld` color `#8E8E93` copy "Add a note (optional)".
8. **CTA** — margin-top 16 h52 radius 14 `#0B5FD9` 17/700 "Save".

## 5.3 Saving and failed (saving-and-failed.html, 390×844)

Structure (normal Library screen with sync header):

1. Header — H1 + sync line in progress: color `#0A55C4` 600, spin icon 14 stroke 2.6, copy "Syncing 2 saves"; Search glass 46.
2. **Saving now** — `.lbl` margin-top 20; `.card`:
   - Thumb 84×84 r16 bg `#E5E5EA` with spinner (arc `#0B5FD9` stroke 2.6 over full circle `#C7C7CC` opacity .6).
   - Title 16/650 "Reading link…"; meta 13 `#636366` "youtu.be/capcom-gamescom";
   - Progress: height 6 radius 3 track `#E5E5EA`, fill 55% `#0B5FD9`;
   - Step text 12 `#636366` "Step 2 of 4 · Finding title and creator".
3. **Skeleton card** — `.card` margin-top 8: `.sk` thumb 84×84 r16; right stack gap 8:
   bars `14×92%`, `14×64%`, `10×38%` (margin-top 4), bg `#E5E5EA` radius 6.
4. **Needs attention** — `.lbl` margin-top 22; failed card:
   - padding 12 radius 22 bg `#fff` `box-shadow:0 0 0 1.5px #E8B4AF`.
   - Row: icon 44×44 r14 bg `#FDECEA` color `#B3261E` (alert-triangle 22 stroke 2.2);
     title 16/650 `#B3261E` "Couldn't read this link"; meta 13 `#636366` margin-top 2 "The site blocked access · example.com/post/9281".
   - Buttons margin-top 12, gap 8, each flex:1 h44 radius 12:
     "Try again" (bg `#0B5FD9` `#fff` 15/700) · "Save as plain link" (bg `#E5E5EA` `#151517` 15/650).
5. **Saved** — `.lbl` margin-top 22; `.card` with article thumb `#4C5A8A` ARTICLE badge; "carterpcs Welcome back #carterpcs" (Article · tikvib.com).
6. **Toast** — absolute `left 16 right 16 bottom 104`, height 52, radius 26, `.glass-dark`,
   padding `0 8px 0 16px`, flex gap 10, z 6: green check 20 `#5FD38D` stroke 2.6; "Saved to Library"
   flex:1 15/600 `#fff`; "Undo" button h40 padding 0 14 radius 20 bg `rgba(255,255,255,.16)` `#fff` 14/700.
7. **Bottom bar** — shared nav + FAB.

---

# 6. FILTER, SORT AND TAGS

## 6.1 Filter and sort sheet (filter-and-sort.html, 390×844)

Behind: ghost Library (title top 54; two 104-tall card mocks `#2B3040`,`#0c4a54` at 150/262); dim `rgba(0,0,0,.35)`.

Sheet (`.sheet`, padding `8px 16px 28px`):

1. Grabber; title row: H1 22/800 "Filter and sort" + close glass X.
2. **Type** — `.lbl` "Type"; `.chips` wrap gap 8: Videos `.on`, Articles, Posts, Movies, Recipes,
   Games `.on`, Books, Places, Notes (`.c` chips; `.on` blue).
3. **Saved** — `.lbl`; mini segmented (radius 14, buttons h40 r11, 14/500 idle / 14/700 selected
   white bg shadow `0 2px 8px rgba(0,0,0,.12)`): "Any time", "Today", "7 days" (selected), "30 days".
4. **Status** — `.lbl`; chips: Wishlist `.on`, Playing, Played, Watchlist, Favorites.
5. **Tags** — `.lbl`; chips: #gaming `.on`, #capcom, #travel, #youtube, #ideas.
6. **Sort by** — `.lbl`; segmented: "Newest" (selected), "Oldest", "A to Z", "Last opened".
7. **Footer buttons** — flex gap 8 margin-top 18:
   "Reset" (flex:1 h52 r14 bg `rgba(118,118,128,.16)` `#151517` 17/650) ·
   "Show 2 results" (flex:2 h52 r14 bg `#0B5FD9` `#fff` 17/700).

## 6.2 Tag manager (tag-manager.html, 390×931)

1. **Top bar** — absolute `48px 16px 0` z 5: Back glass 44×44 r22; right "Merge" glass text button
   (h44 padding 0 18 radius 22 `#0A55C4` 16/700).
2. **Header** — padding `98px 16px 0`: H1 34/800/-0.035em "Tags" (margin 0 4px); sub margin
   `2px 4px 0` 15 `#636366` "8 tags used across your library".
3. **Search mock** — margin-top 12: h48 radius 14 bg `rgba(118,118,128,.12)`, flex gap 10
   padding 0 14, search icon 20, placeholder text 16 `#636366` "Find a tag".
4. **All tags** — `.lbl` "All tags"; `.grp` with rows (h≥56, 32×32 r10 `#E4EDFC`/`#0A55C4` `#` 800;
   name 650 16px; count 14 `#636366` "14 items"; edit pencil button 44×44 transparent `#636366`):
   gaming 14, capcom 3, travel 9, youtube 22, ideas 6, recipes 11, watch-later 17, books 4.
5. **Suggested** — `.lbl` "Suggested"; `.grp` row: text 15 `#2C2C2E` "Merge **#youtube** and **#video**?"
   (bold names); "Merge" button h40 padding 0 16 radius 20 bg `#0B5FD9` `#fff` 15/700.
6. Spacer 120px.
7. **Bottom bar** — single full-width `.glass` button (padding `0 16px 28px` absolute bottom):
   h56 radius 28, `#0A55C4` 17/700: "New tag".

---

# 7. ITEM ACTIONS

## 7.1 Item menu sheet (item-menu.html, 390×844)

Behind: ghost Library (3 white card mocks at 128/240/352); dim `rgba(0,0,0,.38)`.

Also on screen: **lifted card** — absolute top 70, margin 16, flex gap 12 padding 10 radius 22 bg `#fff`
shadow `0 16px 40px rgba(0,0,0,.30)` (thumb 84×84 r16 `#2B3040` + duration pill solid `rgba(28,28,30,.75)`;
title 16/21/650; meta 13) — the row the menu belongs to.

Sheet (`.sheet`, padding `8px 16px 30px`):

1. Grabber.
2. **Action rows** (`.act`): flex align-center gap 14, width 100%, height 50, padding 0 4,
   border-bottom 1px `rgba(60,60,67,.12)`, transparent, `#151517`, 17/500, left-aligned, icon 22:
   Share · Add to collection · Add to favorites (star) · Edit tags · Re-enrich (refresh) ·
   Open original (arrow-up-right) · Archive (archive-box) ·
   **Delete** — color `#B3261E`, border-bottom 0, trash icon.
3. **Cancel** — `.glass` margin-top 10 full-width h52 radius 14 `#151517` 17/700.

## 7.2 Confirm delete (confirm-delete.html, 390×844)

Behind: ghost Library (4 card mocks at 128/240/352/464 in `#fff`,`#2B3040`,`#0c4a54`,`#fff`); dim `rgba(0,0,0,.42)`.

Alert dialog (role alertdialog, `.alert`):
- Geometry: absolute left 32 right 32, vertically centered (`top:50%;margin-top:-150px`),
  radius 28, padding `22px 16px 16px`, text-align center.
- Icon: 52×52 radius 26 bg `#FDECEA` color `#B3261E`, trash icon 26 stroke 2.
- Title (id t) margin-top 14: 20/800/-0.02em "Delete this save?".
- Body (id d) margin-top 8: 15/21 `#48484A`: ""Capcom invited me to Gamescom in Thailand" and its 7 links will be removed from your Library. This can't be undone."
- Buttons margin-top 18, column gap 8: "Delete" (h50 r14 bg `#B3261E` `#fff` 17/700) ·
  "Cancel" (h50 r14 bg `rgba(118,118,128,.16)` `#151517` 17/650).
- Text button margin-top 4: h44 transparent `#0A55C4` 15/650 "Archive instead".

## 7.3 Add to collection sheet (add-to-collection.html, 390×844)

Behind: ghost Library (3 card mocks `#2B3040`,`#0c4a54`,`#c2561a` at 128/240/352); dim `rgba(0,0,0,.35)`.

Sheet (`.sheet`, padding `8px 16px 32px`):

1. Grabber margin-bottom 10; title row: H1 22/800 "Add to collection" + close glass X.
2. **Item chip** — margin-top 12: flex gap 12, height 64, padding 0 10, radius 14, bg `#fff`,
   `box-shadow:0 0 0 1px #E3E3E8`; thumb 44×44 r10 `#2B3040`; title 15/650 nowrap ellipsis;
   meta 13 `#636366` "Video · Shubhuuu".
3. **Collections** — label margin `16px 2px 6px`; list container radius 14 bg `#fff`
   `box-shadow:0 0 0 1px #E3E3E8` overflow hidden. Row (`.rowc`): flex gap 12, height 60,
   padding 0 14, border-bottom `#ECECF0`:
   - Gaming — check circle 30×30 r15 bg `#0B5FD9` white check 16 stroke 3; name 17/600; count 14 `#636366` "3 saves".
   - Travel — empty circle 30 r15 border 2px `#C7C7CC`; "1 save".
   - "New collection" button: full-width h60 padding 0 14, transparent, `#0A55C4` 17/650, left-aligned,
     plus circle 30×30 r15 bg `#E4EDFC` (plus 16 stroke 3).
4. **CTA** — margin-top 16 h52 r14 `#0B5FD9` 17/700 "Done".

---

# 8. DETAIL SCREENS

Shared: §1.9 detail top bar (Back 46×46 r23 + Share/More), pinned bottom bar (Favorite 58 glass +
glass-dark "Discuss with Agent"), hero band `margin:98px 16px 0` height 190 radius 32,
Overview/Links/Notes segmented (radius 20/16 unless noted), key-value group rows (`#636366` left, 600 right),
bullet lists (dot 8×8 radius 4 bg `#0B5FD9` margin-top 9 + text 16/25 `#2C2C2E`, rows padding 10 0
border-bottom `#ECECF0`, last row 16 0), detail white cards radius 22 shadow
`0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06)`.

## 8.1 Video — Overview (video-overview.html, 390×1620)

1. Hero 190 r32 bg `#2B3040`: play button glass 80×80 r40 centered (left 50% top 56%, margin -40 0 0 -40),
   play icon 30 filled white; duration `.glass-dark` pill right 16 bottom 16 padding 6 12 radius 14 14/600 "35:28".
2. Top bar (46px glass buttons).
3. H1 26/33/800/-0.03em "Capcom invited me to Gamescom in Thailand" (margin 12 0 0).
4. **Creator row** — margin-top 14 flex gap 12: avatar 48×48 r24 bg `#151517` white letter "S" 18/700;
   name 16/700 "Shubhuuu"; meta 14 `#636366` "YouTube · Nov 8, 2026 · Video";
   right "Open" pill (h44 padding 0 18 r22 bg `#E4EDFC` `#0A55C4` 15/700 + arrow-up-right 14 stroke 2.6).
5. **Tabs** — margin-top 12: Overview active; "Links 7" and "Notes 0" idle with count badges.
6. **Executive overview** — margin-top 12, card padding `14px 16px`: header
   (sparkle 16 stroke 2.2 + 13/700/+0.07em uppercase `#0A55C4`) "Executive overview";
   p margin-top 10 17/26 `#2C2C2E` (full enrichment text); "Show less" button margin-top 10
   h44 transparent `#0A55C4` 16/600 + chevron-up 16 stroke 2.6.
7. **Summary** — header flex space-between margin `16px 0 8px`: H2 22/800/-0.02em "Summary" +
   "Re-enrich" pill (h44 padding 0 18 r22 `#E4EDFC`/`#0A55C4` 15/700 + refresh 16 stroke 2.4).
   Bullet card (padding `6px 20px`): 4 bullets — "Invited by Capcom to Gamescom in Thailand",
   "Early access to Monster Hunter Wild Ascendance", "Early access to Mega Man Dual Overdrive",
   "Titles shown for PC, PS5 and Xbox".
8. **Mentioned in this video** — header: H2 22/800 + count 14 `#636366` "2 games". Rows gap 8
   (padding 12 r22, thumb 72×72 r18, title 17/650, meta 14 margin-top 2, chevron 18 `#636366`):
   - "Monster Hunter Wild Ascendance" (`#0c4a54`, Game · Capcom · Action RPG) → link.
   - "Mega Man Dual Overdrive" (`#103a8a`, Game · Capcom) with "Save" pill (h44 padding 0 16 r22 `#E4EDFC`/`#0A55C4` 15/700).
9. **Details** — H2 22/800 "Details"; kv group (padding `4px 20px`): Source YouTube; Creator Shubhuuu;
   Published Nov 8, 2026; Length 35:28.
10. Pinned bottom bar.

## 8.2 Video — Links (video-links.html, 390×1170)

1. Hero identical to 8.1 (duration "35:28").
2. Top bar; H1; creator row; tabs with "Links 7" active (badge bg `#E5E5EA`), Overview/Notes idle.
3. **Source link** — label `13/700/+0.07em` "Source link" (margin `16px 4px 8px`); link card
   (padding 12 r22, flex gap 12): favicon tile 52×52 r16 bg `#F2F2F7` with YouTube logo SVG 28×20
   (`rect rx6 fill #E32D2D` + white triangle); title 16/650 nowrap-ellipsis (`.clip`);
   meta 14 `#636366` margin-top 2 "youtu.be"; right badge "Original"
   (padding 5 11 radius 12 bg `#E3F3E9` color `#12663A` 12/700).
4. **Referenced resources** — header: uppercase label + count "6" 14 `#636366`.
   Group card (padding `2px 16px`): rows flex gap 12 padding `10px 0` border-bottom `#ECECF0`,
   min-height 48: favicon 48×48 r15 bg `#F2F2F7` (YouTube) / `#DDF1F3` (gamepad `#0B5560`) /
   `#E4EDFC` (globe `#0A55C4`); title 16/650 `.clip`; meta 13 `.clip` "youtu.be · Tour of gaming setup" etc.;
   right type badge (padding 4 10 radius 11 12/700): "Other" (`#ECECF0`/`#3A3A3C`),
   "Game" (`#DDF1F3`/`#0B5560`), "Site" (`#E4EDFC`/`#0A55C4`).
   Rows: Setup Tour 2026 (Other, youtu.be · Tour of gaming setup); Singapore Vlog (Other, youtu.be);
   Monster Hunter Wild Ascendance (Game, "Saved in your Library"); Mega Man Dual Overdrive
   (Game, "Not saved yet", non-link); Capcom (Site, "Publisher website"); Gamescom event page (Site, "Event website").
5. **Add a link** — margin-top 16: full-width h56 radius 28 border 1.5px dashed `#AEAEB8`
   bg `rgba(255,255,255,.55)` `#0A55C4` 16/700 + plus 18 stroke 2.6.
6. Pinned bottom bar.

## 8.3 Video — Notes (video-notes.html, 390×950)

1. Hero; top bar; H1; creator row; tabs with "Notes 0" active (badge `#E5E5EA`).
2. **Tags** — H2 22/800 "Tags" (margin `16px 4px 8px`); wrap gap 8: tag chips dark
   (h44 padding 0 18 r22 bg `#151517` `#fff` 16/600): #gaming, #capcom, #travel, #youtube;
   "+ Tag" dashed (h44 padding 0 18 r22 border 1.5px dashed `#AEAEB8` transparent `#0A55C4` 16/600).
3. **Private notes** — header: H2 22/800 "Private notes" + sub (flex gap 6 margin-top 3, 13 `#636366`,
   lock 13 stroke 2.2) "Only you can see these"; right "Save note" button
   (h46 padding 0 20 r23 bg `#0B5FD9` `#fff` 16/700, shadow `inset 0 1.5px 0 rgba(255,255,255,.5),0 8px 18px rgba(11,95,217,.3)`).
4. **Editor card** — radius 22 bg `#fff` shadow `0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06)`
   overflow hidden: textarea 100%×150 padding 20, 17/25 `#151517`, placeholder
   "Add your personal thoughts or private notes here…"; toolbar row padding `8px 12px`
   border-top `#ECECF0` bg `#F8F8FA` gap 8: "Add timestamp" pill (h44 padding 0 14 r22 `#E4EDFC`/`#0A55C4`
   15/700 + clock 16 stroke 2.4); checklist icon button 44×44 transparent `#3A3A3C`; bullet-list icon button.
5. Pinned bottom bar.

## 8.4 Article (article-new.html, 390×1080)

1. Hero 190 r32 bg `#3D4663` with `.glass-tint` label pill left 16 bottom 16
   (h36 padding 0 14 r18 `#fff` 13/700/+0.08em uppercase) "ARTICLE".
2. Top bar (46px buttons).
3. H1 28/33/800/-0.03em "carterpcs Welcome back #carterpcs"; meta margin `6px 4px 0`
   15 `#636366` "Article · tikvib.com · Saved yesterday".
4. **Action row** — margin-top 12 flex gap 10: "Read original" (flex:1 h52 r26 bg `#0B5FD9` `#fff`
   17/700, shadow `inset 0 1.5px 0 rgba(255,255,255,.5),0 10px 24px rgba(11,95,217,.3)`,
   arrow-up-right 16 stroke 2.6) + "Mark as read" glass circle 52×52 r26 (check-circle 22).
5. **Tabs** — margin-top 12: Overview active, Links 1, Notes 0.
6. **Quick summary** — card margin-top 12 (padding `14px 16px`): sparkle header uppercase `#0A55C4`
   "Quick summary"; p 17/26 `#2C2C2E` placeholder "[A two or three sentence summary of the article appears here once it has been enriched.]".
7. **Key takeaways** — H2 22/800 "Key takeaways"; bullet card: "[Takeaway one]", "[Takeaway two]", "[Takeaway three]".
8. **Details** — kv group: Type Article; Site tikvib.com; Saved Yesterday.
9. Pinned bottom bar.

## 8.5 Movie (movie.html, 390×1440)

1. Hero 190 r32 bg `#1E2A4F` with `.glass-tint` "Trailer" button right 16 bottom 16
   (h46 padding 0 20 r23 `#fff` 16/700, play 16 filled, gap 8).
2. Top bar.
3. **Poster row** — margin-top 12, padding 0 20, flex gap 16 align-flex-end:
   poster 96×142 r22 bg `#34428a` shadow `0 18px 36px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.25)`;
   right: H1 27/31/800/-0.03em "The Long Way Home"; meta margin-top 6 15 `#636366` "2024 · 2h 08m · Drama";
   chips margin-top 12 gap 8 (h32 padding 0 12 r16 14/700): score "8.1"
   (bg `#FBEBC8` color `#6B4300`, star 14 filled) · "PG-13" (bg `#E5E5EA` color `#2A2640`).
4. **Tabs** — Overview active; Links 2; Notes 0.
5. **Your status** — uppercase label; 3 status buttons (flex gap 8, each flex:1 h52 r26):
   "Watchlist" selected (bg `#151517` `#fff` 15/650), "Watching", "Watched" (border `#D8D8DE` 15/500).
6. **Your rating** — label; card (padding `12px 20px`): 5 star buttons 44×44, star SVG 36 —
   1–3 filled `#F5A524` (stroke 1.5), 4–5 outline `#C7C7CC` (stroke 1.8); right score text
   22/800/-0.02em "3" + " / 5" (15/600 `#636366`).
7. **Where to watch** — label; card padding 12: segmented trio h46 r23 ("Stream" dark selected,
   "Rent"/"Buy" idle); inside info block margin-top 14 padding 14 r20 bg `#F2F2F7`:
   icon 44×44 r14 `#E4EDFC`/`#0A55C4`; text 15/21 `#48484A` "Streaming services for your region show up here once we find them."
8. **Synopsis** — label; card padding `14px 16px`: p 17/26 `#2C2C2E` "A short plot summary of the film appears here, written from the post you saved."
9. **Details** — kv: Year 2024; Runtime 2h 08m; Genre Drama; Rated PG-13; Score 8.1.
10. **Saved from** — label; link card (padding `14px 16px`): icon 48×48 r15 `#E4F5EA`/`#14703A`
    (chat icon); "The post you saved" 16/650; "Open the original" 14 `#636366`; chevron 20.
11. Pinned bottom bar.

## 8.6 Recipe (recipe.html, 390×1350)

1. Hero 190 r32 bg `#9a4a18` with 3 `.glass-tint` chips left 16 bottom 16 gap 8
   (h36 padding 0 14 r18 `#fff` 14/700): clock+ "35 min" · "Serves 4" · "Easy".
2. Top bar.
3. H1 30/34/800 "Creamy Garlic Pasta"; meta margin `4px 4px 0` 15 `#636366` "Saved from a reel".
4. **Start cooking row** — margin-top 12 flex gap 10: "Start cooking" (flex:1 h58 r29 bg `#0B5FD9`
   `#fff` 18/700, play 18 filled, shadow `inset 0 1.5px 0 rgba(255,255,255,.5),0 10px 24px rgba(11,95,217,.35)`)
   + servings stepper `.glass` (h58 r29 padding 0 6 flex gap 2): minus button 44×46 `#0A55C4`
   stroke 2.8; count 20/800 min-width 22 centered "4"; plus button.
5. **Tabs** — Overview active; Links 1; Notes 0.
6. **Ingredients** — header: uppercase label + "2 of 6" 14 `#636366`. Group card (padding `2px 18px`):
   rows flex gap 12 min-height 50 border-bottom `#ECECF0` — check circle 30 r15 `#0B5FD9` white
   check 16 stroke 3 (done: name 17 strikethrough `#6E6E73`, qty 16 `#6E6E73`) or empty circle
   border 2px `#C7C7CC` (todo: name 17/500, qty 16 `#636366`):
   Spaghetti 200 g (done), Garlic cloves 4 (done), Cream 1 cup, Parmesan 50 g, Butter 2 tbsp,
   Salt & pepper to taste.
7. **Shopping list CTA** — margin-top 12: full-width h52 r26 bg `#E4EDFC` `#0A55C4` 16/700,
   cart icon 18 stroke 2.2, copy "Add 4 missing to shopping list".
8. **Steps** — header: label + "4 steps". Group card: rows flex gap 12 padding `10px 0`
   border-bottom `#ECECF0` (last 16): number circle 40×40 r20 bg `#E4EDFC` `#0A55C4` 17/800;
   name 17/700; sub 15 `#636366` margin-top 2; right time chip (padding 5 12 radius 13 bg `#ECECF0`
   `#3A3A3C` 13/700) "10 min"/"2 min"/"5 min" (step 4 none):
   1 Boil the pasta / Cook until al dente; 2 Sauté the garlic / In butter, on medium heat;
   3 Add cream / Simmer until it thickens; 4 Toss and serve / Pasta, parmesan, salt & pepper.
9. **Source** — label "Source"; link card: icon 48×48 r15 `#FDEBDD`/`#A8480E` (video icon);
   "Original reel" 16/650; "Open the video" 14 `#636366`; chevron 20.
10. Pinned bottom bar.

## 8.7 Recipe — cooking mode (recipe-cooking-mode.html, 390×844)

Full-screen mode (no hero, no tabs):

1. **Top row** — padding `48px 16px 0`, flex space-between h44: Exit glass 44×44 r22 (X 18 stroke 2.6);
   center: recipe 15/700 "Creamy Garlic Pasta" + sub 13 `#636366` "Step 2 of 4";
   Ingredients glass 44×44 r22 (list icon 22 stroke 2).
2. **Step progress** — margin-top 14 flex gap 6: 4 bars flex:1 height 5 radius 3 —
   done `#0B5FD9` (2), remaining `#D1D1D6` (2).
3. **Step content** — padding 0 20:
   - Number tile margin-top 36: 44×44 r22 bg `#E4EDFC` `#0A55C4` 20/800 "2".
   - H1 margin-top 14: 38/42/800/-0.035em "Sauté the garlic".
   - Sub margin-top 10: 22/30 `#3A3A3C` "In butter, on medium heat."
   - **You need** — label margin `28px 0 8px` "You need"; flex gap 8: two ingredient chips
     (flex:1 h56 radius 14 bg `#fff` `box-shadow:0 0 0 1px #E3E3E8`, flex gap 10 padding 0 14):
     check circle 24 r12 `#0B5FD9` (check 13 stroke 3.2) "Garlic cloves" 15/600 + qty 15 `#636366` "4";
     empty circle border 2px `#C7C7CC` "Butter" "2 tbsp".
   - **Timer card** — margin-top 20 padding `18px 16px 16px` radius 22 bg `#fff`
     shadow `0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)` centered:
     label 13/700/+0.06em uppercase `#636366` "Timer"; digits 64/72/800/-0.03em tabular "02:00";
     buttons margin-top 10 flex gap 8: "Start" (flex:2 h52 r14 `#0B5FD9` `#fff` 17/700 + play 16) ·
     "Reset" (flex:1 h52 r14 bg `rgba(118,118,128,.16)` `#151517` 17/650).
   - **Keep screen on** — margin-top 12: row flex gap 12 h56 padding 0 14 radius 14 bg `#fff`
     `box-shadow:0 0 0 1px #E3E3E8`: phone icon 22 `#3A3A3C`; "Keep screen on" 16/600 flex:1;
     switch 52×32 r16 bg `#34C759` knob 26 r13 right 3 top 3 shadow `0 2px 5px rgba(0,0,0,.25)` (on).
4. **Bottom controls** — absolute bottom padding `0 16px 28px` flex gap 10:
   "Previous step" glass 58×58 r29 (chevron-left 24 stroke 2.4) ·
   "Next: Add cream" (flex:1 h58 r29 bg `#0B5FD9` `#fff` 17/700, shadow
   `inset 0 1.5px 0 rgba(255,255,255,.45),0 10px 24px rgba(11,95,217,.35)`, chevron-right 20 stroke 2.4).

## 8.8 Game (game.html, 390×1365)

1. Hero 190 r32 bg `#0c3a46` with `.glass-tint` platform chips left 16 bottom 16 gap 8
   (h38 padding 0 16 r19 `#fff` 15/700): "PC" · "PS5" · "Xbox".
2. Top bar.
3. H1 30/34/800 "Monster Hunter Wild Ascendance"; meta 15 `#636366` "Capcom · Action RPG".
4. **Source card** — margin-top 12 (padding `12px 14px` r22): avatar 48×48 r24 `#151517` "S" 18/700;
   "Shubhuuu · YouTube" 16/700; sub 14 `#636366` `.clip` "Capcom invited me to Gamescom in Thailand";
   right "Open" pill (h42 padding 0 16 r21 `#E4EDFC`/`#0A55C4` 15/700 + arrow 13 stroke 2.6).
5. **Tabs** — Overview active; Links 3; Notes 1.
6. **Your status** — 3 buttons h52 r26: "Wishlist" selected dark (16/650), "Playing", "Played".
7. **At a glance** — label; 2×2 grid gap 8; stat card (padding `16px 18px` r24):
   eyebrow 12/700/+0.07em uppercase `#636366` + value margin-top 4 20/800/-0.02em:
   Status "Upcoming"; Release "TBA"; Platforms "PC · PS5 · Xbox"; Genre "Action RPG".
8. **Release alert** — margin-top 12: banner flex gap 12 padding `14px 16px` radius 24 bg `#E4EDFC`:
   bell tile 44×44 r14 bg `#fff` `#0A55C4` (bell 22 stroke 2); title 16/700 `#0A3D8F` "Tell me at release";
   sub 14 `#1F4E9C` margin-top 1 "No date yet"; switch 54×32 r16 bg `#0B5FD9`
   shadow `inset 0 1px 2px rgba(0,0,0,.2)` knob 26 right 3 top 3 (on).
9. **From the video** — label; card padding `14px 16px`: p 17/26 `#2C2C2E` "Early access to upcoming titles shown at Gamescom in Thailand, alongside Mega Man Dual Overdrive."
10. **Your notes** — header: label + count "1"; row card (padding `14px 16px`): pencil tile
    48×48 r15 `#E4EDFC`/`#0A55C4`; "Open your note" 16/650; chevron 18.
11. **Also from Capcom** — label; row card padding 12: thumb 72×72 r18 `#103a8a`;
    "Mega Man Dual Overdrive" 17/650; sub 14 `#636366` margin-top 2 "Mentioned in the same video";
    "Save" pill (h44 padding 0 16 r22 `#E4EDFC`/`#0A55C4` 15/700).
12. Pinned bottom bar.

## 8.9 Book (book.html, 390×1555)

1. **Cover panel** — margin `98px 16px 0`, height 210, radius 32, bg `#E7DFD0`, centered book:
   104×156, radius `6px 12px 12px 6px`, bg `#2F4B5C`, padding 14 12, color `#fff`,
   shadow `0 14px 28px rgba(0,0,0,.25)`; spine strip left 7 wide bg `rgba(0,0,0,.18)` radius
   `6px 0 0 6px`; title 15/18/800/-0.01em margin-left 4 "The Quiet Shore";
   author absolute left 16 bottom 14 10/+0.08em uppercase opacity .85 "A. Marlow".
2. Top bar (44px glass buttons).
3. H1 26/31/800 "The Quiet Shore"; meta 15 `#636366` "A. Marlow · 2019 · 312 pages";
   chips margin `10px 4px 0` gap 8 (h32 padding 0 12 r16 bg `#E5E5EA` `#3A3A3C` 14/650):
   "Fiction" · "Paperback".
4. **Tabs** (tight segmented radius 14/11): Overview active; Links 1; Notes 2.
5. **Your status** — `.lbl` margin-top 18; `.st` trio h48 r24: "Want to read", "Reading" `.on`
   (dark), "Read".
6. **Progress** — `.lbl`; card padding `14px 16px`: line flex space-between baseline:
   "Page 128" 22/800/-0.02em + " of 312" (15/600 `#636366`) · "41%" 15/700 `#0A55C4`;
   bar margin-top 10 height 8 radius 4 track `#E5E5EA` fill 41% `#0B5FD9`;
   buttons margin-top 12 flex gap 8: "Update page" (flex:1 h48 r14 `#0B5FD9` `#fff` 16/700) ·
   "Log a session" (flex:1 h48 r14 bg `rgba(118,118,128,.16)` `#151517` 16/650).
7. **Synopsis** — `.lbl`; card: p 16/24 `#2C2C2E` "[A short description of the book appears here, pulled from the page you saved.]"
8. **Highlights** — header (`.lbl` + count "2" 14 `#636366`); stack gap 8:
   quote card (flex gap 12 padding `12px 14px` r22): quote mark tile 32×32 r10 bg `#E4EDFC`
   `#0A55C4` 22/800 "“"; text 16/23 `#2C2C2E`; page 13 `#636366` margin-top 4 ("Page 41","Page 97").
   "Add a highlight" dashed button (h48 r14 border 1.5px dashed `#AEAEB8` transparent `#0A55C4` 16/700).
9. **Where to get it** — `.lbl`; `.grp` padding `12px 14px`: `.st` trio h46 ("Buy" `.on`,
   "Borrow", "Audiobook"); hint margin-top 10 14/20 `#636366` "Stores and libraries near you show up here once found."
10. **Details** — `.lbl`; `.grp` kv rows: Author A. Marlow; Published 2019; Pages 312;
    Publisher [Publisher]; ISBN [ISBN].
11. Pinned bottom bar.

## 8.10 Place (place.html, 390×1175)

1. **Map hero** — margin `98px 16px 0`, height 250, radius 32, bg `#E8E7E1`, SVG map 358×250
   (water `#B7D4F0` bottom curve; park rects `#CDE4C5` r12–14; white roads stroke 8–16;
   selected-ping circle r34 `rgba(11,95,217,.14)`).
   - Pin: 44×44, radius `22px 22px 22px 4px`, rotate(-45deg), bg `#0B5FD9`, shadow
     `0 6px 14px rgba(11,95,217,.45)`, at left 150 top 112 (margin -44 0 0 -22), shop icon 22
     white counter-rotated.
   - "Open in Maps" glass pill right 12 bottom 12 (h40 padding 0 14 r20 14/700).
2. Top bar (44px glass buttons).
3. H1 26/31/800 "Old Town Market"; meta 15 `#636366` "Market · Saved from Weekend trip ideas".
4. **Action row** — margin-top 14 flex gap 8: "Directions" (flex:1 h52 r14 `#0B5FD9` `#fff` 17/700,
   send icon 18 stroke 2.4) · "Add to trip" (flex:1 h52 r14 bg `rgba(118,118,128,.16)` `#151517`
   17/650, folder icon 18).
5. **Your status** — `.lbl` margin-top 18; `.st` trio: "Want to go" `.on`, "Planned", "Been there".
6. **Info** — `.lbl`; `.grp` rows with `.ic` tiles 36×36 r11 `#E4EDFC`/`#0A55C4` (pin, clock, globe)
   + value 16/600: "[Street address]", "[Opening hours]", "[Website]".
7. **Part of a plan** — `.lbl`; link card (padding `12px 14px` r22): note tile 44×44 r14 `.ic`;
   "Weekend trip ideas" 16/650; sub 13 `#636366` "Keep Saturday open for the market"; chevron 18.
8. **Your notes** — `.lbl`; note box (padding `14px 16px`, min-height 90, r22): 16px `#8E8E93`
   placeholder "Add what you want to try here, like stalls, food or opening times…"
9. **Details** — `.lbl`; `.grp` kv rows: Type Market; Coordinates [lat, long].
10. Pinned bottom bar.

## 8.11 Places map (places-map.html, 390×844)

Full-screen map (canvas bg `#E8E7E1`; water `#B7D4F0`; parks `#CDE4C5`; white roads stroke 7–18;
ping circle r46 `rgba(11,95,217,.12)`). Glass on this screen uses the `.55` variant.

1. **Pins** (`.pin`): absolute 36×36 radius `18px 18px 18px 4px`, rotate(-45deg), bg `#fff`,
   shadow `0 4px 10px rgba(0,0,0,.25)`, icon 18 `#0A55C4` counter-rotated; at (62,268) food,
   (288,372) article, (90,530) place.
   - Selected pin: 48×48 radius `24px 24px 24px 5px` bg `#0B5FD9` `#fff` icon 24 stroke 2.2,
     shadow `0 8px 18px rgba(11,95,217,.5)` at (152,318) — shop icon.
2. **Top controls** — absolute top padding `48px 16px 0` z 5:
   - Row flex gap 10: Back glass 48×48 r24 · search field `.glass` (flex:1 h48 r24 padding 0 16,
     icon 20 `#636366`, text 16 `#636366` "Search saved places") · Locate-me glass 48×48 r24
     `#0A55C4` (send icon 22).
   - Filter chips margin-top 10, horizontal scroll, gap 8, glass pills h40 padding 0 16 r20 14/650:
     "All places" (bg `rgba(21,21,23,.86)` `#fff`), "Food", "Markets", "Want to go" (transparent, `#151517`).
3. **Selected place card** — `.glass` absolute left 16 right 16 bottom 110, radius 26, padding 12,
   flex gap 12 align-center, z 5:
   thumb 64×64 r16 bg `#CDE4C5` color `#2F6B34` (shop icon 28 stroke 2); "Old Town Market" 17/700/-0.01em;
   sub 13 `#48484A` margin-top 2 "Market · Want to go"; "Directions" button
   (h44 padding 0 16 r22 bg `#0B5FD9` `#fff` 15/700).
4. **Bottom bar** — shared nav + FAB.

## 8.12 Podcast (podcast.html, 390×1310)

1. Hero 190 r32 bg `#7A3550` centered: artwork 132×132 r24 bg `#F2F2F7` color `#7A3550`
   (mic icon 64 stroke 1.6); `.glass-dark` label left 16 bottom 16 (padding 4 10 radius 10,
   11/700/+0.08em uppercase) "PODCAST".
2. Top bar (44px glass buttons).
3. H1 26/31/800 "Late Night Builds"; meta 15 `#636366` "Episode 42 · 48 min · Technology".
4. **Player card** — margin-top 12 padding `14px 16px` r22:
   - Scrubber: height 8 r4 track `#E5E5EA`, fill 22% `#0B5FD9`, knob 18×18 r9 `#fff`
     shadow `0 1px 4px rgba(0,0,0,.35)` at left 22% top -5.
   - Times flex space-between margin-top 8 13 `#636366` tabular: "10:34" / "-37:26".
   - Transport flex center gap 22 margin-top 6: "−15" button 48×48 r24 transparent 13/700 ·
     Play 64×64 r32 bg `#0B5FD9` white play 26 filled · "+30" 48×48.
   - Row margin-top 8 flex gap 8: "1.0×" (flex:1 h44 r12 bg `rgba(118,118,128,.16)` 15/650) ·
     "Add to queue" (flex:2 same).
5. **Your status** — `.lbl` margin-top 18; `.st` trio: "Queue", "Listening" `.on`, "Done".
6. **Summary** — `.lbl`; card: p 16/24 `#2C2C2E` "[A short episode summary appears here once the audio has been processed.]"
7. **Chapters** — header (`.lbl` + count "3"); `.grp`: rows (`.ch`) flex gap 12 min-height 46-ish
   padding, border-bottom `#ECECF0` (last 0): time (`.t`) width 52 14/700 `#0A55C4` tabular
   ("0:00","06:10","41:20"); name flex:1 16/600 ("[Intro]","[Main topic]","[Wrap-up]");
   "Playing" badge on row 2 (12/700 `#0A55C4` bg `#E4EDFC` padding 3 9 r9).
8. **Timestamped notes** — header (`.lbl` + "1"); note card (flex gap 12 padding `12px 14px` r22):
   time chip (h28 padding 0 10 r14 bg `#E4EDFC` `#0A55C4` 13/700) "08:42"; text 16/23 `#2C2C2E`
   "[Your note at this moment]".
   "Add note at 10:34" dashed button margin-top 8 (h48 r14 border 1.5px dashed `#AEAEB8`
   transparent `#0A55C4` 16/700).
9. **Details** — `.lbl`; `.grp` kv: Show Late Night Builds; Episode 42; Length 48 min.
10. Pinned bottom bar.

## 8.13 Product (product.html, 390×1170)

1. Hero 210 r32 bg `#E5E5EA` centered keyboard SVG 240×110 (`#3A3A3C` body r14, `#F2F2F7` keys r4);
   `.glass-dark` label left 16 bottom 16 "PRODUCT" (padding 4 10 r10 11/700/+0.08em).
2. Top bar (44px glass buttons).
3. H1 26/31/800 "Wireless mechanical keyboard"; price row margin `4px 4px 0` flex baseline gap 10:
   "[Price]" 24/800/-0.02em · "Seen in Setup Tour 2026" 15 `#636366`.
4. **Tabs** (tight radius 14/11): Overview active; Links 2; Notes 0.
5. **Your status** — `.lbl` margin-top 18; `.st` trio: "Wishlist" `.on`, "Ordered", "Owned".
6. **Price alert** — `.lbl`; row card (flex gap 12 padding `12px 14px` r22): bell tile 44×44 r14
   `#E4EDFC`/`#0A55C4`; "Tell me when it drops" 16/650 + sub 13 `#636366` "Below [target price]";
   switch 52×32 r16 bg `#34C759` knob 26 right 3 top 3 (on).
7. **Where to buy** — header (`.lbl` + "2 stores" 14 `#636366`); `.grp`: `.shop` rows (flex gap 12,
   min-height 60, border-bottom `#ECECF0`): store tile 40×40 r12 bg `#F2F2F7` letter 800 `#3A3A3C`;
   name 16/650 ("[Store one]") + availability 13 `#636366` ("In stock"/"Ships in 3 days");
   price 16/700 "[Price]"; arrow-up-right 16 `#636366` stroke 2.4.
8. **Saved from** — `.lbl`; link card (padding 10 r22): thumb 64×64 r14 `#2B3040`;
   "Setup Tour 2026" 16/650; "Video · youtu.be" 13 `#636366`; chevron 18.
9. **Details** — `.lbl`; `.grp` kv: Brand [Brand]; Category Keyboard; Connection Wireless.
10. Pinned bottom bar.

## 8.14 Note / Checklist (note-checklist.html, 390×1060)

1. **Top bar** — absolute `48px 16px 0` z 5 flex align-center space-between: Back 46 glass ·
   "Edited just now" 14 `#636366` (no glass) · Share + More glass 46, gap 10.
2. **Title area** — padding `126px 16px 0`: H1 34/38/800/-0.035em "Weekend trip ideas" (margin 0 4px);
   tag chips margin `12px 4px 0` wrap gap 8 (h36 padding 0 14 r18 bg `#E4EDFC` `#0A55C4` 15/700):
   "#travel", "#ideas".
3. **Body card** — margin-top 12 padding `14px 16px` min-height 110 r22: p 18/28 `#2C2C2E`
   "Check train times and book a stay near the old town. Keep Saturday open for the market and a long lunch."
4. **Checklist** — header: uppercase label "Checklist" + "1 of 4" 14/600 `#636366`;
   progress margin `0 4px 12px` height 6 radius 3 track `rgba(118,118,128,.16)` fill 25% `#0B5FD9`.
   Group card (padding `2px 18px`): rows flex gap 12 min-height 50 border-bottom `#ECECF0` —
   check circle 32 r16 `#0B5FD9` (check 17 stroke 3) / empty border 2px `#C7C7CC`;
   text 18 (done strikethrough `#6E6E73`, todo 500):
   Pick the dates (done), Book the train, Reserve a stay, Plan Saturday.
   "Add item" row: full-width min-height 50 transparent `#0A55C4` 17/700, plus 18 stroke 2.6, gap 10.
5. **Reminder** — H2 uppercase label; row card (padding `14px 16px` r22): bell tile 48×48 r15
   `#E4EDFC`/`#0A55C4`; "Remind me to book" 16/650 + sub 14 `#636366` margin-top 2 "Not set";
   "Set" pill (h44 padding 0 16 r22 `#E4EDFC`/`#0A55C4` 15/700).
6. **Linked saves** — header: label + "2" 14/600; group card (padding `2px 16px`): rows flex gap 12
   padding `10px 0` / `14px 0` border-bottom on first: thumb 52×52 r16 (`#4C5A8A` article,
   `#2B3040` video); "[Linked save title]" 16/650; kind 14 `#636366` margin-top 2 ("Article","Video");
   chevron 18. Then "Link a save" dashed CTA margin-top 12 (h52 r26 border 1.5px dashed `#AEAEB8`
   bg `rgba(255,255,255,.55)` `#0A55C4` 16/700 + plus 18 stroke 2.6).
7. Pinned bottom bar.

---

# 9. SETTINGS (settings.html, 390×1075)

1. **Top bar** — absolute `48px 16px 0` z 5: Back glass 44×44 r22 only.
2. **Header** — padding `98px 16px 0`: H1 34/800/-0.035em "Settings" (margin 0 4px).
3. **Profile card** — `.grp` margin-top 14: row flex gap 14 padding `14px 0`: avatar 56×56 r28
   bg `#2B3040` `#fff` 22/700 "A"; "[Your name]" 18/700; "[Your email]" 14 `#636366`.
4. **Library** — `.lbl`; `.grp` rows (min-height 54, icon 32×32 r9 `#E4EDFC`/`#0A55C4`, label 16/500 flex:1,
   right value 15 `#636366`, chevron-right 16 stroke 2.4):
   - Default view → "List"
   - Default collection → "None"
   - Manage tags → "8"
   - Auto-save from share sheet → switch 51×31 r16 `#0B5FD9`, knob 27 r14 left 22 top 2, shadow `0 2px 4px rgba(0,0,0,.25)` (on)
5. **Appearance** — `.lbl`; `.grp`:
   - Theme → "System"
   - Text size → "Default"
6. **Notifications** — `.lbl`; `.grp`:
   - Reminders → switch on (`#0B5FD9`)
   - Price alerts → switch off (track `#D1D1D6`, knob left 2)
7. **Data** — `.lbl`; `.grp`:
   - Export library (no value)
   - Storage → "[Size]"
8. **Sign out** — margin-top 18: full-width h52 r14 bg `#FDECEA` color `#B3261E` 17/650.
9. Bottom spacer 36px. No bottom nav (secondary screen).

---

# 10. IMPLEMENTATION NOTES

- Two glass opacities: `.42` on flat list screens, `.55` when imagery sits behind (grid,
  multi-select, places map). Preserve per-screen value.
- Segmented widths vary: radius 20/16 (library, collections, video/recipe/game/movie tabs)
  vs radius 14/11 (empty states, book/product/podcast-ish tight tabs, sheet time/sort).
- Badge geometry varies with thumb size: 84px thumbs → left/top/bottom 6–8, padding 3 8/4 9,
  radius 8–10; 64px thumbs → left 6 top 6, padding 3 8, radius 8.
- All screens are 390 wide; heights differ per screen (844 standard, 868/880/931/950/1010/1060/
  1080/1170/1175/1310/1350/1365/1440/1555/1620 for long content).
- Sheet grabber margin-bottom differs: 10px (create, add-to-collection), 6px (share, filter, item menu).
- Copy in square brackets ("[n] saves", "[Your name]", "[Price]", "[Store one]", "[lat, long]",
  "[Takeaway one]", "[A short description…]") marks live-data placeholders — wire to backend, keep
  surrounding layout identical.
- "Discuss with Agent" dark bar and 58px glass favorite circle appear on every detail screen.
- Bottom nav + FAB appear on: library list, grid view, empty states, collections, saving-and-failed,
  places map. Detail screens, sheets, cooking mode, settings, tag manager use their own bottom bars.
