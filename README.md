# AlpiX

Collaborative 256×256 pixel canvas — humans and AI models paint together in real time.

This repo is a **pnpm workspace** with:

| Package | Path | Role |
| --- | --- | --- |
| `@alpix/mcp` | [`apps/mcp`](apps/mcp) | Skybridge MCP / ChatGPT App (Alpic) |
| `@alpix/web` | [`apps/web`](apps/web) | Standalone WebMCP site (Netlify) |
| `@alpix/component` | [`packages/component`](packages/component) | Shared canvas UI + stamp/persist helpers |

Both apps write to the **same shared Supabase canvas**.

## WebMCP challenge

The web app exposes WebMCP tools in sequence:

- **`set-display-name`** (declarative form) — first visit only, while the name dialog is open. Sets the viewer’s public nickname. `stamp-grid` is **not** registered until this succeeds.
- **`select-zone`** (imperative) — mark or clear the drawing rectangle. Humans can still drag the same zone in select mode; the tool writes that same overlay. Optional until a zone is needed.
- **`stamp-grid`** (imperative, `webmcp-react`) — place an ASCII-grid sprite on the live canvas. The page injects the stored display name; if a selection zone is active, stamps outside it are rejected. Pixels appear live over Supabase Realtime.

Judges can open the live site in ChatGPT’s in-app browser or Chrome with WebMCP enabled. An agent should call `set-display-name` first (if the dialog is open), optionally `select-zone`, then `stamp-grid`.

## Prerequisites

- Node.js 24+
- pnpm 10+

## Setup

```bash
pnpm install
```

### MCP App

```bash
cp apps/mcp/.env.example apps/mcp/.env
# fill SUPABASE_* (+ optional LULU_ADS_*)
pnpm dev:mcp
```

- MCP: `http://localhost:3000/mcp`
- Skybridge DevTools: `http://localhost:3000/`

### Web app

```bash
cp apps/web/.env.example apps/web/.env
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
# optional: VITE_DESCOPE_PROJECT_ID and DESCOPE_PROJECT_ID (see Authentication)
pnpm dev:web
```

Open the printed localhost URL. With Chrome DevTools MCP / WebMCP support:

1. `list_webmcp_tools` → should show `set-display-name` and `select-zone` (no name yet), or `select-zone` and `stamp-grid` (name already stored)
2. If the name dialog is open, call `set-display-name`
3. Optionally call `select-zone` with `{ "x": 10, "y": 10, "width": 32, "height": 32 }` — the fuchsia overlay should appear; the human select-mode button still works
4. Call `stamp-grid` with a small grid (e.g. a 3×3 heart) inside that zone and watch the canvas update

## Authentication (Descope)

Sign-up, sign-in, and log-out use [Descope](https://www.descope.com) on the web app. The shared canvas, WebMCP tools, and MCP drawing tools stay usable without an account. When Descope is configured:

- `/login` renders the Descope flow (default flow ID `sign-up-or-in`, which handles both sign-up and sign-in).
- `/account` is protected. Signed-out visitors are sent to `/login`.
- `GET /api/me` requires `Authorization: Bearer <session JWT>` and validates it with `@descope/node-sdk` (`validateSession`, audience = the project ID). The same route is mounted on the MCP server for local and self-hosted runs. Alpic only routes `/mcp`, so the Netlify function is the production endpoint for the website.
- Log out from the canvas header or the account page.

A Descope management key is not required and is not read.

### Descope console

1. Create a project at [app.descope.com](https://app.descope.com).
2. Copy the **Project ID** from **Project Settings** (or the project home).
3. Open **Flows**. Use the built-in **Sign Up or In** flow. Its flow ID is `sign-up-or-in`. AlpiX renders that ID unless you set `VITE_DESCOPE_FLOW_ID` to another flow's ID (shown in the flow editor).
4. On that flow, keep at least one method enabled (for example email OTP, magic link, or a social login under **Authentication Methods**). The default screens are enough; you do not need to publish a custom flow.
5. If the embedded flow refuses to load, add your web origins (local Vite URL and the Netlify site) to the project's allowed domains.
6. Leave the API base URL as `https://api.descope.com` unless the project uses a custom domain. If it does, set `DESCOPE_BASE_URL` and `VITE_DESCOPE_BASE_URL` to that origin.

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_DESCOPE_PROJECT_ID` | `apps/web/.env`, Netlify | Project ID for the React SDK |
| `DESCOPE_PROJECT_ID` | `apps/web/.env`, Netlify, `apps/mcp/.env`, Alpic | Project ID for `validateSession`. Must match the Vite value |
| `VITE_DESCOPE_FLOW_ID` | web | Optional. Defaults to `sign-up-or-in` |
| `DESCOPE_BASE_URL` / `VITE_DESCOPE_BASE_URL` | server / web | Optional custom Descope API origin |

The session API accepts `VITE_DESCOPE_PROJECT_ID` when `DESCOPE_PROJECT_ID` is unset, so a single local web env value is enough. Set both in production to the same project ID.

## Build

```bash
pnpm build:mcp   # Skybridge / Alpic
pnpm build:web   # static site → apps/web/dist
```

## Deploy

**Web (Netlify):** set the site **Base directory** / package directory to `apps/web`. Config lives in [`apps/web/netlify.toml`](apps/web/netlify.toml); the build `cd`s to the workspace root, then publishes `apps/web/dist`. Set site env:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DESCOPE_PROJECT_ID` and `DESCOPE_PROJECT_ID` (same project ID; omit both to ship the canvas without sign-in)
- `VITE_DESCOPE_FLOW_ID` if you are not using `sign-up-or-in`

**MCP (Alpic):** project **Root Directory** must be the repo root — `apps/mcp` alone can't resolve `@alpix/component@workspace:*`. [`alpic.json`](alpic.json) sets `pnpm install`, `pnpm run --silent start`, and `buildOutputDir` to `apps/mcp/dist` (Skybridge writes there, not to a root `dist`). The root `build` and `start` scripts target `@alpix/mcp`. Git deploys from `main`, or `pnpm deploy:mcp` from the workspace. Optional: `DESCOPE_PROJECT_ID` so local/self-hosted `GET /api/me` can validate session tokens. Drawing tools do not require it.

## License

[MIT](LICENSE)
