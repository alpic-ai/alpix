# GPT War — Collaborative Pixel Canvas

## Value Proposition
A shared pixel canvas (inspired by r/place) where ChatGPT users paint together through conversation. One global 256×256 world, persists forever, everyone sees the same thing.

**Target**: ChatGPT users who want a playful, creative, social canvas.
**Pain today**: r/place-style games require a browser, manual clicking, and careful per-pixel placement. Describing an image in words is much faster.

**Core actions**:
1. View the live global canvas (inline widget, expandable to fullscreen).
2. Place a rectangular batch of pixels with an ASCII-grid tool.

## Why LLM?
**Conversational win**: "draw a yellow bird around (30, 20)" = one sentence replaces hundreds of clicks.
**LLM adds**: Generates pixel-art coordinate sequences from natural language ("a bird", "the letter A", "a heart"). Reasons about shape, size, and placement.
**What LLM lacks**: Real-time canvas state, persistent storage, the ability to broadcast placements to other viewers.

## UI Overview
**First view**: The live 256×256 canvas rendered as a pixel grid. Small inline size by default, with fullscreen and picture-in-picture modes.
**Drawing**: User asks for something; the LLM calls `stamp-grid` with up to 4,096 non-transparent pixels. The completed drawing is broadcast to every open widget as one compact Realtime batch and applied locally.
**End state**: Canvas is persistent and shared — users leave, come back, canvas has evolved. There is no "end" — it's an ongoing world.

## Product Context
- **Canvas**: 256×256 pixels, one current shared canvas plus retained historical canvases.
- **Palette**: Fixed 32-color palette (r/place-style). Tool accepts a color index or named color from this palette — not arbitrary hex (keeps LLM output clean and the widget rendering cheap).
- **Auth**: No account authentication. Viewers choose a display name used for drawing attribution; there is no rate limiting in v1.
- **Storage**: Supabase
  - `drawings` stores one logical drawing/tool call, `placements` is the append-only per-pixel event log, and `pixels` is the current-state projection upserted on `(x, y)`.
  - After persistence succeeds, the server sends one public Supabase Realtime Broadcast containing the drawing ID and compact `[x, y, color]` tuples. The administrative reset script sends one `canvas-reset` Broadcast after clearing the projection.
  - Widgets subscribe to the batch Broadcast, not row-level Postgres Changes. On subscription or reconnection they fetch the authoritative `pixels` snapshot and replay batches received while that fetch is in flight.
  - Broadcast is an ephemeral acceleration path; Postgres remains the source of truth. A missed or failed Broadcast heals on the next snapshot refresh.
  - RLS policies allow anon SELECT/INSERT/UPDATE (matches "no auth" v1). Server and widget share a single anon key. Tradeoff: the anon key is exposed in the widget, so direct DB writes bypassing the MCP tool are possible — acceptable under "no auth, no rate limit" for v1. Upgrade path: switch server to `service_role`, restrict anon RLS to SELECT.
- **Server**: MCP server (Alpic-hosted). Exposes:
  - `canvas` widget tool — opens the shared canvas and returns current canvas metadata.
  - `stamp-grid` tool — persists one batched drawing and publishes its compact Realtime batch.
  - `get-leaderboard` tool — aggregates pixels placed by model on the current canvas.
- **Constraints for v1**:
  - No `get_canvas` / read tool — the LLM draws blind; the widget is where state lives.
  - No verified identity; attribution uses the viewer-selected display name and model-provided model name.
  - No rate limiting, no moderation.
  - Designed so canvas size and palette can be bumped later without schema breaks.
