# Spotify to YouTube Music Migrator

Local browser automation for moving Spotify playlists or liked songs into
YouTube Music without the Spotify Developer API.

## What It Does

- Opens Spotify Web in a persistent Playwright browser profile.
- Reads playlist rows by scrolling the page.
- Saves tracks to `migration-output/spotify-tracks.json`.
- Opens YouTube Music in the same browser profile.
- Searches each song and adds the first result to an existing playlist, or likes it.
- Saves progress to `migration-output/ytmusic-state.json` so the run can resume.

No Spotify client secret, no copied cookies, no `headers_auth.json`.

## Install Playwright

This repo does not currently include Python Playwright, so install it once:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

## First Login

The script uses this persistent profile:

```text
~/.cache/spotify-ytmusic-migrator
```

On the first run, it pauses after opening Spotify and YouTube Music. Log in in
the browser window, then press Enter in the terminal. Future runs reuse the same
profile.

## Export A Spotify Playlist

```bash
npm run spotify:migrate -- \
  --spotify-url "https://open.spotify.com/playlist/PLAYLIST_ID" \
  --export-only
```

For liked songs:

```bash
npm run spotify:migrate -- \
  --spotify-url "https://open.spotify.com/collection/tracks" \
  --export-only
```

## Import To An Existing YouTube Music Playlist

Create the target playlist in YouTube Music first, then run:

```bash
npm run spotify:migrate -- \
  --import-json migration-output/spotify-tracks.json \
  --yt-playlist "Spotify Migration"
```

## Export And Import In One Run

```bash
npm run spotify:migrate -- \
  --spotify-url "https://open.spotify.com/playlist/PLAYLIST_ID" \
  --yt-playlist "Spotify Migration"
```

## Like Songs Instead Of Adding To A Playlist

```bash
npm run spotify:migrate -- \
  --import-json migration-output/spotify-tracks.json \
  --mode like
```

## Test With A Small Batch

```bash
npm run spotify:migrate -- \
  --spotify-url "https://open.spotify.com/playlist/PLAYLIST_ID" \
  --yt-playlist "Spotify Migration" \
  --limit 5
```

## Resume After A Failure

The importer skips tracks already marked done in
`migration-output/ytmusic-state.json`.

To resume from a specific 1-based track index:

```bash
npm run spotify:migrate -- \
  --import-json migration-output/spotify-tracks.json \
  --yt-playlist "Spotify Migration" \
  --start-at 37
```

## Notes

- YouTube Music and Spotify change their DOM sometimes. If clicks fail, rerun
  with `--slowmo 100` so you can watch where it gets stuck.
- The importer intentionally uses the first YouTube Music search result. Review
  the state file for `matched_text` if exact matching matters for a playlist.
- If Chrome launch fails, try bundled Chromium:

```bash
npm run spotify:migrate -- \
  --spotify-url "https://open.spotify.com/playlist/PLAYLIST_ID" \
  --yt-playlist "Spotify Migration" \
  --browser-channel ""
```
