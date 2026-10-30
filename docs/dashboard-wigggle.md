# Wigggle widget replacement

Open Home → Add widget → Wigggle designs. The catalogue contains all 92 source designs from [Wigggle UI](https://wigggle-ui.vercel.app/), grouped into clock, calendar, weather, media, productivity, dashboard, stocks and sports. Every supported upstream size is included.

The designs replace the previous Kokonut addition. Home uses the adapted Wigggle Widget primitive and shared shell. Menus use the app's accessible, portalled menu; size choices are visible radio buttons, and selecting Medium no longer forces a Glance card back to Small. Collapsing frees the card's grid tracks and expanding restores the content without discarding its state.

Choose **Apply to** for a widget already on Home, or **Add** for a compatible source. This changes that widget's saved `design` and size, rather than creating an additional copy. The existing SQLite layout stores the optional design ID. Existing layouts without a design continue to work. Unknown design IDs are rejected by the API.

Catalogue previews are explicitly labelled **Sample data**, inert, and separate from the live widget registry. The original upstream examples include demonstration prices, scores, songs, alarms and tasks. They never replace real widget payloads. Browsing weather samples uses local fixtures and never requests location or contacts a weather service. Local reference artwork is namespaced under `public/wigggle/assets`.

Home continues to use its existing providers and permission-gated actions. Clock variants use live browser time and saved zones. Weather variants use cached provider readings; unsupported measurements show a dash, and the daily forecast design states that daily data is unavailable. Calendar month compositions mark only events in the cached provider results, not availability beyond those results. Other compatible designs adapt the corresponding existing source and controls. Stock/sports designs, airfare pricing, stopwatch/alarm-picker designs, and media/device controls without a provider remain design samples; their examples cannot be added as fake live data.

Upstream source and MIT attribution: `frontend/src/components/wigggle/UPSTREAM.md` and `vendor/LICENSE.md`. Source commit: `6a38dcc78385fce1a23207d1e0d0f12cf9059094`.

Validation: all 92 source previews; all 80 existing widget compositions at 1440px and 390px; live clock/weather/calendar variants; nine-theme clock sizes; compact collapse and restored expansion; menu portal, Escape/outside dismissal and focus; saved design validation/persistence. No screenshots were taken.
