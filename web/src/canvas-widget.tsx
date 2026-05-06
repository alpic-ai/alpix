import "@/index.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useDisplayMode } from "skybridge/web";
import {
  BoxSelect,
  Maximize2,
  Minimize2,
  Shuffle,
  User,
  X,
} from "lucide-react";
import { Button } from "@alpic-ai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alpic-ai/ui/components/dialog";
import { Input } from "@alpic-ai/ui/components/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@alpic-ai/ui/components/popover";
import { useToolInfo } from "./helpers.js";

const CANVAS_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
const EMPTY_R = 240;
const EMPTY_G = 240;
const EMPTY_B = 240;

type WidgetMeta = {
  supabase: { url: string; anonKey: string };
  palette: string[];
};

type PixelRow = { x: number; y: number; color: number };

type DragStart = { mx: number; my: number; ox: number; oy: number };

type Rect = { x: number; y: number; w: number; h: number };

type Mode = "pan" | "select";

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

const NAME_STORAGE_KEY = "gptwar:user_name";
const NAME_ADJECTIVES = [
  "happy", "sleepy", "clever", "brave", "quiet", "witty", "rapid",
  "lucky", "keen", "jolly", "mellow", "fancy", "grumpy", "silly",
  "spicy", "cosmic", "plucky", "zesty", "glossy", "velvet",
];
const NAME_ANIMALS = [
  "fox", "otter", "koala", "panda", "tiger", "wolf", "heron",
  "badger", "raven", "lynx", "gecko", "newt", "sloth", "ferret",
  "gull", "puffin", "weasel", "stoat", "goose", "ibis",
];

function randomName(): string {
  const a = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const b = NAME_ANIMALS[Math.floor(Math.random() * NAME_ANIMALS.length)];
  const n = Math.floor(Math.random() * 100);
  return `${a}-${b}-${n}`;
}

function loadStoredName(): string | null {
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveStoredName(name: string) {
  try {
    window.localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    /* ignore */
  }
}

export function CanvasWidget() {
  const info = useToolInfo<"canvas">();
  const meta = info.responseMetadata as unknown as WidgetMeta | undefined;
  const [displayMode, setDisplayMode] = useDisplayMode();
  const isFullscreen = displayMode === "fullscreen";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const pixelsRef = useRef<Int16Array>(
    new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1),
  );
  // While the initial fetch is still running, realtime events are buffered
  // here (cell index → color). Replayed onto the fetched buffer at completion
  // so they aren't wiped.
  const fetchBufferRef = useRef<Map<number, number> | null>(null);
  const [live, setLive] = useState(false);
  const [placedCount, setPlacedCount] = useState(0);
  const [outerSize, setOuterSize] = useState({ w: 0, h: 0 });
  // Bumped whenever pixelsRef is bulk-replaced, triggering a full redraw.
  const [snapshotVersion, setSnapshotVersion] = useState(0);

  // Pan + zoom.
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<DragStart | null>(null);

  // Selection mode: drag a rectangle on the canvas to mark where the model
  // should draw. Surfaced to the model via data-llm.
  const [mode, setMode] = useState<Mode>("pan");
  const [selection, setSelection] = useState<Rect | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<Rect | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);

  // Click-to-inspect: click a placed pixel to see who drew it.
  type DrawingMeta = {
    id: number;
    user_name: string | null;
    model_name: string | null;
    tool_name: string;
    pixel_count: number;
    created_at: string;
  };
  const [popover, setPopover] = useState<
    | {
        ax: number;
        ay: number;
        loading: boolean;
        drawing: DrawingMeta | null;
      }
    | null
  >(null);
  // Tracks the client position at pointer-down so we can distinguish a click
  // from a drag.
  const panStart = useRef<{ x: number; y: number } | null>(null);

  // User name. The first time the widget loads, prompt the user to pick a
  // name (autogenerated default). Persisted in localStorage. Surfaced to the
  // model via data-llm so it can pass it back as user_name on tool calls.
  const [userName, setUserName] = useState<string | null>(() => loadStoredName());
  const [nameModalOpen, setNameModalOpen] = useState<boolean>(
    () => loadStoredName() === null,
  );
  const [nameDraft, setNameDraft] = useState<string>(
    () => loadStoredName() ?? randomName(),
  );

  function confirmName() {
    const trimmed = nameDraft.trim().slice(0, 40);
    if (!trimmed) return;
    saveStoredName(trimmed);
    setUserName(trimmed);
    setNameModalOpen(false);
  }

  function openNameModal() {
    setNameDraft(userName ?? randomName());
    setNameModalOpen(true);
  }

  const paletteRgb = useMemo(
    () => (meta?.palette ?? []).map(hexToRgb),
    [meta?.palette],
  );
  const paletteRgbRef = useRef(paletteRgb);
  paletteRgbRef.current = paletteRgb;

  function drawAll() {
    const canvas = canvasRef.current;
    const pal = paletteRgbRef.current;
    if (!canvas || pal.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
    const pixels = pixelsRef.current;
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      const o = i * 4;
      if (c < 0) {
        img.data[o] = EMPTY_R;
        img.data[o + 1] = EMPTY_G;
        img.data[o + 2] = EMPTY_B;
        img.data[o + 3] = 255;
      } else {
        const rgb = pal[c] ?? [0, 0, 0];
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawOne(x: number, y: number, color: number) {
    const canvas = canvasRef.current;
    const pal = paletteRgbRef.current;
    if (!canvas || pal.length === 0) return;
    if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rgb = pal[color] ?? [0, 0, 0];
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Measure outer — base scale = min(w,h) / CANVAS_SIZE at zoom=1.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setOuterSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Paginated fetch so we bypass PostgREST's default 1000-row cap.
  // Buffer realtime events during the fetch so they don't get wiped.
  useEffect(() => {
    if (!meta?.supabase?.url || !meta?.supabase?.anonKey) return;
    let cancelled = false;
    fetchBufferRef.current = new Map();
    const client = createClient(meta.supabase.url, meta.supabase.anonKey, {
      auth: { persistSession: false },
    });

    (async () => {
      const buf = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
      let count = 0;
      const pageSize = 1000;
      let from = 0;
      while (!cancelled) {
        const { data, error } = await client
          .from("pixels")
          .select("x, y, color")
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (error) {
          console.warn("[canvas] fetch failed:", error);
          fetchBufferRef.current = null;
          return;
        }
        const rows = data ?? [];
        for (const row of rows) {
          buf[row.y * CANVAS_SIZE + row.x] = row.color;
          count++;
        }
        if (rows.length === 0 || rows.length < pageSize) break;
        from += pageSize;
      }
      if (cancelled) return;
      // Replay realtime events that landed during the fetch.
      const pending = fetchBufferRef.current;
      if (pending) {
        for (const [cell, color] of pending) {
          if (buf[cell] < 0 && color >= 0) count++;
          buf[cell] = color;
        }
      }
      fetchBufferRef.current = null;
      pixelsRef.current = buf;
      setPlacedCount(count);
      setSnapshotVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
      fetchBufferRef.current = null;
    };
  }, [meta?.supabase?.url, meta?.supabase?.anonKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  useEffect(() => {
    drawAll();
  }, [snapshotVersion, paletteRgb]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore Realtime subscription — other clients' writes + our own confirmations.
  useEffect(() => {
    if (!meta?.supabase?.url || !meta?.supabase?.anonKey) return;
    const client: SupabaseClient = createClient(
      meta.supabase.url,
      meta.supabase.anonKey,
      {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 30 } },
      },
    );
    const channel = client
      .channel("pixels-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pixels" },
        (payload) => {
          const row = (payload.new ?? payload.old) as PixelRow | undefined;
          if (!row) return;
          const idx = row.y * CANVAS_SIZE + row.x;
          const prev = pixelsRef.current[idx];
          pixelsRef.current[idx] = row.color;
          // If a fetch is in flight, stash the event so it survives the
          // buffer replacement at fetch-completion.
          if (fetchBufferRef.current) {
            fetchBufferRef.current.set(idx, row.color);
          }
          if (prev < 0 && row.color >= 0) {
            setPlacedCount((n) => n + 1);
          }
          drawOne(row.x, row.y, row.color);
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });
    return () => {
      client.removeChannel(channel);
    };
  }, [meta?.supabase?.url, meta?.supabase?.anonKey]);

  // Pan + zoom transforms.
  const baseScale =
    outerSize.w > 0 && outerSize.h > 0
      ? Math.min(outerSize.w, outerSize.h) / CANVAS_SIZE
      : 1;
  const totalScale = baseScale * zoom;
  const centerX = (outerSize.w - CANVAS_SIZE * totalScale) / 2;
  const centerY = (outerSize.h - CANVAS_SIZE * totalScale) / 2;

  const wheelStateRef = useRef({
    zoom,
    offset,
    outerSize,
    baseScale,
    centerX,
    centerY,
  });
  wheelStateRef.current = {
    zoom,
    offset,
    outerSize,
    baseScale,
    centerX,
    centerY,
  };

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const s = wheelStateRef.current;
      if (s.outerSize.w === 0 || s.outerSize.h === 0) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let rawDelta = e.deltaY;
      if (e.deltaMode === 1) rawDelta *= 15;
      else if (e.deltaMode === 2) rawDelta *= 100;
      const clamped = Math.max(-80, Math.min(80, rawDelta));
      const factor = Math.exp(-clamped * 0.003);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * factor));
      if (newZoom === s.zoom) return;
      const currentTx = s.centerX + s.offset.x;
      const currentTy = s.centerY + s.offset.y;
      const newBase = s.baseScale * newZoom;
      const newCenterX = (s.outerSize.w - CANVAS_SIZE * newBase) / 2;
      const newCenterY = (s.outerSize.h - CANVAS_SIZE * newBase) / 2;
      const scaleRatio = newZoom / s.zoom;
      const newTx = mx - (mx - currentTx) * scaleRatio;
      const newTy = my - (my - currentTy) * scaleRatio;
      setZoom(newZoom);
      setOffset({ x: newTx - newCenterX, y: newTy - newCenterY });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Map a screen point (relative to outerRef) to canvas pixel coords,
  // clamped to the canvas bounds.
  function screenToCanvas(clientX: number, clientY: number) {
    const el = outerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    const cx = (mx - tx) / totalScale;
    const cy = (my - ty) / totalScale;
    return {
      x: Math.max(0, Math.min(CANVAS_SIZE, cx)),
      y: Math.max(0, Math.min(CANVAS_SIZE, cy)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (mode === "select") {
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      selectionStart.current = { x, y };
      setSelectionDraft({ x: Math.floor(x), y: Math.floor(y), w: 0, h: 0 });
      setSelection(null);
      return;
    }

    panStart.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (mode === "select") {
      const start = selectionStart.current;
      if (!start) return;
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      const x0 = Math.floor(Math.min(start.x, x));
      const y0 = Math.floor(Math.min(start.y, y));
      const x1 = Math.ceil(Math.max(start.x, x));
      const y1 = Math.ceil(Math.max(start.y, y));
      setSelectionDraft({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      return;
    }
    const start = dragStart.current;
    if (!isDragging || !start) return;
    setOffset({
      x: start.ox + (e.clientX - start.mx),
      y: start.oy + (e.clientY - start.my),
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (mode === "select") {
      if (selectionDraft && selectionDraft.w > 0 && selectionDraft.h > 0) {
        setSelection(selectionDraft);
      }
      setSelectionDraft(null);
      selectionStart.current = null;
      return;
    }

    // If pointer barely moved, treat it as a click and try to inspect the
    // pixel under the cursor.
    const start = panStart.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) < 4) {
        handlePixelClick(e.clientX, e.clientY);
      }
    }
    setIsDragging(false);
    dragStart.current = null;
    panStart.current = null;
  }

  async function handlePixelClick(clientX: number, clientY: number) {
    const { x, y } = screenToCanvas(clientX, clientY);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= CANVAS_SIZE || cy >= CANVAS_SIZE) return;
    const idx = cy * CANVAS_SIZE + cx;
    if (pixelsRef.current[idx] < 0) {
      // Empty cell — close any open popover but don't open a new one.
      setPopover(null);
      return;
    }
    const outer = outerRef.current;
    if (!outer || !meta?.supabase?.url || !meta?.supabase?.anonKey) return;
    const r = outer.getBoundingClientRect();
    const ax = clientX - r.left;
    const ay = clientY - r.top;
    setPopover({ ax, ay, loading: true, drawing: null });
    const client = createClient(meta.supabase.url, meta.supabase.anonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await client
      .from("pixels")
      .select(
        "drawing_id, drawings(id, user_name, model_name, tool_name, pixel_count, created_at)",
      )
      .eq("x", cx)
      .eq("y", cy)
      .maybeSingle();
    if (error) {
      console.warn("[canvas] click metadata fetch failed:", error);
    }
    // Supabase types the joined relation as an array even when it's a single
    // FK; in practice it's a single row (or null). Normalize both shapes.
    const raw = (data as unknown as { drawings?: DrawingMeta | DrawingMeta[] | null } | null)
      ?.drawings;
    const drawing: DrawingMeta | null = Array.isArray(raw)
      ? raw[0] ?? null
      : raw ?? null;
    setPopover((p) =>
      p ? { ...p, loading: false, drawing } : p,
    );
  }

  function toggleSelectMode() {
    if (mode === "select") {
      setMode("pan");
      setSelectionDraft(null);
      selectionStart.current = null;
    } else {
      setMode("select");
    }
  }

  function clearSelection() {
    setSelection(null);
    setSelectionDraft(null);
  }

  const tx = centerX + offset.x;
  const ty = centerY + offset.y;
  const measured = outerSize.w > 0 && outerSize.h > 0;
  const ready = !!meta && measured;

  return (
    <div
      className={`canvas-wrap ${isFullscreen ? "fullscreen" : ""}`}
      data-llm={`Pixel canvas ${CANVAS_SIZE}x${CANVAS_SIZE}, ${placedCount} pixels placed${live ? "" : " (connecting)"}.${userName ? ` The user's chosen name is "${userName}" — pass this as user_name on every place-pixels or stamp-grid call.` : ""}${selection ? ` The user selected a target zone: x=${selection.x}, y=${selection.y}, width=${selection.w}, height=${selection.h}. Place the drawing inside this rectangle (top-left at (${selection.x},${selection.y}), bottom-right exclusive at (${selection.x + selection.w},${selection.y + selection.h})).` : ""} Use place-pixels or stamp-grid to draw.`}
    >
      <div
        ref={outerRef}
        className={`canvas-outer ${isDragging ? "dragging" : ""} ${mode === "select" ? "select-mode" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transform: `translate(${tx}px, ${ty}px) scale(${totalScale})`,
            transformOrigin: "0 0",
            opacity: ready ? 1 : 0,
          }}
        />

        {(selection || selectionDraft) &&
          (() => {
            const r = (selectionDraft ?? selection)!;
            return (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-fuchsia-400 bg-fuchsia-400/10"
                style={{
                  left: tx + r.x * totalScale,
                  top: ty + r.y * totalScale,
                  width: r.w * totalScale,
                  height: r.h * totalScale,
                }}
              />
            );
          })()}

        {popover && (
          <Popover
            open
            onOpenChange={(open) => {
              if (!open) setPopover(null);
            }}
          >
            <PopoverAnchor asChild>
              <div
                style={{
                  position: "absolute",
                  left: popover.ax,
                  top: popover.ay,
                  width: 1,
                  height: 1,
                  pointerEvents: "none",
                }}
              />
            </PopoverAnchor>
            <PopoverContent
              side="top"
              align="center"
              sideOffset={8}
              className="w-auto min-w-[200px] max-w-[280px] p-3"
            >
              {popover.loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : popover.drawing ? (
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {popover.drawing.user_name || "anonymous"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    via {popover.drawing.model_name || "unknown model"}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground/80">
                    {formatRelative(popover.drawing.created_at)} ·{" "}
                    {popover.drawing.pixel_count} px ·{" "}
                    {popover.drawing.tool_name}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No drawing data for this pixel.
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        <div className="absolute top-2 right-2 flex gap-1.5">
          <button
            type="button"
            aria-label={mode === "select" ? "Exit select mode" : "Select zone"}
            title={mode === "select" ? "Exit select mode" : "Select zone"}
            aria-pressed={mode === "select"}
            onClick={toggleSelectMode}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border-0 backdrop-blur-sm transition cursor-pointer ${
              mode === "select"
                ? "bg-fuchsia-500/85 text-white opacity-100 hover:bg-fuchsia-500"
                : "bg-black/55 text-white opacity-85 hover:bg-black/70 hover:opacity-100"
            }`}
          >
            <BoxSelect size={16} />
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? "Collapse" : "Fullscreen"}
            title={isFullscreen ? "Collapse" : "Fullscreen"}
            onClick={() =>
              setDisplayMode(isFullscreen ? "inline" : "fullscreen")
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-black/55 text-white opacity-85 backdrop-blur-sm transition hover:bg-black/70 hover:opacity-100 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>

        <div className="absolute top-2 left-2 flex max-w-[60%] items-center gap-1.5">
          {userName && !nameModalOpen && (
            <button
              type="button"
              aria-label="Change name"
              title="Change name"
              onClick={openNameModal}
              className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border-0 bg-black/55 px-2.5 text-xs text-white opacity-85 backdrop-blur-sm transition hover:bg-black/70 hover:opacity-100 cursor-pointer"
            >
              <User size={14} />
              <span className="truncate">{userName}</span>
            </button>
          )}
          {selection && (
            <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-fuchsia-500/85 px-2.5 text-xs text-white backdrop-blur-sm">
              <span className="font-mono">
                {selection.w}×{selection.h} @ {selection.x},{selection.y}
              </span>
              <button
                type="button"
                aria-label="Clear selection"
                title="Clear selection"
                onClick={clearSelection}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border-0 bg-white/25 text-white transition hover:bg-white/40 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={nameModalOpen}
        onOpenChange={(open) => {
          // Block closing the dialog until the user has a name set.
          if (!open && userName) setNameModalOpen(false);
        }}
      >
        <DialogContent
          showCloseButton={!!userName}
          onEscapeKeyDown={(e) => {
            if (!userName) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!userName) e.preventDefault();
          }}
          className="backdrop-blur-md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmName();
            }}
          >
            <DialogHeader>
              <DialogTitle>Pick a name</DialogTitle>
              <DialogDescription>
                Shown next to the drawings you make, and visible to the model.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex items-end gap-2">
              <div className="flex-1">
                <Input
                  autoFocus
                  type="text"
                  value={nameDraft}
                  maxLength={40}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Random name"
                title="Random name"
                onClick={() => setNameDraft(randomName())}
              >
                <Shuffle size={16} />
              </Button>
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="submit"
                variant="primary"
                disabled={!nameDraft.trim()}
              >
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
