import "dotenv/config";
import { LuluAds } from "lulu-ads";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  CANVAS_SIZE,
  COLOR_NAMES,
  MAX_PIXEL_BATCH,
  PALETTE_HEX,
  stampGrid,
} from "@alpix/component";
import { getSupabase, getSupabasePublic } from "./supabase.js";

const MAX_BATCH = MAX_PIXEL_BATCH;
const LULU_ADS_ORIGIN = "https://ads.getlulu.dev";

const ads = new LuluAds({
  publisherId: process.env.LULU_ADS_PUBLISHER_ID,
  apiKey:
    process.env.LULU_ADS_PUBLISHER_KEY ?? process.env.LULU_ADS_API_KEY,
});
void ads.warmUp();

const SUPABASE_HOST = (() => {
  try {
    return new URL(
      getSupabasePublic().url || "https://placeholder.supabase.co",
    ).host;
  } catch {
    return "placeholder.supabase.co";
  }
})();

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

async function getCurrentCanvasId(): Promise<number> {
  const { data } = await getSupabase()
    .from("canvases")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  return (data as { id: number } | null)?.id ?? 1;
}

const server = new McpServer(
  { name: "gpt-war", version: "0.0.1" },
  { capabilities: {} },
  { skills: true },
)
  .registerTool(
    {
      name: "canvas",
      description:
        "Open the live shared pixel canvas. Call this first to show the canvas to the user before placing pixels with stamp-grid.",
      inputSchema: {},
      outputSchema: {
        size: z.number().int().describe("Canvas width/height in pixels."),
        placedCount: z
          .number()
          .int()
          .describe("Total pixels currently placed on the canvas."),
        sponsored: z
          .object({
            label: z.literal("Sponsored"),
            text: z.string(),
            url: z.string().url(),
            logoUrl: z.string().url().optional(),
            impUrl: z.string().url().optional(),
          })
          .optional()
          .describe("Disclosed Lulu Ads slot, when a campaign matches."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
      view: {
        component: "canvas",
        description: "Live shared pixel canvas",
        csp: {
          connectDomains: [
            `https://${SUPABASE_HOST}`,
            `wss://${SUPABASE_HOST}`,
            LULU_ADS_ORIGIN,
          ],
          resourceDomains: [LULU_ADS_ORIGIN],
          redirectDomains: [LULU_ADS_ORIGIN],
        },
      },
    },
    async () => {
      const [placed, sponsored] = await Promise.all([
        placedCount(),
        ads.sponsoredSlot({
          context: { tool: "canvas", category: "creative.pixel-art" },
        }),
      ]);
      return {
        structuredContent: {
          size: CANVAS_SIZE,
          placedCount: placed,
          ...(sponsored ? { sponsored } : {}),
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
    {
      name: "stamp-grid",
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
          .record(z.string(), z.enum([...COLOR_NAMES]))
          .describe(
            'Map from single-character keys to palette color names, e.g. {"R": "red", "B": "blue"}. Any character in the grid not present here is treated as transparent (skipped).',
          ),
        user_name: z
          .string()
          .describe(
            "The user's chosen name (read it from the canvas widget). Used for attribution.",
          ),
        model_name: z
          .string()
          .describe(
            "Your model identifier. Use lowercase words separated by hyphens, followed by the version number — e.g. 'gpt-4o', 'claude-opus-4-7', 'gemini-2-5-pro'. Used for attribution.",
          ),
      },
      outputSchema: {
        placed: z.number().int().describe("Non-transparent pixels written."),
        skipped: z
          .number()
          .int()
          .describe("Transparent cells skipped (no legend match)."),
        width: z.number().int().describe("Grid width in pixels."),
        height: z.number().int().describe("Grid height in pixels."),
        drawing_id: z
          .number()
          .int()
          .optional()
          .describe("ID of the recorded drawing (absent when nothing was placed)."),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
    },
    async ({ x, y, grid, legend, user_name, model_name }) => {
      const result = await stampGrid(
        getSupabase(),
        { x, y, grid, legend, user_name, model_name },
        { maxBatch: MAX_BATCH },
      );
      if (!result.ok) {
        return {
          content: [{ type: "text", text: result.error }],
          isError: true,
        };
      }
      if (result.placed === 0) {
        return {
          structuredContent: {
            placed: 0,
            skipped: result.skipped,
            width: result.width,
            height: result.height,
          },
          content: [
            {
              type: "text",
              text: `No pixels placed — all ${result.skipped} cells were transparent (no legend match).`,
            },
          ],
        };
      }
      return {
        structuredContent: {
          placed: result.placed,
          skipped: result.skipped,
          width: result.width,
          height: result.height,
          drawing_id: result.drawing_id,
        },
        content: [
          {
            type: "text",
            text: `Stamped ${result.width}x${result.height} grid at (${x},${y}): placed ${result.placed} pixel${result.placed === 1 ? "" : "s"}, ${result.skipped} transparent (drawing #${result.drawing_id}).`,
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "get-leaderboard",
      description:
        "Fetch the pixel leaderboard for the current canvas — a ranked list of AI models by total pixels placed.",
      inputSchema: {},
      outputSchema: {
        leaderboard: z
          .array(
            z.object({
              rank: z.number().int(),
              model_name: z.string(),
              pixels: z.number().int(),
            }),
          )
          .describe("Models ranked by total pixels placed, descending."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
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
          content: [
            {
              type: "text",
              text: `Failed to fetch leaderboard: ${error.message}`,
            },
          ],
          isError: true,
        };
      }

      const totals = new Map<string, number>();
      for (const row of data as { model_name: string; pixel_count: number }[]) {
        totals.set(
          row.model_name,
          (totals.get(row.model_name) ?? 0) + row.pixel_count,
        );
      }
      const ranked = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model_name, pixels], i) => ({
          rank: i + 1,
          model_name,
          pixels,
        }));

      const text =
        ranked.length === 0
          ? "No drawings on the current canvas yet."
          : ranked
              .map(
                (e) =>
                  `${e.rank}. ${e.model_name} — ${e.pixels.toLocaleString()} px`,
              )
              .join("\n");

      return {
        structuredContent: { leaderboard: ranked },
        content: [{ type: "text", text }],
      };
    },
  );

export default await server.run();

export type AppType = typeof server;
