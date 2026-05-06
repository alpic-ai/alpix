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

type PixelRow = {
  x: number;
  y: number;
  color: number;
  updated_at: string;
};

const PALETTE_HEX = PALETTE.map((p) => p.hex);

const SUPABASE_HOST = (() => {
  try {
    return new URL(
      getSupabasePublic().url || "https://placeholder.supabase.co",
    ).host;
  } catch {
    return "placeholder.supabase.co";
  }
})();

const csp = {
  ui: {
    csp: {
      connectDomains: [
        `https://${SUPABASE_HOST}`,
        `wss://${SUPABASE_HOST}`,
      ],
      resourceDomains: [] as string[],
    },
  },
};

function widgetMeta() {
  return {
    supabase: getSupabasePublic(),
    palette: PALETTE_HEX,
  };
}

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
      const byKey = new Map<string, PixelRow>();
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
  )
  .registerTool(
    "stamp-grid",
    {
      description:
        `Draw a rectangular sprite by submitting an ASCII grid — the natural way to draw pixel art. ` +
        `Each line of the grid is one row of pixels; each character is one pixel. The grid's width and height set the drawing size. ` +
        `'legend' maps single characters to palette color names. Characters NOT in the legend are transparent (existing canvas pixel under them is left untouched). ` +
        `The top-left of the grid is placed at (x, y) on the canvas. ` +
        `Coordinates: (0,0)=top-left, (${CANVAS_SIZE - 1},${CANVAS_SIZE - 1})=bottom-right. ` +
        `Available colors (32): ${COLOR_NAMES.join(", ")}. ` +
        `Prefer this tool over place-pixels for any shape larger than a few pixels — spatial structure is preserved in the grid string, so the drawing comes out as it looks. ` +
        `All rows in the grid must be the same length. Max ${MAX_BATCH} placed (non-transparent) pixels per call. ` +
        `Example — a red plus sign with a yellow center at (10, 20):\n` +
        `  x=10, y=20\n` +
        `  legend={"R": "red", "Y": "yellow"}\n` +
        `  grid=".R.\\nRYR\\n.R."\n` +
        `  (the '.' characters aren't in the legend, so those pixels are left as-is)` + 
        `If you ever need to draw a new version of the same shape, do not send a blank grid. Instead just draw above the existing shape.`,
      inputSchema: {
        x: z
          .number()
          .int()
          .min(0)
          .max(CANVAS_SIZE - 1)
          .describe("Column on the canvas where the top-left of the grid is placed."),
        y: z
          .number()
          .int()
          .min(0)
          .max(CANVAS_SIZE - 1)
          .describe("Row on the canvas where the top-left of the grid is placed."),
        grid: z
          .string()
          .min(1)
          .describe(
            "Multi-line ASCII grid. Each line is one row of pixels; each character is one pixel. All rows must be the same length. Use newline ('\\n') between rows.",
          ),
        legend: z
          .record(
            z.string(),
            z.enum([...COLOR_NAMES] as [ColorName, ...ColorName[]]),
          )
          .describe(
            "Map from single-character keys to palette color names, e.g. {\"R\": \"red\", \"B\": \"blue\"}. Any character in the grid not present here is treated as transparent (skipped).",
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
    },
    async ({ x, y, grid, legend }) => {
      for (const key of Object.keys(legend)) {
        if (key.length !== 1) {
          return {
            content: [
              {
                type: "text",
                text: `Legend key ${JSON.stringify(key)} must be exactly one character.`,
              },
            ],
            isError: true,
          };
        }
      }

      const lines = grid.split("\n");
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const height = lines.length;
      const width = lines[0]?.length ?? 0;
      if (height === 0 || width === 0) {
        return {
          content: [{ type: "text", text: "Grid is empty." }],
          isError: true,
        };
      }
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length !== width) {
          return {
            content: [
              {
                type: "text",
                text: `Row ${i} has length ${lines[i].length}, expected ${width}. All rows must be the same length.`,
              },
            ],
            isError: true,
          };
        }
      }
      if (x + width > CANVAS_SIZE || y + height > CANVAS_SIZE) {
        return {
          content: [
            {
              type: "text",
              text: `Grid (${width}x${height}) at (${x},${y}) would extend past the ${CANVAS_SIZE}x${CANVAS_SIZE} canvas. Reduce size or move the origin closer to (0,0).`,
            },
          ],
          isError: true,
        };
      }

      const now = new Date().toISOString();
      const byKey = new Map<string, PixelRow>();
      let skipped = 0;
      for (let row = 0; row < height; row++) {
        const line = lines[row];
        for (let col = 0; col < width; col++) {
          const ch = line[col];
          const colorName = (legend as Record<string, ColorName>)[ch];
          if (!colorName) {
            skipped++;
            continue;
          }
          const px = x + col;
          const py = y + row;
          byKey.set(`${px},${py}`, {
            x: px,
            y: py,
            color: COLOR_INDEX[colorName],
            updated_at: now,
          });
        }
      }

      const rows = [...byKey.values()];
      if (rows.length > MAX_BATCH) {
        return {
          content: [
            {
              type: "text",
              text: `Stamp would place ${rows.length} pixels, exceeding the ${MAX_BATCH} limit per call. Split the drawing into smaller stamps.`,
            },
          ],
          isError: true,
        };
      }
      if (rows.length === 0) {
        return {
          structuredContent: { placed: 0, skipped, width, height },
          content: [
            {
              type: "text",
              text: `No pixels placed — all ${skipped} cells were transparent (no legend match).`,
            },
          ],
        };
      }

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
        structuredContent: { placed: rows.length, skipped, width, height },
        content: [
          {
            type: "text",
            text: `Stamped ${width}x${height} grid at (${x},${y}): placed ${rows.length} pixel${rows.length === 1 ? "" : "s"}, ${skipped} transparent.`,
          },
        ],
      };
    },
  );

server.run();

export type AppType = typeof server;
