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

### First run

With no songs configured yet, opening the site goes straight to parent
mode (there's nothing to show in kid mode with zero tiles). From there:
add at least 4 songs (search, or paste a link to a playlist you own or
collaborate on — Spotify's Development Mode restrictions block reading
other accounts' playlists), adjust settings, tap **Save**, then **Done**
to see the kid-facing grid.

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
needed) — but isn't required for the deployed site above.

## Phase 0 spike (historical)

`SPIKE.md` has the original feasibility-test checklist and the Spotify API
research done before writing any playback code, including the Feb/Mar 2026
Development Mode migration notes (which endpoints changed, the playlist
ownership restriction, refresh token expiry). Still accurate background
reading if something Spotify-API-related needs revisiting.
