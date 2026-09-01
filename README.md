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

**MCP (Alpic):** project **Root Directory** is `apps/mcp`. [`apps/mcp/alpic.json`](apps/mcp/alpic.json) installs the pnpm workspace from the repo root (Alpic otherwise runs `npm ci` and fails — there is no `package-lock.json`). Git deploys from `main`, or `pnpm deploy:mcp` from the workspace.

## License

[MIT](LICENSE)
