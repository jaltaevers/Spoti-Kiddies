# Kids Music Tiles

A big-button Spotify player for young kids: tap a picture tile, hear a song.
A static site (GitHub Pages, no build step, no backend) that plays music
through one parent Spotify Premium account via the Web Playback SDK. A
gated parent mode controls which songs appear. No search, no browsing, no
videos, no way for a kid to wander off.

## Status: Phase 1 — the real app is live

Phase 0 confirmed the Spotify Web Playback SDK plays reliably (including
recovering automatically from a brief "Device not found" race right after
connecting, which showed up during testing). The full app now lives at the
site root:

```
https://jaltaevers.github.io/Spoti-Kiddies/
```

`/spike/` is left in place as the original debug tool, untouched — useful
if playback ever needs troubleshooting again without the full app's UI in
the way.

### One required setup step before the real app will log in

The spike and the real app are served from different paths
(`/spike/` vs. the site root), and Spotify checks the Redirect URI
**exactly** — so the real app needs its own entry added, separately from
the spike's:

1. Go to the app's settings at the
   [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add this **Redirect URI** (trailing slash included):
   `https://jaltaevers.github.io/Spoti-Kiddies/`
3. Save.

That's it — the Client ID is already wired in, and Pages auto-deploys on
every push, so nothing else is needed.

#### If login still fails with a redirect URI error

Spotify shows its own error page (not this app's) when `redirect_uri`
doesn't match a registered URI exactly, so a parent debugging this from the
app itself can't see why. The login screen has a **"Trouble logging in?"**
section that shows the exact address the app is sending and a button to
copy it — open that and paste the value straight into the dashboard to
rule out a typo. Beyond a plain typo, the usual causes are:

- **Trailing slash.** `https://jaltaevers.github.io/Spoti-Kiddies/` and
  the same address without the trailing slash are different Redirect
  URIs to Spotify — the one with the slash is the one this app sends.
- **Not actually saved.** Spotify's dashboard adds the URI to a list when
  you click "Add", but it isn't applied until you also click **Save** at
  the bottom of the page.
- **`localhost` is never accepted**, even if you register it — see
  "Local dev" below.
- **Opened as a local file** (double-clicked `index.html` instead of
  loading it through a server) — there's no valid address to register in
  that case; see "Local dev" below.

### First run

With no songs configured yet, opening the site goes straight to parent
mode (there's nothing to show in kid mode with zero tiles). The **Quick
setup** box at the top is the fast path: enter the kid's name (optional —
shows as a small greeting in kid mode and in the browser tab title) and
paste a link to a playlist you own or collaborate on (Spotify's
Development Mode restrictions block reading other accounts' playlists),
then **Load playlist as tiles** — that's it, tap **Save** and **Done** to
see the kid-facing grid.

For more control, further down: search for individual songs, drag to
reorder, override any tile with an emoji + color instead of album art,
and set end-of-song behavior, a max volume cap, a sleep timer, and hide
explicit tracks (default on).

Parent mode is reachable any time by press-and-holding the small circle in
the top-right corner of kid mode for 3 seconds, then entering the PIN (set
on first use).

### Known simplifications worth knowing about

- **Drag-to-reorder** in the song list works but is a simple implementation
  (the row follows your finger/cursor and drops at the nearest slot) rather
  than a polished live-reordering animation.
- **Emoji/color tile overrides** use the browser's native emoji keyboard and
  color picker (via a plain text field and `<input type="color">`) rather
  than a custom picker UI — quick to build, and tablets already have a
  built-in emoji keyboard.
- **The "~6 months" refresh-token expiry warning** in the account panel is
  an estimate (Spotify doesn't publish an exact day count), not a precise
  countdown.

## Local dev

`http://127.0.0.1:<port>/` also works for iterating from a computer —
register that as a Redirect URI too (both `/` and `/spike/` variants, as
needed) — but isn't required for the deployed site above. Use
`127.0.0.1`, not `localhost`: Spotify rejects `localhost` redirect URIs
outright, even if you register one — so if your dev server's own startup
message prints a `localhost` URL, swap in `127.0.0.1` before opening it.
Opening `index.html` straight from disk (a `file://` address) won't work
either — Spotify has no valid address to redirect back to in that case,
so it needs to be served over `http://` by something, however minimal.

## Phase 0 spike (historical)

`SPIKE.md` has the original feasibility-test checklist and the Spotify API
research done before writing any playback code, including the Feb/Mar 2026
Development Mode migration notes (which endpoints changed, the playlist
ownership restriction, refresh token expiry). Still accurate background
reading if something Spotify-API-related needs revisiting.
