# Kids Music Tiles

A big-button Spotify player for young kids: tap a picture tile, hear a song.
A static site (GitHub Pages, no build step, no backend) that plays music
through one parent Spotify Premium account via the Web Playback SDK. A
gated parent mode controls which songs appear. No search, no browsing, no
videos, no way for a kid to wander off.

## Status: Phase 0 — feasibility spike

Before building the real tile-grid app, [`/spike/`](spike/) checks whether
the Spotify Web Playback SDK plays reliably on the target tablet: in a
normal browser tab, as a home-screen installed web app, and after
locking/unlocking the screen. **[Read `SPIKE.md`](SPIKE.md) for the exact
test checklist and what "pass" looks like.**

Nothing under `/spike/` is the kid-facing app — that's Phase 1, and it's
gated on this spike passing on the real tablet.

## One-time setup (to run the spike)

**Setup is done.** GitHub Pages is live (deployed via
`.github/workflows/deploy-pages.yml` on every push to `main` — confirmed
by a successful workflow run and the repo's `has_pages` flag), and the
Spotify app's Client ID is wired into `spike/config.js`. The spike is
served at:

```
https://jaltaevers.github.io/Spoti-Kiddies/spike/
```

The one thing left, and the one thing Claude has no way to do itself: open
that URL **on the tablet** (trailing slash, exactly as written) and follow
`SPIKE.md`. If login fails with an `account_error`, double check the
Spotify account you're testing with is either the app-owner account or
has been added to the app's user access list in the dashboard
(Development Mode gates non-owner accounts), and that it has active
Premium.

Local dev over `http://127.0.0.1:<port>/` also works (register that as a
second Redirect URI) but isn't needed just to run the tablet test above —
it's for later, when iterating on the code from a computer instead of the
GitHub Pages URL.
