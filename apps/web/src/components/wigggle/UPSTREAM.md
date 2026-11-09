# Wigggle UI

MIT licensed source from https://github.com/wigggle-ui/ui at `6a38dcc78385fce1a23207d1e0d0f12cf9059094`. All 92 upstream designs are included.

`vendor/registry/default/widgets` contains the upstream examples. The catalogue renders them as explicit design samples; Home reuses weather components only through the real-data `WeatherContext` adapter. Other live compositions preserve the existing provider/action components. Imports are namespaced, palette utilities use app tokens, and raw controls use app primitives; Next.js image/link components are adapted for Vite. Location/weather hooks are replaced with explicit sample fixtures so browsing designs never requests location or contacts a weather service. Samples are labelled, inert and separate from the live widget registry.

The shared Widget primitive is used by live Home cards. Existing data providers, errors, freshness and permission-gated actions remain authoritative.
