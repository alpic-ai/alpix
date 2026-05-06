#!/usr/bin/env python3
"""
Generate a timelapse of the GPT War canvas from the placements event log.

One frame is emitted per drawing (i.e. per stamp-grid tool call), so you
see each AI brush stroke land in sequence. The final frame is held for a
few seconds so the finished canvas is readable.

Usage
-----
  pip install -r scripts/requirements.txt
  python scripts/timelapse.py [options]

Options
-------
  --output PATH     Output file (.mp4 requires ffmpeg, .gif needs nothing extra)
                    Default: timelapse.mp4
  --fps N           Playback speed in frames per second   [default: 8]
  --scale N         Canvas pixels per screen pixel        [default: 4]
  --freeze N        Extra seconds to hold the last frame  [default: 3]
  --since DATE      Only include placements after this ISO date (e.g. 2025-01-01)
  --until DATE      Only include placements before this ISO date
"""

import argparse
import os
import sys
from itertools import groupby
from pathlib import Path

import numpy as np
from PIL import Image
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm
import imageio

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CANVAS_SIZE = 256
PAGE_SIZE = 1000
EMPTY_COLOR = (0xF0, 0xF0, 0xF0)   # matches the widget background

# Palette from server/src/palette.ts — index corresponds to color column value
PALETTE = [
    (0x6D, 0x00, 0x1A),  # 00 dark_red
    (0xBE, 0x00, 0x39),  # 01 red
    (0xFF, 0x45, 0x00),  # 02 orange_red
    (0xFF, 0xA8, 0x00),  # 03 orange
    (0xFF, 0xD6, 0x35),  # 04 yellow
    (0xFF, 0xF8, 0xB8),  # 05 pale_yellow
    (0x00, 0xA3, 0x68),  # 06 dark_green
    (0x00, 0xCC, 0x78),  # 07 green
    (0x7E, 0xED, 0x56),  # 08 light_green
    (0x00, 0x75, 0x6F),  # 09 dark_teal
    (0x00, 0x9E, 0xAA),  # 10 teal
    (0x00, 0xCC, 0xC0),  # 11 light_teal
    (0x24, 0x50, 0xA4),  # 12 dark_blue
    (0x36, 0x90, 0xEA),  # 13 blue
    (0x51, 0xE9, 0xF4),  # 14 light_blue
    (0x49, 0x3A, 0xC1),  # 15 indigo
    (0x6A, 0x5C, 0xFF),  # 16 periwinkle
    (0x94, 0xB3, 0xFF),  # 17 lavender
    (0x81, 0x1E, 0x9F),  # 18 dark_purple
    (0xB4, 0x4A, 0xC0),  # 19 purple
    (0xE4, 0xAB, 0xFF),  # 20 pink_purple
    (0xDE, 0x10, 0x7F),  # 21 magenta
    (0xFF, 0x38, 0x81),  # 22 pink
    (0xFF, 0x99, 0xAA),  # 23 light_pink
    (0x6D, 0x48, 0x2F),  # 24 dark_brown
    (0x9C, 0x69, 0x26),  # 25 brown
    (0xFF, 0xB4, 0x70),  # 26 beige
    (0x00, 0x00, 0x00),  # 27 black
    (0x51, 0x52, 0x52),  # 28 dark_gray
    (0x89, 0x8D, 0x90),  # 29 gray
    (0xD4, 0xD7, 0xD9),  # 30 light_gray
    (0xFF, 0xFF, 0xFF),  # 31 white
]

PALETTE_NP = np.array(PALETTE, dtype=np.uint8)


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_placements(client, since: str | None, until: str | None) -> list[dict]:
    """
    Pull all placements from Supabase ordered by placed_at, paginated.
    Returns a list of dicts with x, y, color, placed_at, drawing_id.
    """
    rows: list[dict] = []
    offset = 0

    print("Fetching placements from Supabase…", flush=True)
    with tqdm(unit=" rows", unit_scale=True) as bar:
        while True:
            q = (
                client.table("placements")
                .select("x, y, color, placed_at, drawing_id")
                .order("placed_at", desc=False)
                .order("id", desc=False)
                .range(offset, offset + PAGE_SIZE - 1)
            )
            if since:
                q = q.gte("placed_at", since)
            if until:
                q = q.lte("placed_at", until)

            resp = q.execute()
            batch = resp.data or []
            rows.extend(batch)
            bar.update(len(batch))
            if len(batch) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

    print(f"  {len(rows):,} placements loaded across {_count_drawings(rows):,} drawings.")
    return rows


def _count_drawings(rows: list[dict]) -> int:
    return len({r["drawing_id"] for r in rows})


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def canvas_to_rgb(canvas: np.ndarray) -> np.ndarray:
    """
    Convert a (H, W) int16 canvas (-1 = empty, 0-31 = palette index)
    to a (H, W, 3) uint8 RGB array.
    """
    rgb = np.full((CANVAS_SIZE, CANVAS_SIZE, 3), EMPTY_COLOR, dtype=np.uint8)
    mask = canvas >= 0
    if mask.any():
        rgb[mask] = PALETTE_NP[canvas[mask]]
    return rgb


def render_frame(canvas: np.ndarray, scale: int) -> np.ndarray:
    """Render the canvas to an upscaled RGB ndarray ready for imageio."""
    rgb = canvas_to_rgb(canvas)
    if scale > 1:
        rgb = np.repeat(np.repeat(rgb, scale, axis=0), scale, axis=1)
    return rgb


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Timelapse video of GPT War canvas from the placements log"
    )
    p.add_argument("--output", default="timelapse.mp4",
                   help="Output path (.mp4 or .gif)")
    p.add_argument("--fps", type=int, default=8,
                   help="Frames per second")
    p.add_argument("--scale", type=int, default=4,
                   help="Canvas pixels per screen pixel (upscale factor)")
    p.add_argument("--freeze", type=float, default=3.0,
                   help="Seconds to hold the final frame")
    p.add_argument("--since", default=None,
                   help="Only include placements after this ISO datetime")
    p.add_argument("--until", default=None,
                   help="Only include placements before this ISO datetime")
    return p.parse_args()


def main():
    args = parse_args()

    # Load credentials from .env at the project root
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path)
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env")

    client = create_client(url, key)

    placements = fetch_placements(client, args.since, args.until)
    if not placements:
        sys.exit("No placements found — nothing to render.")

    # Build frames: one per drawing (group of placements sharing a drawing_id)
    canvas = np.full((CANVAS_SIZE, CANVAS_SIZE), -1, dtype=np.int16)

    output = Path(args.output)
    is_gif = output.suffix.lower() == ".gif"

    if is_gif:
        writer = imageio.get_writer(
            str(output),
            mode="I",
            duration=1000 // args.fps,   # ms per frame
            loop=0,
        )
    else:
        writer = imageio.get_writer(
            str(output),
            fps=args.fps,
            codec="libx264",
            quality=8,
            macro_block_size=None,
        )

    print(f"Rendering frames → {output}  (scale={args.scale}x, fps={args.fps})")

    # Group consecutive rows by drawing_id to emit one frame per tool call.
    # rows are already sorted by (placed_at, id) from the DB query.
    grouped = groupby(placements, key=lambda r: r["drawing_id"])
    drawings = [(did, list(rows)) for did, rows in grouped]

    freeze_frames = max(1, round(args.freeze * args.fps))

    for drawing_id, rows in tqdm(drawings, desc="Drawings", unit="frame"):
        for p in rows:
            x, y, color = p["x"], p["y"], p["color"]
            if 0 <= x < CANVAS_SIZE and 0 <= y < CANVAS_SIZE and 0 <= color < len(PALETTE):
                canvas[y, x] = color
        writer.append_data(render_frame(canvas, args.scale))

    # Hold the final frame
    final = render_frame(canvas, args.scale)
    for _ in range(freeze_frames):
        writer.append_data(final)

    writer.close()
    print(f"Done → {output.resolve()}")


if __name__ == "__main__":
    main()
