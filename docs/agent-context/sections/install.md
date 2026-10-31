# Install

The app-download page at `/install`. It links to packaged desktop releases and
explains the phone companion.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

## Entry points

| Layer | Path |
|---|---|
| View | `frontend/src/views/Install.jsx` |
| Styles | `frontend/src/styles/install.css` |
| Route | `/install` |
| Release API | GitHub Releases (`api.github.com`) |
| Packaging | `electron-builder.yml`, `.github/workflows/desktop-release.yml` |
| Android updates | `backend/remote/updates.py`, `frontend/src/mobile/updates.js` |

## Behaviour

On mount the page fetches the latest GitHub release:

```text
https://api.github.com/repos/wayn-wayn/amethyst/releases/latest
```

It picks assets by name for macOS, Windows and Linux, falling back to the
release page. If the fetch fails, the hardcoded fallback URLs are used.

Sections:

- Desktop downloads for macOS, Windows and Linux.
- A phone card linking to the companion/pairing flow.
- Current release tag.
- Cross-platform desktop edition label.

The page performs no install itself. It is a download router.

## Packaging

- Electron main process: `electron/main.cjs`.
- Builder config: `electron-builder.yml`.
- Release workflow: `.github/workflows/desktop-release.yml`, triggered by tags.
- Python desktop shell: `backend/desktop.py`, entry points `amethyst-palette`
  and `amethyst-show`.
- Android: `frontend/android`, updates served by `/api/mobile/update`.
- iOS: `frontend/ios`.

Two desktop shells exist. The Electron app and the Python tray/webview app are
both in the tree. Their release relationship is not documented; do not assume
one supersedes the other.

## Modification guide

| Change | Touch |
|---|---|
| Change download layout | `Install.jsx`, `install.css` |
| Change release source | the fetch URL and fallback map |
| Change packaging | `electron-builder.yml`, workflow |
| Change Android update flow | `backend/remote/updates.py`, `mobile/updates.js` |
| Change the Python desktop entry | `backend/desktop.py`, `pyproject.toml` scripts |

Rules:

- Do not hardcode an asset name that the release workflow does not produce.
- Keep a fallback URL; the GitHub API can rate-limit an unauthenticated page.
- Do not claim a build exists for a platform the workflow does not build.
- Keep the repository slug consistent with the actual release repository.

## Known issues

- The page fetches `wayn-wayn/amethyst`, while other repository links use
  `Wayn-Git/Amethyst`. Confirm the canonical release repository before changing
  this page.
- The iOS card links to the App Store generally, not a specific listing.
- Release asset selection is name-based and brittle if asset naming changes.
- The page is informational; it cannot detect the user's architecture beyond
  the platform.

## Related

- [systems/desktop.md](../systems/desktop.md)
- [sections/remote-mobile.md](remote-mobile.md)
- [DEVELOPMENT-GUIDE.md](../DEVELOPMENT-GUIDE.md)
- [FRONTEND.md](../FRONTEND.md)

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
