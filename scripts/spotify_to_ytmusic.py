#!/usr/bin/env python3
"""
Browser-assisted Spotify to YouTube Music migrator.

No Spotify API, no copied cookies, no headers_auth.json. The script opens a
persistent Playwright browser profile, lets you log in normally, exports visible
Spotify playlist tracks, then searches YouTube Music and adds each match to an
existing YouTube Music playlist or likes it.

This is intentionally conservative: it checkpoints every track and can be
resumed safely after UI failures.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus


try:
    from playwright.sync_api import BrowserContext, Error, Locator, Page, TimeoutError, sync_playwright
except ModuleNotFoundError:
    print(
        "Python Playwright is not installed.\n"
        "Install it with:\n"
        "  python3 -m pip install playwright\n"
        "  python3 -m playwright install chromium",
        file=sys.stderr,
    )
    raise SystemExit(1)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = Path.home() / ".cache" / "spotify-ytmusic-migrator"
DEFAULT_OUTPUT = ROOT / "migration-output" / "spotify-tracks.json"
DEFAULT_STATE = ROOT / "migration-output" / "ytmusic-state.json"


@dataclass(frozen=True)
class Track:
    title: str
    artists: list[str]
    album: str = ""
    duration: str = ""
    spotify_url: str = ""

    @property
    def artist_text(self) -> str:
        return ", ".join(self.artists)

    @property
    def key(self) -> str:
        return normalize_key(f"{self.title} {self.artist_text}")

    @property
    def query(self) -> str:
        return f"{self.title} {self.artist_text}".strip()


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def clean_lines(text: str) -> list[str]:
    return [line.strip() for line in re.split(r"[\r\n]+", text or "") if line.strip()]


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text())


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def locator_text(locator: Locator, timeout: int = 800) -> str:
    try:
        return locator.inner_text(timeout=timeout).strip()
    except (Error, TimeoutError):
        return ""


def first_text(row: Locator, selectors: list[str]) -> str:
    for selector in selectors:
        text = locator_text(row.locator(selector).first())
        if text:
            return clean_lines(text)[0]
    return ""


def all_texts(row: Locator, selector: str) -> list[str]:
    try:
        matches = row.locator(selector)
        matches.first().wait_for(timeout=800)
        values = matches.all_inner_texts()
    except (Error, TimeoutError):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        for line in clean_lines(value):
            key = normalize_key(line)
            if key and key not in seen:
                seen.add(key)
                out.append(line)
    return out


def launch_context(args: argparse.Namespace) -> tuple[Any, BrowserContext]:
    args.profile.mkdir(parents=True, exist_ok=True)
    launch_options = {
        "headless": args.headless,
        "slow_mo": args.slowmo,
        "viewport": {"width": 1440, "height": 1000},
        "accept_downloads": True,
    }

    playwright = sync_playwright().start()
    try:
        if args.browser_channel:
            context = playwright.chromium.launch_persistent_context(
                str(args.profile),
                channel=args.browser_channel,
                **launch_options,
            )
            return playwright, context
        context = playwright.chromium.launch_persistent_context(str(args.profile), **launch_options)
        return playwright, context
    except Error as error:
        if args.browser_channel:
            print(f"Could not launch channel '{args.browser_channel}', falling back to bundled Chromium.")
            try:
                context = playwright.chromium.launch_persistent_context(str(args.profile), **launch_options)
                return playwright, context
            except Error:
                pass
        print(str(error), file=sys.stderr)
        print("If Chromium is missing, run: python3 -m playwright install chromium", file=sys.stderr)
        raise SystemExit(1)


def pause_for_login(page: Page, service: str, skip_pause: bool) -> None:
    if skip_pause:
        return
    print(f"\n{service}: if the browser is not logged in, log in now.")
    print("When the page looks ready, come back here and press Enter.")
    input("> ")
    page.wait_for_timeout(1500)


def parse_spotify_row(row: Locator) -> Track | None:
    title = first_text(
        row,
        [
            '[data-testid="internal-track-link"]',
            'a[href*="/track/"]',
            '[aria-colindex="2"] a',
            '[role="gridcell"] a',
        ],
    )

    artists = all_texts(row, 'a[href*="/artist/"]')
    row_text = locator_text(row, timeout=1200)
    lines = clean_lines(row_text)

    if not title and lines:
        title = lines[0]
    if not artists and len(lines) > 1:
        artists = [line for line in lines[1:4] if not re.fullmatch(r"\d+:\d{2}", line)]

    duration = ""
    for line in reversed(lines):
        if re.fullmatch(r"\d+:\d{2}", line):
            duration = line
            break

    album = ""
    for line in lines:
        if line not in {title, *artists, duration} and not re.fullmatch(r"\d+:\d{2}", line):
            album = line
            break

    spotify_url = ""
    try:
        href = row.locator('a[href*="/track/"]').first().get_attribute("href", timeout=500)
        if href:
            spotify_url = href if href.startswith("http") else f"https://open.spotify.com{href}"
    except (Error, TimeoutError):
        pass

    if not title or not artists:
        return None
    return Track(title=title, artists=artists, album=album, duration=duration, spotify_url=spotify_url)


def spotify_rows(page: Page) -> list[Locator]:
    candidates = [
        '[data-testid="tracklist-row"]',
        '[role="row"][aria-rowindex]',
        'div[aria-rowindex][role="row"]',
    ]
    for selector in candidates:
        rows = page.locator(selector).all()
        if rows:
            return rows
    return []


def export_spotify_tracks(context: BrowserContext, args: argparse.Namespace) -> list[Track]:
    page = context.new_page()
    page.goto(args.spotify_url, wait_until="domcontentloaded", timeout=args.timeout)
    pause_for_login(page, "Spotify", args.no_login_pause)
    page.wait_for_load_state("domcontentloaded", timeout=args.timeout)
    page.wait_for_timeout(3000)

    tracks_by_key: dict[str, Track] = {}
    stagnant_scrolls = 0
    last_count = 0

    for scroll_index in range(args.max_scrolls):
        for row in spotify_rows(page):
            track = parse_spotify_row(row)
            if track and track.key not in tracks_by_key:
                tracks_by_key[track.key] = track

        current_count = len(tracks_by_key)
        print(f"Spotify export: {current_count} unique tracks found after scroll {scroll_index}")
        if args.limit and current_count >= args.limit:
            break

        if current_count == last_count:
            stagnant_scrolls += 1
        else:
            stagnant_scrolls = 0
            last_count = current_count

        if stagnant_scrolls >= args.stagnant_scrolls:
            break

        page.mouse.wheel(0, args.scroll_pixels)
        page.wait_for_timeout(args.scroll_delay_ms)

    tracks = list(tracks_by_key.values())
    if args.limit:
        tracks = tracks[: args.limit]
    write_json(args.out, [asdict(track) for track in tracks])
    print(f"Spotify export complete: wrote {len(tracks)} tracks to {args.out}")
    return tracks


def load_tracks(path: Path, limit: int | None) -> list[Track]:
    rows = read_json(path, [])
    tracks = [
        Track(
            title=row.get("title", ""),
            artists=list(row.get("artists") or []),
            album=row.get("album", ""),
            duration=row.get("duration", ""),
            spotify_url=row.get("spotify_url", ""),
        )
        for row in rows
    ]
    tracks = [track for track in tracks if track.title and track.artists]
    return tracks[:limit] if limit else tracks


def click_first(page: Page, locators: list[Locator], label: str, timeout_ms: int = 2500) -> bool:
    for locator in locators:
        try:
            locator.first().click(timeout=timeout_ms)
            return True
        except (Error, TimeoutError):
            continue
    print(f"Could not click {label}")
    return False


def first_ytmusic_result(page: Page) -> Locator | None:
    selectors = [
        "ytmusic-responsive-list-item-renderer",
        "ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer",
    ]
    for selector in selectors:
        try:
            result = page.locator(selector).first()
            result.wait_for(timeout=5000)
            return result
        except (Error, TimeoutError):
            continue
    return None


def open_result_menu(page: Page, result: Locator) -> bool:
    result.scroll_into_view_if_needed(timeout=3000)
    result.hover(timeout=3000)
    menu_buttons = [
        result.locator('ytmusic-menu-renderer button[aria-label*="Action menu"]'),
        result.locator("ytmusic-menu-renderer tp-yt-paper-icon-button"),
        result.locator("ytmusic-menu-renderer button"),
        result.locator('button[aria-label*="More actions"]'),
    ]
    return click_first(page, menu_buttons, "YouTube Music row menu")


def click_menu_text(page: Page, text_options: list[str]) -> bool:
    locators = []
    for text in text_options:
        locators.extend(
            [
                page.get_by_text(text, exact=True),
                page.get_by_text(text, exact=False),
                page.locator("ytmusic-menu-navigation-item-renderer").filter(has_text=text),
            ]
        )
    return click_first(page, locators, "menu item")


def add_current_result_to_playlist(page: Page, playlist_name: str) -> None:
    if not click_menu_text(page, ["Save to playlist", "Add to playlist"]):
        raise RuntimeError("Save/Add to playlist menu item was not found")
    page.wait_for_timeout(1000)
    playlist_locators = [
        page.get_by_text(playlist_name, exact=True),
        page.locator("ytmusic-playlist-add-to-option-renderer").filter(has_text=playlist_name),
        page.locator("tp-yt-paper-checkbox").filter(has_text=playlist_name),
    ]
    if not click_first(page, playlist_locators, f"playlist '{playlist_name}'", timeout_ms=6000):
        raise RuntimeError(f"Playlist '{playlist_name}' was not found in YouTube Music")
    page.wait_for_timeout(1000)
    click_first(
        page,
        [page.get_by_text("Done", exact=True), page.get_by_text("Add", exact=True)],
        "playlist dialog close",
        timeout_ms=1200,
    )


def like_current_result(page: Page) -> None:
    if not click_menu_text(page, ["Like"]):
        raise RuntimeError("Like menu item was not found")


def import_to_ytmusic(context: BrowserContext, tracks: list[Track], args: argparse.Namespace) -> None:
    page = context.new_page()
    page.goto("https://music.youtube.com", wait_until="domcontentloaded", timeout=args.timeout)
    pause_for_login(page, "YouTube Music", args.no_login_pause)

    state = read_json(args.state, {"done": {}, "failed": {}})
    done: dict[str, Any] = state.setdefault("done", {})
    failed: dict[str, Any] = state.setdefault("failed", {})

    for index, track in enumerate(tracks, start=1):
        if index < args.start_at:
            continue
        if track.key in done:
            print(f"[{index}/{len(tracks)}] already done: {track.query}")
            continue

        print(f"[{index}/{len(tracks)}] searching: {track.query}")
        if args.dry_run:
            continue

        try:
            search_url = f"https://music.youtube.com/search?q={quote_plus(track.query)}"
            page.goto(search_url, wait_until="domcontentloaded", timeout=args.timeout)
            page.wait_for_timeout(args.search_delay_ms)

            for label in ["Songs", "Top result"]:
                try:
                    page.get_by_text(label, exact=True).first().click(timeout=1200)
                    page.wait_for_timeout(1000)
                    break
                except (Error, TimeoutError):
                    pass

            result = first_ytmusic_result(page)
            if result is None:
                raise RuntimeError("No YouTube Music search result found")

            visible_result_text = locator_text(result, timeout=1500)
            if not open_result_menu(page, result):
                raise RuntimeError("Could not open YouTube Music result menu")

            if args.mode == "playlist":
                if not args.yt_playlist:
                    raise RuntimeError("--yt-playlist is required when --mode playlist")
                add_current_result_to_playlist(page, args.yt_playlist)
            else:
                like_current_result(page)

            done[track.key] = {
                "title": track.title,
                "artists": track.artists,
                "query": track.query,
                "matched_text": visible_result_text,
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            failed.pop(track.key, None)
            write_json(args.state, state)
            page.wait_for_timeout(args.add_delay_ms)
        except Exception as error:  # noqa: BLE001 - checkpoint and continue.
            failed[track.key] = {
                "title": track.title,
                "artists": track.artists,
                "query": track.query,
                "error": str(error),
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            write_json(args.state, state)
            print(f"  failed: {error}")

    print(f"YouTube Music import complete: {len(done)} done, {len(failed)} failed")
    print(f"State file: {args.state}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate Spotify tracks to YouTube Music using browser automation.")
    parser.add_argument("--spotify-url", help="Spotify playlist URL, album URL, or https://open.spotify.com/collection/tracks")
    parser.add_argument("--import-json", type=Path, help="Use an existing Spotify export JSON instead of reading Spotify")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT, help="Spotify export JSON path")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE, help="YouTube Music import checkpoint path")
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE, help="Persistent browser profile directory")
    parser.add_argument("--mode", choices=["playlist", "like"], default="playlist", help="Add to playlist or like songs")
    parser.add_argument("--yt-playlist", help="Existing YouTube Music playlist name")
    parser.add_argument("--export-only", action="store_true", help="Only export Spotify tracks")
    parser.add_argument("--dry-run", action="store_true", help="Search/export without clicking add/like")
    parser.add_argument("--headless", action="store_true", help="Run browser headless after login is already set")
    parser.add_argument("--no-login-pause", action="store_true", help="Do not pause for manual login")
    parser.add_argument("--browser-channel", default="chrome", help="Playwright browser channel, e.g. chrome. Use empty string for bundled Chromium")
    parser.add_argument("--limit", type=int, help="Limit tracks for testing")
    parser.add_argument("--start-at", type=int, default=1, help="1-based track index to resume from")
    parser.add_argument("--timeout", type=int, default=60000, help="Navigation timeout in milliseconds")
    parser.add_argument("--max-scrolls", type=int, default=250, help="Maximum Spotify scroll attempts")
    parser.add_argument("--stagnant-scrolls", type=int, default=8, help="Stop after this many scrolls find no new tracks")
    parser.add_argument("--scroll-pixels", type=int, default=1500, help="Spotify scroll distance per pass")
    parser.add_argument("--scroll-delay-ms", type=int, default=1200, help="Delay after Spotify scroll")
    parser.add_argument("--search-delay-ms", type=int, default=2500, help="Delay after YouTube Music search")
    parser.add_argument("--add-delay-ms", type=int, default=1500, help="Delay after add/like action")
    parser.add_argument("--slowmo", type=int, default=0, help="Playwright slow motion in milliseconds")
    args = parser.parse_args()
    if args.browser_channel == "":
        args.browser_channel = None
    if not args.import_json and not args.spotify_url:
        parser.error("provide --spotify-url or --import-json")
    if args.mode == "playlist" and not args.yt_playlist and not args.export_only:
        parser.error("--yt-playlist is required unless --export-only is set")
    return args


def main() -> None:
    args = parse_args()
    playwright, context = launch_context(args)
    try:
        if args.import_json:
            tracks = load_tracks(args.import_json, args.limit)
        else:
            tracks = export_spotify_tracks(context, args)

        if args.export_only:
            return

        import_to_ytmusic(context, tracks, args)
    finally:
        context.close()
        playwright.stop()


if __name__ == "__main__":
    main()
