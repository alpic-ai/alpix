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
- **Auth**: Descope accounts on the standalone web app, plus the existing public display name for drawing attribution. There is no rate limiting in v1.
  - Sign-up, sign-in, and sign-out use the hosted Descope flow `sign-up-or-in` (`@descope/react-sdk`). `/sign-in` runs the flow. `/account` is protected: the browser must hold a Descope session, then `GET /api/session` validates the session JWT with `@descope/node-sdk` (`validateSession`, audience = project ID unless `DESCOPE_SESSION_AUDIENCE` is set).
  - Configuration is `DESCOPE_PROJECT_ID` (public). The web build also accepts `VITE_DESCOPE_PROJECT_ID`. A management key is not used. If the project ID is missing, the web app shows a configuration error and `/api/session` returns 503.
  - The canvas, `set-display-name`, `select-zone`, and `stamp-grid` stay available without an account so the WebMCP challenge and the ChatGPT widget keep working. Drawings are still attributed to the viewer-chosen nickname, not the Descope user id.
  - The browser calls same-origin `/api/session` (Vite in dev, a Netlify function in production). The MCP server mounts the same route for local and self-hosted Skybridge. Alpic Cloud only routes `/mcp`, so that copy is not the production browser endpoint.
- **Storage**: Supabase
  - `drawings` stores one logical drawing/tool call, `placements` is the append-only per-pixel event log, and `pixels` is the current-state projection upserted on `(x, y)`.
  - After persistence succeeds, the server sends one public Supabase Realtime Broadcast containing the drawing ID and compact `[x, y, color]` tuples. The administrative reset script sends one `canvas-reset` Broadcast after clearing the projection.
  - Widgets subscribe to the batch Broadcast, not row-level Postgres Changes. On subscription or reconnection they fetch the authoritative `pixels` snapshot and replay batches received while that fetch is in flight.
  - Broadcast is an ephemeral acceleration path; Postgres remains the source of truth. A missed or failed Broadcast heals on the next snapshot refresh.
  - RLS policies allow anon SELECT/INSERT/UPDATE (matches "no auth" v1). Server and widget share a single anon key. Tradeoff: the anon key is exposed in the widget, so direct DB writes bypassing the MCP tool are possible — acceptable under "no auth, no rate limit" for v1. Upgrade path: switch server to `service_role`, restrict anon RLS to SELECT.
- **Server**: MCP server (Alpic-hosted). Exposes:
  - `canvas` widget tool — opens the shared canvas, returns current canvas metadata, and requests a fail-open Lulu Ads sponsored slot. When filled, the disclosed native strip stays subordinate to the canvas and disappears without leaving a gap on no-fill.
  - `stamp-grid` tool — persists one batched drawing and publishes its compact Realtime batch.
  - `get-leaderboard` tool — aggregates pixels placed by model on the current canvas.
- **WebMCP (standalone Netlify site)**: The public AlpiX homepage. In-browser agents get:
  - `set-display-name` (declarative form) while the name dialog is open.
  - `select-zone` (imperative) to mark or clear the drawing rectangle. The human select-mode UI remains; both write the same overlay. Stamps outside an active zone are rejected.
  - `stamp-grid` (imperative) after a display name is chosen.
  - Header links to the [Alpic playground](https://alpix.alpic.ai/try), the [ChatGPT app](https://chatgpt.com/apps/alpix/asdk_app_6a0dcc1413f88191ba2dd68c73cb841e), and the [Claude directory listing](https://claude.ai/directory/alpix).
- **Monetization**: Lulu Ads is enabled only on the required first-view `canvas` tool. Publisher credentials come from `LULU_ADS_PUBLISHER_ID` and `LULU_ADS_PUBLISHER_KEY` deployment environment variables; no credential is stored in the repository.
- **Constraints for v1**:
  - No `get_canvas` / read tool — the LLM draws blind; the widget is where state lives.
  - Canvas attribution is still the viewer-selected display name plus the model-provided model name. Descope verifies the account behind `/account` and `/api/session` only.
  - No rate limiting, no moderation.
  - Designed so canvas size and palette can be bumped later without schema breaks.
