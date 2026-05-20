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

const MAX_BATCH = 4096;

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

async function getCurrentCanvasId(): Promise<number> {
  const { data } = await getSupabase()
    .from("canvases")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  return (data as { id: number } | null)?.id ?? 1;
}

function widgetMeta() {
  return {
    supabase: getSupabasePublic(),
    palette: PALETTE_HEX,
    maxBatch: MAX_BATCH,
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

type DrawingResult =
  | { ok: true; drawingId: number; placed: number }
  | { ok: false; error: string };

// Append a drawing event + its placements, then update the projection.
// Three sequential writes (no transaction): on partial failure the event log
// may have an orphan drawings/placements row, but the projection stays
// internally consistent because the pixel upsert is the last step.
async function recordDrawing(
  rows: PixelRow[],
  userName: string | undefined,
  modelName: string | undefined,
  toolName: string,
): Promise<DrawingResult> {
  const supa = getSupabase();
  const canvasId = await getCurrentCanvasId();
  const { data: drawing, error: drawingErr } = await supa
    .from("drawings")
    .insert({
      user_name: userName ?? null,
      model_name: modelName ?? null,
      tool_name: toolName,
      pixel_count: rows.length,
      canvas_id: canvasId,
    })
    .select("id")
    .single();
  if (drawingErr || !drawing) {
    return {
      ok: false,
      error: drawingErr?.message ?? "drawings insert returned no row",
    };
  }
  const drawingId = drawing.id as number;

  const placementRows = rows.map((r) => ({
    drawing_id: drawingId,
    x: r.x,
    y: r.y,
    color: r.color,
  }));
  const { error: placementErr } = await supa
    .from("placements")
    .insert(placementRows);
  if (placementErr) return { ok: false, error: placementErr.message };

  const projectionRows = rows.map((r) => ({
    x: r.x,
    y: r.y,
    color: r.color,
    drawing_id: drawingId,
    updated_at: r.updated_at,
  }));
  const { error: pixelErr } = await supa
    .from("pixels")
    .upsert(projectionRows, { onConflict: "x,y" });
  if (pixelErr) return { ok: false, error: pixelErr.message };

  return { ok: true, drawingId, placed: rows.length };
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
        "Open the live shared pixel canvas. Call this first to show the canvas to the user before placing pixels with stamp-grid.",
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
            text: `Canvas opened (${CANVAS_SIZE}x${CANVAS_SIZE}, ${placed} pixels placed). Use stamp-grid to draw.`,
          },
        ],
        _meta: widgetMeta(),
      };
    },
  )
  .registerTool(
    "stamp-grid",
    {
      description:
        `Draw a rectangular sprite on the shared ${CANVAS_SIZE}x${CANVAS_SIZE} canvas by submitting an ASCII grid — the natural way to draw pixel art. ` +
        `Each line of the grid is one row of pixels; each character is one pixel. The grid's width and height set the drawing size. ` +
        `'legend' maps single characters to palette color names. Characters NOT in the legend are transparent (existing canvas pixel under them is left untouched). ` +
        `The top-left of the grid is placed at (x, y) on the canvas. ` +
        `Coordinates: (0,0)=top-left, (${CANVAS_SIZE - 1},${CANVAS_SIZE - 1})=bottom-right. ` +
        `Available colors (32): ${COLOR_NAMES.join(", ")}. ` +
        `Spatial structure is preserved in the grid string, so the drawing comes out as it looks. ` +
        `Max ${MAX_BATCH} placed (non-transparent) pixels per call — for larger drawings, split into several adjacent stamp-grid calls. ` +
        `Example — a red plus sign with a yellow center at (10, 20):\n` +
        `  x=10, y=20\n` +
        `  legend={"R": "red", "Y": "yellow"}\n` +
        `  grid=".R.\\nRYR\\n.R."\n` +
        `  (the '.' characters aren't in the legend, so those pixels are left as-is)` +
        `If you ever need to draw a new version of the same shape, do not send a blank grid. Instead just draw above the existing shape. ` +
        `Always pass user_name (read from the canvas widget — the name the user picked) and model_name (your own model identifier, lowercase hyphen-separated, e.g. 'gpt-4o', 'claude-opus-4-7'). These are recorded so other users can see who drew it.`,
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
            "Multi-line ASCII grid. Each line is one row of pixels; each character is one pixel. Use newline ('\\n') between rows.",
          ),
        legend: z
          .record(
            z.string(),
            z.enum([...COLOR_NAMES] as [ColorName, ...ColorName[]]),
          )
          .describe(
            "Map from single-character keys to palette color names, e.g. {\"R\": \"red\", \"B\": \"blue\"}. Any character in the grid not present here is treated as transparent (skipped).",
          ),
        user_name: z
          .string()
          .optional()
          .describe(
            "The user's chosen name (read it from the canvas widget). Used for attribution.",
          ),
        model_name: z
          .string()
          .optional()
          .describe(
            "Your model identifier. Use lowercase words separated by hyphens, followed by the version number — e.g. 'gpt-4o', 'claude-opus-4-7', 'gemini-2-5-pro'. Used for attribution.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
    },
    async ({ x, y, grid, legend, user_name, model_name: rawModelName }) => {
      const model_name = rawModelName
        ? rawModelName.trim().toLowerCase().replace(/[\s_]+/g, "-")
        : undefined;
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
      const width = Math.max(...lines.map((l) => l.length));
      if (height === 0 || width === 0) {
        return {
          content: [{ type: "text", text: "Grid is empty." }],
          isError: true,
        };
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

      const result = await recordDrawing(
        rows,
        user_name,
        model_name,
        "stamp-grid",
      );
      if (!result.ok) {
        return {
          content: [
            { type: "text", text: `Failed to place pixels: ${result.error}` },
          ],
          isError: true,
        };
      }
      return {
        structuredContent: {
          placed: result.placed,
          skipped,
          width,
          height,
          drawing_id: result.drawingId,
        },
        content: [
          {
            type: "text",
            text: `Stamped ${width}x${height} grid at (${x},${y}): placed ${result.placed} pixel${result.placed === 1 ? "" : "s"}, ${skipped} transparent (drawing #${result.drawingId}).`,
          },
        ],
      };
    },
  )
  .registerTool(
    "get-leaderboard",
    {
      description: "Fetch the pixel leaderboard for the current canvas — a ranked list of AI models by total pixels placed.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async () => {
      const canvasId = await getCurrentCanvasId();
      const { data, error } = await getSupabase()
        .from("drawings")
        .select("model_name, pixel_count")
        .eq("canvas_id", canvasId)
        .not("model_name", "is", null);

      if (error) {
        return {
          content: [{ type: "text", text: `Failed to fetch leaderboard: ${error.message}` }],
          isError: true,
        };
      }

      const totals = new Map<string, number>();
      for (const row of data as { model_name: string; pixel_count: number }[]) {
        totals.set(row.model_name, (totals.get(row.model_name) ?? 0) + row.pixel_count);
      }
      const ranked = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model_name, pixels], i) => ({ rank: i + 1, model_name, pixels }));

      const text = ranked.length === 0
        ? "No drawings on the current canvas yet."
        : ranked.map(e => `${e.rank}. ${e.model_name} — ${e.pixels.toLocaleString()} px`).join("\n");

      return {
        structuredContent: { leaderboard: ranked },
        content: [{ type: "text", text }],
      };
    },
  );

server.run();

export type AppType = typeof server;
