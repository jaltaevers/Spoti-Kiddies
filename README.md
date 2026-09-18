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

Confirmed via the GitHub API: this repo (`jaltaevers/Spoti-Kiddies`) does
not have Pages enabled yet, so the exact live URL the spike will be served
at, once enabled, is:

```
https://jaltaevers.github.io/Spoti-Kiddies/spike/
```

Steps only you can do (they need your GitHub/Spotify account access, which
Claude has no credentials for):

1. **Enable GitHub Pages:** repo → Settings → Pages → under "Build and
   deployment", set Source to "Deploy from a branch", branch `main`,
   folder `/ (root)` → Save. There is no API/tool access to this setting
   from here, so this one has to be a manual click. (Development still
   happens on a feature branch per how this Claude Code session is
   configured, but it gets fast-forwarded onto `main` after every push, so
   `main` always reflects the latest work and Pages always serves current
   code from one place.)
2. **Create an app** at the
   [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   New apps are in Development Mode, which as of the Feb/Mar 2026 changes
   requires the app owner's account to have active Premium, and caps the
   app at a small number of allowed users — both are non-issues for a
   private single-family app.
3. In that app's settings, add this exact **Redirect URI** (trailing slash
   included):
   `https://jaltaevers.github.io/Spoti-Kiddies/spike/`
4. If the Spotify account you'll test with isn't the app-owner account,
   add it under the app's user access list (Development Mode gates
   non-owner users).
5. Copy the app's **Client ID** and send it here in chat — there's no
   client secret anywhere in this project, so the Client ID isn't
   sensitive to paste.

What Claude does once you paste the Client ID: edit `spike/config.js`,
commit, and push — no code editing needed on your end.

Then: on the tablet, open the URL above (trailing slash, exactly as
written) and follow `SPIKE.md`.

Local dev over `http://127.0.0.1:<port>/` also works (register that as a
second Redirect URI) but isn't needed just to run the tablet test above —
it's for later, when iterating on the code from a computer instead of the
GitHub Pages URL.
