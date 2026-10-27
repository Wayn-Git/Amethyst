# Home reference atlas

2026-10-27. R1–R4 are the four attached images in attachment order. Measurements below are normalized to a 200 px square tile; source images are compressed collages, so these are implementation ratios, not claims about original design files. The reference request supersedes the older 12 px/no-screenshot brief. No additional SKILL.md was attached. The installed frontend-design skill is applied; reference-led numerals and rounded tiles override its generic-style cautions.

## Common geometry

Square tile: 200 × 200, radius 28–36 (14–18% width), padding 20 (10%). Our responsive product translation uses the existing 24 px radius, 16/24 px padding and 16 px gutters. Wide tiles are 2:1; islands 3–6:1 with fully rounded ends. Titles 14–16/20–22, body 13–14/20, supporting labels 11/16, hero numbers 48–64/1 with −.04em tracking. Use the existing --ui-display and --ui-font tokens (currently OpenAI Sans), with the existing mono token for timestamps; do not hardcode a second font family. Source images have compact chrome; actions stay in keyboard-accessible hover menus. All patterns retain visible focus and reduced motion. Still images establish no animation timing: use existing 150 ms response tokens, no inferred automatic animation.

| Stable pattern | Reference / tone | Layout and exact elements | Interaction / motion |
|---|---|---|---|
| island-status | R1 black capsule | 36–56 high, radius half height, 12–16 inset; 20 circular status icon at left, single 13 px label, trailing 11 px status; gap 8 | Toggle or status only; no invented pulsing |
| island-timer | R1 black wide pill | 56 high; 32 circular stop/pause buttons left; 12 px label and 32 px tabular countdown right | Existing stop/start actions, 1 s real countdown |
| island-transfer | R1 black wide pill | 40 icon at left, label center; 32 ring or 4 px line at right; padding 12 | Progress from source values only |
| music-transport | R1/R4 dark square/wide | 48–72 artwork replaced by icon badge; title 16 and artist 12; thin progress track, timestamps at opposite ends; centered 44 circular transport controls | Play/pause/skip only when advertised |
| tracking-timeline | R2 dark/lime/orange | 12 px date; 16 title; 3–4 px progress with 11 px stages below; vertical route dots spaced 24; location title 20 | Link to real record, no inferred progress |
| route-split | R2 dark wide | Two destination labels aligned left/right, 24 px endpoints, center transport badge; 12 px dates below; optional real map absent here | Route settings disclosed; no fake map |
| delivery-hero | R2 dark square | 48–64 badge upper left; 16 title and 12 detail; bottom progress bar and status; 20 padding | Existing delivery/status action |
| reading-progress | R2 dark square | Initials or book badge top left; 48 page/count hero right; 11 px progress caption and 4 px bar bottom | Open saved item |
| contact-stack | R2/R4 dark/light | 40 initials circles, 12 count pills; 16 name; 12 detail; one trailing action, minimum row 44 | Open/contact actions only when supported |
| calendar-page | R3 white square | Oversized 56 date, small weekday 12 at top; split inset page suggested by a subtle rule | Calendar date is real; no fake appointments |
| analog-clock | R3 white/dark | Dial occupies 80% width; 60 ticks, hour numerals 13–17, two hands; digital 24 below for access | Minute updates only; no decorative seconds |
| weather-prose | R4 dark square | 24–32 left-aligned multiline weather sentence; temperature in same hierarchy; muted location text | Location settings via disclosure |
| numeral-stat | R3 light/dark/accent | 40 badge top; 48–64 value bottom; 11 caption; spacious single metric | No chart without numeric payload |
| ring-gauge | R3 light/dark | Center 120–140 circle or half-ring, 7 px stroke; value 32–48, short 12 label | Clamped real fraction, accessible reading preserved |
| segmented-progress | R3 dark/lime | 10–20 vertical rounded bars 4–8 wide × 32 high, 4 gap; time/caption below | Only measured progress, no waveform simulation |
| trend-line | R3/R4 dark | Line chart in middle third, 2 px stroke; headline number 32 below, muted 11 axis/caption | Numeric series only; omit missing measurements |
| switch-row | R3 dark wide | 40 moon badge, stacked 14 title/11 caption; 40 × 24 switch on right | Keyboard toggle, 150 ms, reduced-motion 0 |
| editorial-card | R3/R4 light/accent | 16 heading, short 14 prose, 40 icon or initials; no borrowed illustration | Real saved excerpt or agent summary |
| appointment-card | R4 accent | 40 initials, 18 title, 12 participant; large real event title and date pill below | Open event; countdown if start exists |
| balance-card | R4 lime/accent | 12 label; 40–56 numeric value; secondary amount 14; pill actions at bottom | Only actual totals/currency, no pretend balance |
| action-pills | R4 accent | Two 44 high rounded actions anchored after content, 8 gap | Existing approve/reject or contextual actions |
| device-meter | R4 dark | 40 badge top left; 16 device label right; low 8 high track with contained glow; 12 status below | Real device battery/progress only |
| dot-matrix | R4 black | 12 heading, two stacked 36–48 text lines drawn with tiny square marks | Not applied: no matching flight payload; preserve readable normal text |
| image-feature | R4 mixed | Image fills 65–100%; overlaid 12 pill; radius inherited | Replace image with real-data layout or IconBadge; no copied art |

## Field patterns derived from the same language

These are required controls, not new widget features. `filled-form`: 16 px inset, 16 px corners, 8 px label-to-field, 12 px field gaps, 44 px filled controls, 12 px radius, 11 px inline labels. `search-pill`: 44 px tall, full radius, 20 px search icon and 14 px text. `compose-card`: labelled recipient/subject/body stack, 120 px minimum body, pill tone selection, distinct primary review/approve and secondary edit/reject. `inline-add`: flexible 44 px field plus 44 px action, wrap below 240 px. `settings-tile`: same fields inside native disclosure; no permanent giant form when content exists. `toggle-rows`: reference switch-row with visible label. `segmented-control`: existing roving-focus radio group with 4 px padding and full radius. `select-chip`: native select in filled rounded surface, OS options retained. `stepper`/`slider`/`time-picker`: existing Input with number/range/time, native keyboard and validation; no unsupported new behavior. `review-card`: 16 inset, strong title and prewrapped real draft, primary approve and secondary reject, busy disables both. `undo`: existing status toast and explicit Undo button; never bypass draft approval.

Loading uses static geometric skeletons in the same minimum footprint; empty is a short real instruction and existing action; error has Retry; stale keeps content and a label; unavailable sources have Connect. No fictional readings in any shipped state.
