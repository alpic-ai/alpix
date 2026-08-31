import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { createClient } from "@supabase/supabase-js";
import { WebMCPProvider, useMcpTool } from "webmcp-react";
import { z } from "zod";
import { BoxSelect, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@alpic-ai/ui/components/alert";
import { Badge } from "@alpic-ai/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@alpic-ai/ui/components/card";
import { Separator } from "@alpic-ai/ui/components/separator";
import { Tag } from "@alpic-ai/ui/components/tag";
import { H1 } from "@alpic-ai/ui/components/typography";
import {
  CANVAS_SIZE,
  COLOR_NAMES,
  MAX_PIXEL_BATCH,
  PALETTE_HEX,
  PixelCanvas,
  normalizeDrawingZone,
  stampGrid,
  type PixelCanvasHandle,
  type Rect,
} from "@alpix/component";

function requireEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  const value = import.meta.env[name];
  if (!value || typeof value !== "string") {
    throw new Error(
      `Missing ${name}. Set it in app/web/.env for local dev or Netlify env for deploy.`,
    );
  }
  return value;
}

const supabaseUrl = requireEnv("VITE_SUPABASE_URL");
const supabaseAnonKey = requireEnv("VITE_SUPABASE_ANON_KEY");

const config = {
  supabase: { url: supabaseUrl, anonKey: supabaseAnonKey },
  palette: PALETTE_HEX,
  maxBatch: MAX_PIXEL_BATCH,
};

type ToolStatus =
  | { kind: "idle" }
  | { kind: "pending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function SelectZoneTool({
  canvasRef,
  onStatus,
}: {
  canvasRef: RefObject<PixelCanvasHandle | null>;
  onStatus: (status: ToolStatus) => void;
}) {
  useMcpTool({
    name: "select-zone",
    title: "Select drawing zone",
    description:
      `Mark (or clear) the rectangle on the shared ${CANVAS_SIZE}x${CANVAS_SIZE} canvas where stamp-grid drawings must fit. ` +
      `Humans can also drag this zone in select mode; this tool is the agent equivalent. ` +
      `Coordinates: (0,0)=top-left. The zone is clamped to the canvas and capped at ${MAX_PIXEL_BATCH} cells (the per-stamp pixel budget). ` +
      `Pass clear=true to remove the zone so stamps may land anywhere.`,
    input: z.object({
      x: z
        .number()
        .int()
        .min(0)
        .max(CANVAS_SIZE - 1)
        .optional()
        .describe("Left column of the zone. Required unless clear is true."),
      y: z
        .number()
        .int()
        .min(0)
        .max(CANVAS_SIZE - 1)
        .optional()
        .describe("Top row of the zone. Required unless clear is true."),
      width: z
        .number()
        .int()
        .min(1)
        .max(CANVAS_SIZE)
        .optional()
        .describe("Zone width in pixels. Required unless clear is true."),
      height: z
        .number()
        .int()
        .min(1)
        .max(CANVAS_SIZE)
        .optional()
        .describe("Zone height in pixels. Required unless clear is true."),
      clear: z
        .boolean()
        .optional()
        .describe("If true, clear the drawing zone. Other fields are ignored."),
    }),
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    handler: async ({ x, y, width, height, clear }) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Canvas is not ready yet. Retry in a moment.");
      }

      if (clear) {
        canvas.applySelection(null);
        onStatus({ kind: "success", message: "Drawing zone cleared." });
        return {
          content: [
            { type: "text" as const, text: "Drawing zone cleared. stamp-grid may now place anywhere on the canvas." },
          ],
          structuredContent: { cleared: true, selection: null },
        };
      }

      if (
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
      ) {
        throw new Error(
          "Provide x, y, width, and height, or pass clear=true to remove the zone.",
        );
      }

      const normalized = normalizeDrawingZone(
        { x, y, width, height },
        { maxArea: MAX_PIXEL_BATCH },
      );
      if (!normalized.ok) {
        onStatus({ kind: "error", message: normalized.error });
        throw new Error(normalized.error);
      }

      const { rect } = normalized;
      canvas.applySelection(rect);
      const message = `Zone set to ${rect.w}×${rect.h} at (${rect.x},${rect.y}). stamp-grid drawings must fit fully inside this rectangle.`;
      onStatus({ kind: "success", message });
      return {
        content: [{ type: "text" as const, text: message }],
        structuredContent: {
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          area: rect.w * rect.h,
        },
      };
    },
  });

  return null;
}

function StampGridTool({
  selection,
  userName,
  onStatus,
}: {
  selection: Rect | null;
  userName: string | null;
  onStatus: (status: ToolStatus) => void;
}) {
  const selectionRef = useRef(selection);
  const userNameRef = useRef(userName);
  selectionRef.current = selection;
  userNameRef.current = userName;

  const description = useMemo(() => {
    const zone = selection
      ? ` A drawing zone is active: x=${selection.x}, y=${selection.y}, width=${selection.w}, height=${selection.h}. Place the drawing fully inside this rectangle. Use select-zone to change or clear it.`
      : "";
    return (
      `Draw a rectangular sprite on the shared ${CANVAS_SIZE}x${CANVAS_SIZE} AlpiX pixel canvas by submitting an ASCII grid. ` +
      `Each line is one row; each character is one pixel. 'legend' maps single characters to palette color names; characters not in the legend are transparent. ` +
      `Top-left of the grid is placed at (x, y). Coordinates: (0,0)=top-left. ` +
      `Available colors: ${COLOR_NAMES.join(", ")}. ` +
      `Max ${MAX_PIXEL_BATCH} non-transparent pixels per call.` +
      zone +
      ` Pass model_name as your model id (lowercase hyphen-separated). The page supplies the viewer's display name automatically.`
    );
  }, [selection]);

  useMcpTool({
    name: "stamp-grid",
    title: "Stamp pixel grid",
    description,
    input: z.object({
      x: z
        .number()
        .int()
        .min(0)
        .max(CANVAS_SIZE - 1)
        .describe("Column where the top-left of the grid is placed."),
      y: z
        .number()
        .int()
        .min(0)
        .max(CANVAS_SIZE - 1)
        .describe("Row where the top-left of the grid is placed."),
      grid: z
        .string()
        .min(1)
        .describe(
          "Multi-line ASCII grid. Use newline between rows. Characters not in legend are transparent.",
        ),
      legend: z
        .record(z.string(), z.enum(COLOR_NAMES as unknown as [string, ...string[]]))
        .describe(
          'Map from single-character keys to palette color names, e.g. {"R":"red","Y":"yellow"}.',
        ),
      model_name: z
        .string()
        .describe(
          "Your model identifier, lowercase hyphen-separated (e.g. gpt-4o, claude-opus-4-7).",
        ),
    }),
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    handler: async ({ x, y, grid, legend, model_name }) => {
      const name = userNameRef.current;
      if (!name) {
        throw new Error(
          "Internal error: stamp-grid registered without a display name.",
        );
      }

      onStatus({ kind: "pending", message: "Stamping pixels…" });
      const client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      });
      const result = await stampGrid(
        client,
        {
          x,
          y,
          grid,
          legend,
          user_name: name,
          model_name,
        },
        {
          selection: selectionRef.current,
          maxBatch: MAX_PIXEL_BATCH,
        },
      );

      if (!result.ok) {
        onStatus({ kind: "error", message: result.error });
        throw new Error(result.error);
      }

      const message =
        result.placed === 0
          ? `No pixels placed — all ${result.skipped} cells were transparent.`
          : `Stamped ${result.width}x${result.height} at (${x},${y}): ${result.placed} pixels (drawing #${result.drawing_id}).`;
      onStatus({ kind: "success", message });
      return {
        content: [{ type: "text" as const, text: message }],
        structuredContent: {
          placed: result.placed,
          skipped: result.skipped,
          width: result.width,
          height: result.height,
          drawing_id: result.drawing_id,
        },
      };
    },
  });

  return null;
}

function statusAlertVariant(
  kind: ToolStatus["kind"],
): "default" | "success" | "destructive" | undefined {
  if (kind === "success") return "success";
  if (kind === "error") return "destructive";
  return "default";
}

function CanvasApp() {
  const canvasRef = useRef<PixelCanvasHandle>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [status, setStatus] = useState<ToolStatus>({ kind: "idle" });

  const onSelectionChange = useCallback((next: Rect | null) => {
    setSelection(next);
  }, []);

  const onUserNameChange = useCallback((next: string | null) => {
    setUserName(next);
  }, []);

  return (
    <div className="app-backdrop text-foreground min-h-dvh">
      <div className="mx-auto flex h-dvh max-w-6xl flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <H1 className="type-display-xs">AlpiX</H1>
            <p className="type-text-sm text-muted-foreground max-w-xl">
              Shared 256×256 canvas — pick a zone, then let a browsing agent stamp
              pixel art through WebMCP.
            </p>
          </div>
          <Badge variant="primary" size="md">
            <Sparkles className="size-3" />
            {userName
              ? "WebMCP · select-zone · stamp-grid"
              : "WebMCP · set-display-name · select-zone"}
          </Badge>
        </header>

        <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0 shadow-sm">
          <CardHeader className="border-border-secondary gap-3 border-b py-4">
            <CardTitle>Live canvas</CardTitle>
            <CardDescription>
              Pan and zoom freely. Drag a zone in select mode, or let an agent call
              select-zone; stamps outside that rectangle are rejected.
            </CardDescription>
            <CardAction className="flex flex-wrap items-center justify-end gap-2">
              {!userName && (
                <Badge variant="warning" size="sm">
                  Name required
                </Badge>
              )}
              {selection ? (
                <Tag icon={<BoxSelect className="size-3.5" />}>
                  {selection.w}×{selection.h} @ ({selection.x},{selection.y})
                </Tag>
              ) : (
                <Badge variant="secondary" size="sm">
                  No zone selected
                </Badge>
              )}
            </CardAction>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 p-0">
            <SelectZoneTool canvasRef={canvasRef} onStatus={setStatus} />
            {userName ? (
              <StampGridTool
                selection={selection}
                userName={userName}
                onStatus={setStatus}
              />
            ) : null}
            <PixelCanvas
              ref={canvasRef}
              config={config}
              className="app-canvas"
              displayMode="inline"
              showDisplayModeControls={false}
              onSelectionChange={onSelectionChange}
              onUserNameChange={onUserNameChange}
            />
          </CardContent>

          {status.kind !== "idle" && (
            <>
              <Separator />
              <CardFooter className="py-4">
                <Alert variant={statusAlertVariant(status.kind)} className="w-full">
                  <AlertTitle>
                    {status.kind === "pending"
                      ? "Agent working"
                      : status.kind === "success"
                        ? "Done"
                        : "Tool failed"}
                  </AlertTitle>
                  <AlertDescription>{status.message}</AlertDescription>
                </Alert>
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export function App() {
  return (
    <WebMCPProvider name="alpix" version="0.1.0">
      <CanvasApp />
    </WebMCPProvider>
  );
}
