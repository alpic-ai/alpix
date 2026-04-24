# GPT War — Collaborative Pixel Canvas

## Value Proposition
A shared pixel canvas (inspired by r/place) where ChatGPT users paint together through conversation. One global 128×128 world, persists forever, everyone sees the same thing.

**Target**: ChatGPT users who want a playful, creative, social canvas.
**Pain today**: r/place-style games require a browser, manual clicking, and careful per-pixel placement. Describing an image in words is much faster.

**Core actions**:
1. View the live global canvas (inline widget, expandable to fullscreen).
2. Place a pixel at (x, y) with a color — via an LLM-driven tool, called repeatedly to draw shapes.

## Why LLM?
**Conversational win**: "draw a yellow bird around (30, 20)" = one sentence replaces hundreds of clicks.
**LLM adds**: Generates pixel-art coordinate sequences from natural language ("a bird", "the letter A", "a heart"). Reasons about shape, size, and placement.
**What LLM lacks**: Real-time canvas state, persistent storage, the ability to broadcast placements to other viewers.

## UI Overview
**First view**: The live 128×128 canvas rendered as a pixel grid. Small inline size by default, with a "fullscreen" affordance.
**Drawing**: User asks for something; the LLM calls `place_pixel` many times; each placement appears live in the widget via Supabase Realtime subscription. No cooldown for v1.
**End state**: Canvas is persistent and shared — users leave, come back, canvas has evolved. There is no "end" — it's an ongoing world.

## Product Context
- **Canvas**: 128×128 pixels, single global shared instance.
- **Palette**: Fixed 32-color palette (r/place-style). Tool accepts a color index or named color from this palette — not arbitrary hex (keeps LLM output clean and the widget rendering cheap).
- **Auth**: None. Anonymous users; no rate limiting in v1.
- **Storage**: Supabase
  - Postgres table `pixels` (x, y, color, updated_at) — one row per placed pixel, upsert on (x, y).
  - Supabase Realtime broadcasts `pixels` inserts/updates to the widget.
  - RLS policies allow anon SELECT/INSERT/UPDATE (matches "no auth" v1). Server and widget share a single anon key. Tradeoff: the anon key is exposed in the widget, so direct DB writes bypassing the MCP tool are possible — acceptable under "no auth, no rate limit" for v1. Upgrade path: switch server to `service_role`, restrict anon RLS to SELECT.
- **Server**: MCP server (Alpic-hosted). Exposes:
  - 1 tool: `place_pixel(x, y, color)` — writes to Supabase.
  - 1 widget: `canvas` — subscribes to Supabase Realtime, renders the grid, supports fullscreen.
- **Constraints for v1**:
  - No `get_canvas` / read tool — the LLM draws blind; the widget is where state lives.
  - No user identity / attribution on pixels.
  - No rate limiting, no moderation.
  - Designed so canvas size and palette can be bumped later without schema breaks.
