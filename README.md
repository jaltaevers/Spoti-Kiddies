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

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   New apps are in Development Mode, which as of the Feb/Mar 2026 changes
   requires the app owner's account to have active Premium, and caps the
   app at a small number of allowed users — both are non-issues for a
   private single-family app like this one.
2. Copy the app's **Client ID** (there is no client secret anywhere in this
   project — it only ever uses Authorization Code with PKCE, entirely
   client-side).
3. In the app's settings, add this **Redirect URI** (must match exactly,
   trailing slash included):
   `https://<your-username>.github.io/<repo-name>/spike/`
4. If your Spotify account isn't already the app owner's account, add it
   under the app's user access list (Development Mode gates non-owner
   users).
5. Edit `spike/config.js` and set `clientId` to the value from step 2.
6. Enable GitHub Pages for this repo (Settings → Pages → build from the
   default branch, root folder). This isn't something Claude can toggle
   from here — it's a one-time manual step in the repo settings.
7. On the tablet, open `.../spike/` (with the trailing slash) and follow
   `SPIKE.md`.

Local dev over `http://127.0.0.1:<port>/` also works (register that as a
second Redirect URI) but isn't needed just to run the tablet test above —
it's for later, when iterating on the code from a computer instead of the
GitHub Pages URL.
