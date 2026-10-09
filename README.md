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
# fill SUPABASE_* , DESCOPE_PROJECT_ID (+ optional LULU_ADS_*)
pnpm dev:mcp
```

- MCP: `http://localhost:3000/mcp`
- Skybridge DevTools: `http://localhost:3000/`

### Web app

```bash
cp apps/web/.env.example apps/web/.env
# fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and DESCOPE_PROJECT_ID
pnpm dev:web
```

Open the printed localhost URL. With Chrome DevTools MCP / WebMCP support:

1. `list_webmcp_tools` → should show `set-display-name` and `select-zone` (no name yet), or `select-zone` and `stamp-grid` (name already stored)
2. If the name dialog is open, call `set-display-name`
3. Optionally call `select-zone` with `{ "x": 10, "y": 10, "width": 32, "height": 32 }` — the fuchsia overlay should appear; the human select-mode button still works
4. Call `stamp-grid` with a small grid (e.g. a 3×3 heart) inside that zone and watch the canvas update

## Build

```bash
pnpm build:mcp   # Skybridge / Alpic
pnpm build:web   # static site → apps/web/dist
```

## Deploy

**Web (Netlify):** set the site **Base directory** / package directory to `apps/web`. Config lives in [`apps/web/netlify.toml`](apps/web/netlify.toml); the build `cd`s to the workspace root, then publishes `apps/web/dist`. Set site env:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `DESCOPE_PROJECT_ID` (build time and runtime — see below)

**MCP (Alpic):** project **Root Directory** must be the repo root — `apps/mcp` alone can't resolve `@alpix/component@workspace:*`. [`alpic.json`](alpic.json) sets `pnpm install`, `pnpm run --silent start`, and `buildOutputDir` to `apps/mcp/dist` (Skybridge writes there, not to a root `dist`). The root `build` and `start` scripts target `@alpix/mcp`. Git deploys from `main`, or `pnpm deploy:mcp` from the workspace.

## Authentication (Descope)

Accounts use [Descope](https://www.descope.com). The shared canvas and WebMCP tools (`set-display-name`, `select-zone`, `stamp-grid`) stay usable without an account. Drawings are still attributed to the public nickname chosen on the canvas.

| Surface | Behavior |
| --- | --- |
| `/` | Public canvas. Header links to sign in, or to the account page and sign out. |
| `/sign-in` | Hosted Descope flow (`sign-up-or-in` by default) via `@descope/react-sdk`. |
| `/account` | Protected. The page renders only after `GET /api/session` accepts the session JWT. |
| `GET /api/session` | `@descope/node-sdk` `validateSession`. `401` without a valid bearer token, `503` when the project ID is missing. |

The browser calls `/api/session` on the web origin (Vite middleware in `pnpm dev:web`, a Netlify function in production). The MCP server exposes the same route for local and self-hosted Skybridge. Alpic Cloud only forwards `/mcp`, so the Netlify function is the production check the account page uses.

### Environment variables

Set these in `apps/web/.env`, `apps/mcp/.env`, and the matching deploy environments. Do not commit real values.

| Variable | Required | Where |
| --- | --- | --- |
| `DESCOPE_PROJECT_ID` | Yes | Web build, Netlify function, MCP server. Public project ID from the Descope console. |
| `VITE_DESCOPE_PROJECT_ID` | No | Alias for the browser bundle if `DESCOPE_PROJECT_ID` is unset at build time. |
| `DESCOPE_BASE_URL` | No | Custom Descope API domain. Unset uses `https://api.descope.com`. `VITE_DESCOPE_BASE_URL` is the browser alias. |
| `VITE_DESCOPE_FLOW_ID` | No | Hosted flow id. Defaults to `sign-up-or-in`. |
| `DESCOPE_SESSION_AUDIENCE` | No | Expected session JWT `aud`. Defaults to `DESCOPE_PROJECT_ID`. |

No management key is required. Session validation uses the project's public keys. Do not set `DESCOPE_MANAGEMENT_KEY` for this app.

If `DESCOPE_PROJECT_ID` is missing, the web app shows a configuration error instead of the canvas, and `/api/session` responds with `503` and that same explanation.

### Descope console

1. Create a project at [app.descope.com](https://app.descope.com). Copy **Project ID** into `DESCOPE_PROJECT_ID`.
2. **Flows**: leave the built-in **`sign-up-or-in`** flow enabled. The sign-in page requests that id unless `VITE_DESCOPE_FLOW_ID` overrides it. Open the flow and confirm which authentication methods it actually runs.
3. **Authentication methods**: enable the methods that flow uses. A stock `sign-up-or-in` flow is typically email one-time password (magic link / enchanted link if you switch the flow to those). Social buttons only work after you configure those connectors. Descope's built-in OAuth apps are for development; production social login needs your own OAuth client.
4. **Project Settings → App URL**: the web origin users sign in from (`http://localhost:5173` locally, the Netlify origin in production).
5. **Project Settings → Approved Domains**: domain only, no scheme. Include `localhost`, `127.0.0.1`, and the production host. This is the allowlist for redirect and verification URLs.
6. **Redirect URL**: the embedded flow sends magic-link and OAuth returns to `{origin}/sign-in` (for example `http://localhost:5173/sign-in` and `https://<your-site>/sign-in`). Approved Domains must cover those hosts. If a method has its own redirect URL list, add those full URLs there too.
7. Leave the session JWT audience as the project ID unless you set `DESCOPE_SESSION_AUDIENCE` to match a custom JWT template.

## License

[MIT](LICENSE)
