import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANVAS_SIZE,
  COLOR_INDEX,
  COLOR_NAMES,
  type ColorName,
} from "./palette.js";
import {
  MAX_PIXEL_BATCH,
  PIXEL_BATCH_EVENT,
  PIXELS_CHANNEL,
  type PixelBatchPayload,
} from "./realtime.js";

export type Rect = { x: number; y: number; w: number; h: number };

/** Clamp a drawing zone onto the canvas and cap its area to the per-stamp budget. */
export function normalizeDrawingZone(
  input: { x: number; y: number; width: number; height: number },
  options?: { maxArea?: number },
): { ok: true; rect: Rect } | { ok: false; error: string } {
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height)
  ) {
    return { ok: false, error: "Zone coordinates must be finite numbers." };
  }

  let x = Math.trunc(input.x);
  let y = Math.trunc(input.y);
  let w = Math.trunc(input.width);
  let h = Math.trunc(input.height);
  const maxArea = options?.maxArea ?? MAX_PIXEL_BATCH;

  if (w < 1 || h < 1) {
    return { ok: false, error: "Zone width and height must be at least 1." };
  }

  if (x >= CANVAS_SIZE || y >= CANVAS_SIZE || x + w <= 0 || y + h <= 0) {
    return {
      ok: false,
      error: `Zone is outside the ${CANVAS_SIZE}x${CANVAS_SIZE} canvas.`,
    };
  }

  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  w = Math.min(w, CANVAS_SIZE - x);
  h = Math.min(h, CANVAS_SIZE - y);
  if (w < 1 || h < 1) {
    return {
      ok: false,
      error: `Zone is outside the ${CANVAS_SIZE}x${CANVAS_SIZE} canvas.`,
    };
  }

  if (w * h > maxArea) {
    const factor = Math.sqrt(maxArea / (w * h));
    w = Math.max(1, Math.floor(w * factor));
    h = Math.max(1, Math.floor(maxArea / w));
  }

  return { ok: true, rect: { x, y, w, h } };
}

export type StampGridInput = {
  x: number;
  y: number;
  grid: string;
  legend: Record<string, string>;
  user_name?: string;
  model_name?: string;
};

export type PixelRow = {
  x: number;
  y: number;
  color: number;
  updated_at: string;
};

export type StampGridResult =
  | {
      ok: true;
      placed: number;
      skipped: number;
      width: number;
      height: number;
      drawing_id?: number;
    }
  | { ok: false; error: string };

export type RecordDrawingResult =
  | { ok: true; drawingId: number; placed: number }
  | { ok: false; error: string };

async function getCurrentCanvasId(client: SupabaseClient): Promise<number> {
  const { data } = await client
    .from("canvases")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  return (data as { id: number } | null)?.id ?? 1;
}

export function parseAndValidateStamp(
  input: Pick<StampGridInput, "x" | "y" | "grid" | "legend">,
  options?: { selection?: Rect | null; maxBatch?: number },
):
  | { ok: true; rows: PixelRow[]; skipped: number; width: number; height: number }
  | { ok: false; error: string } {
  const { x, y, grid, legend } = input;
  const maxBatch = options?.maxBatch ?? MAX_PIXEL_BATCH;
  const selection = options?.selection ?? null;

  for (const key of Object.keys(legend)) {
    if (key.length !== 1) {
      return {
        ok: false,
        error: `Legend key ${JSON.stringify(key)} must be exactly one character.`,
      };
    }
  }

  const lines = grid.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));
  if (height === 0 || width === 0) {
    return { ok: false, error: "Grid is empty." };
  }
  if (x + width > CANVAS_SIZE || y + height > CANVAS_SIZE) {
    return {
      ok: false,
      error: `Grid (${width}x${height}) at (${x},${y}) would extend past the ${CANVAS_SIZE}x${CANVAS_SIZE} canvas. Reduce size or move the origin closer to (0,0).`,
    };
  }

  if (selection) {
    const stampRight = x + width;
    const stampBottom = y + height;
    const selRight = selection.x + selection.w;
    const selBottom = selection.y + selection.h;
    if (
      x < selection.x ||
      y < selection.y ||
      stampRight > selRight ||
      stampBottom > selBottom
    ) {
      return {
        ok: false,
        error: `Stamp (${width}x${height}) at (${x},${y}) is not fully inside the selected zone (x=${selection.x}, y=${selection.y}, width=${selection.w}, height=${selection.h}).`,
      };
    }
  }

  const now = new Date().toISOString();
  const byKey = new Map<string, PixelRow>();
  let skipped = 0;
  for (let row = 0; row < height; row++) {
    const line = lines[row];
    for (let col = 0; col < width; col++) {
      const ch = line[col];
      const colorName = legend[ch] as ColorName | undefined;
      if (!colorName || !COLOR_NAMES.includes(colorName)) {
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
  if (rows.length > maxBatch) {
    return {
      ok: false,
      error: `Stamp would place ${rows.length} pixels, exceeding the ${maxBatch} limit per call. Split the drawing into smaller stamps.`,
    };
  }

  return { ok: true, rows, skipped, width, height };
}

export async function broadcastDrawing(
  client: SupabaseClient,
  drawingId: number,
  rows: PixelRow[],
): Promise<boolean> {
  const channel = client.channel(PIXELS_CHANNEL);
  const payload: PixelBatchPayload = {
    drawingId,
    pixels: rows.map(({ x, y, color }) => [x, y, color]),
  };

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await channel.httpSend(PIXEL_BATCH_EVENT, payload, {
          timeout: 3000,
        });
        if (!result.success) {
          throw new Error(`Broadcast failed with status ${result.status}.`);
        }
        return true;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  } catch (error) {
    console.warn(
      `[canvas] Drawing #${drawingId} was persisted but its Realtime batch could not be broadcast.`,
      error,
    );
  } finally {
    try {
      await client.removeChannel(channel);
    } catch (error) {
      console.warn("[canvas] Failed to clean up Broadcast channel.", error);
    }
  }

  return false;
}

export async function recordDrawing(
  client: SupabaseClient,
  rows: PixelRow[],
  userName: string | undefined,
  modelName: string | undefined,
  toolName: string,
): Promise<RecordDrawingResult> {
  const canvasId = await getCurrentCanvasId(client);
  const { data: drawing, error: drawingErr } = await client
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
  const { error: placementErr } = await client
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
  const { error: pixelErr } = await client
    .from("pixels")
    .upsert(projectionRows, { onConflict: "x,y" });
  if (pixelErr) return { ok: false, error: pixelErr.message };

  await broadcastDrawing(client, drawingId, rows);

  return { ok: true, drawingId, placed: rows.length };
}

export async function stampGrid(
  client: SupabaseClient,
  input: StampGridInput,
  options?: { selection?: Rect | null; maxBatch?: number },
): Promise<StampGridResult> {
  const modelName = input.model_name
    ? input.model_name.trim().toLowerCase().replace(/[\s_]+/g, "-")
    : undefined;

  const parsed = parseAndValidateStamp(input, options);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const { rows, skipped, width, height } = parsed;
  if (rows.length === 0) {
    return { ok: true, placed: 0, skipped, width, height };
  }

  const result = await recordDrawing(
    client,
    rows,
    input.user_name,
    modelName,
    "stamp-grid",
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    placed: result.placed,
    skipped,
    width,
    height,
    drawing_id: result.drawingId,
  };
}
