import "dotenv/config";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  CANVAS_SIZE,
  COLOR_INDEX,
  COLOR_NAMES,
  PALETTE,
  type ColorName,
} from "./palette.js";
import { getSupabase, getSupabasePublic } from "./supabase.js";

const MAX_BATCH = 1000;

function supabaseHost(): string {
  const { url } = getSupabasePublic();
  try {
    return new URL(url || "https://placeholder.supabase.co").host;
  } catch {
    return "placeholder.supabase.co";
  }
}

function widgetMeta() {
  return {
    supabase: getSupabasePublic(),
    palette: PALETTE.map((p) => p.hex),
    paletteNames: PALETTE.map((p) => p.name),
  };
}

const csp = {
  ui: {
    csp: {
      connectDomains: [
        `https://${supabaseHost()}`,
        `wss://${supabaseHost()}`,
      ],
      resourceDomains: [] as string[],
    },
  },
};

async function placedCount(): Promise<number> {
  try {
    const { count, error } = await getSupabase()
      .from("pixels")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.warn("[canvas] Failed to count pixels:", e);
    return 0;
  }
}

const server = new McpServer(
  { name: "gpt-war", version: "0.0.1" },
  { capabilities: {} },
)
  .registerWidget(
    "canvas",
    { description: "Live shared pixel canvas", _meta: csp },
    {
      description:
        "Open the live shared pixel canvas. Call this first to show the canvas to the user before placing pixels with place-pixels.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      const placed = await placedCount();
      return {
        structuredContent: {
          size: CANVAS_SIZE,
          placedCount: placed,
        },
        content: [
          {
            type: "text",
            text: `Canvas opened (${CANVAS_SIZE}x${CANVAS_SIZE}, ${placed} pixels placed). Use place-pixels (batch) to draw.`,
          },
        ],
        _meta: widgetMeta(),
      };
    },
  )
  .registerTool(
    "place-pixels",
    {
      description:
        `Place many pixels on the shared ${CANVAS_SIZE}x${CANVAS_SIZE} canvas in a single call. ` +
        `Coordinates: (0,0)=top-left, (${CANVAS_SIZE - 1},${CANVAS_SIZE - 1})=bottom-right. ` +
        `Pack an entire shape (bird, letter, heart, etc.) into one call — up to ${MAX_BATCH} pixels per call. ` +
        `Available colors (32): ${COLOR_NAMES.join(", ")}.`,
      inputSchema: {
        pixels: z
          .array(
            z.object({
              x: z.number().int().min(0).max(CANVAS_SIZE - 1),
              y: z.number().int().min(0).max(CANVAS_SIZE - 1),
              color: z.enum([...COLOR_NAMES] as [ColorName, ...ColorName[]]),
            }),
          )
          .min(1)
          .max(MAX_BATCH)
          .describe(
            `Array of pixels to place. Each has x (column), y (row), color (palette name). Max ${MAX_BATCH} per call.`,
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
    },
    async ({ pixels }) => {
      const now = new Date().toISOString();
      // Dedupe on (x, y) — Supabase upsert with duplicate PKs in one batch errors.
      const byKey = new Map<
        string,
        { x: number; y: number; color: number; updated_at: string }
      >();
      for (const p of pixels) {
        byKey.set(`${p.x},${p.y}`, {
          x: p.x,
          y: p.y,
          color: COLOR_INDEX[p.color],
          updated_at: now,
        });
      }
      const rows = [...byKey.values()];
      const { error } = await getSupabase()
        .from("pixels")
        .upsert(rows, { onConflict: "x,y" });
      if (error) {
        return {
          content: [
            { type: "text", text: `Failed to place pixels: ${error.message}` },
          ],
          isError: true,
        };
      }
      return {
        structuredContent: { placed: rows.length },
        content: [
          {
            type: "text",
            text: `Placed ${rows.length} pixel${rows.length === 1 ? "" : "s"}.`,
          },
        ],
      };
    },
  );

server.run();

export type AppType = typeof server;
