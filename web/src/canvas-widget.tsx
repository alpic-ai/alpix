import "@/index.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useDisplayMode } from "skybridge/web";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  BoxSelect,
  Maximize2,
  Minimize2,
  Shuffle,
  Trophy,
  User,
  Users,
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
  PopoverTrigger,
} from "@alpic-ai/ui/components/popover";
import { Arrow as PopoverArrow } from "@radix-ui/react-popover";
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
  // Max pixels the model can place in a single tool call. The selection zone
  // can't exceed this area, otherwise the model wouldn't be able to fill it.
  maxBatch?: number;
};

type PixelRow = { x: number; y: number; color: number; drawing_id?: number | null };

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
  // Per-cell drawing_id (−1 = no drawing / unknown).
  const drawingIdRef = useRef<Int32Array>(
    new Int32Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1),
  );
  // drawing_id → model_name; populated when the leaderboard is fetched.
  const drawingModelMap = useRef<Map<number, string>>(new Map());
  // The set of drawing_ids that belong to the currently highlighted model.
  // Rebuilt whenever highlightedModel changes.
  const highlightedDrawingIds = useRef<Set<number>>(new Set());
  // While the initial fetch is still running, realtime events are buffered
  // here (cell index → color). Replayed onto the fetched buffer at completion
  // so they aren't wiped.
  const fetchBufferRef = useRef<Map<number, number> | null>(null);
  // Parallel buffer for drawing_ids during the initial fetch.
  const fetchDrawingIdBufferRef = useRef<Map<number, number> | null>(null);
  const [live, setLive] = useState(false);
  const [placedCount, setPlacedCount] = useState(0);
  // How many widgets currently have an active websocket — driven by
  // Supabase Realtime Presence on the same channel we use for pixel updates.
  const [liveCount, setLiveCount] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [highlightedModel, setHighlightedModel] = useState<string | null>(null);

  type LeaderboardEntry = { model_name: string; pixels: number };
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const leaderboardFetched = useRef(false);
  // Latest user_name for the presence track() call. We can't use the
  // userName state directly inside the channel-subscribe useEffect (deps
  // would force a channel rebuild on every name change), so we mirror it
  // through a ref.
  const userNameRef = useRef<string | null>(null);
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
        cx: number;
        cy: number;
        loading: boolean;
        drawing: DrawingMeta | null;
      }
    | null
  >(null);
  // Tracks the client position at pointer-down so we can distinguish a click
  // from a drag.
  const panStart = useRef<{ x: number; y: number } | null>(null);

  // Cell under the cursor — drives a soft highlight overlay so the user can
  // see which pixel a click would target. State + ref so we only re-render
  // when the cell actually changes (pointermove fires often).
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(
    null,
  );
  const hoverCellRef = useRef<{ x: number; y: number } | null>(null);
  function setHoverIfChanged(cell: { x: number; y: number } | null) {
    const prev = hoverCellRef.current;
    if (prev === cell) return;
    if (prev && cell && prev.x === cell.x && prev.y === cell.y) return;
    hoverCellRef.current = cell;
    setHoverCell(cell);
  }

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
  // 50% blend of each palette color toward the canvas background — used to
  // dim pixels that don't belong to the currently highlighted model.
  const dimmedPaletteRgbRef = useRef<[number, number, number][]>([]);
  dimmedPaletteRgbRef.current = paletteRgb.map(
    ([r, g, b]) =>
      [
        Math.round(r * 0.5 + EMPTY_R * 0.5),
        Math.round(g * 0.5 + EMPTY_G * 0.5),
        Math.round(b * 0.5 + EMPTY_B * 0.5),
      ] as [number, number, number],
  );

  function drawAll() {
    const canvas = canvasRef.current;
    const pal = paletteRgbRef.current;
    if (!canvas || pal.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
    const pixels = pixelsRef.current;
    const ids = drawingIdRef.current;
    const dimmed = dimmedPaletteRgbRef.current;
    const hl = highlightedDrawingIds.current;
    const isHighlighting = hl.size > 0;
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      const o = i * 4;
      if (c < 0) {
        img.data[o] = EMPTY_R;
        img.data[o + 1] = EMPTY_G;
        img.data[o + 2] = EMPTY_B;
        img.data[o + 3] = 255;
      } else {
        const highlighted = !isHighlighting || hl.has(ids[i]);
        const rgb = (highlighted ? pal : dimmed)[c] ?? [0, 0, 0];
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawOne(x: number, y: number, color: number, drawingId?: number | null) {
    const canvas = canvasRef.current;
    const pal = paletteRgbRef.current;
    if (!canvas || pal.length === 0) return;
    if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const hl = highlightedDrawingIds.current;
    const isHighlighting = hl.size > 0;
    const highlighted = !isHighlighting || (drawingId != null && hl.has(drawingId));
    const activePal = highlighted ? pal : dimmedPaletteRgbRef.current;
    const rgb = activePal[color] ?? [0, 0, 0];
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
    fetchDrawingIdBufferRef.current = new Map();
    const client = createClient(meta.supabase.url, meta.supabase.anonKey, {
      auth: { persistSession: false },
    });

    (async () => {
      const buf = new Int16Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
      const idBuf = new Int32Array(CANVAS_SIZE * CANVAS_SIZE).fill(-1);
      let count = 0;
      const pageSize = 1000;
      let from = 0;
      while (!cancelled) {
        const { data, error } = await client
          .from("pixels")
          .select("x, y, color, drawing_id")
          .range(from, from + pageSize - 1);
        if (cancelled) return;
        if (error) {
          console.warn("[canvas] fetch failed:", error);
          fetchBufferRef.current = null;
          fetchDrawingIdBufferRef.current = null;
          return;
        }
        const rows = data ?? [];
        for (const row of rows) {
          const cell = row.y * CANVAS_SIZE + row.x;
          buf[cell] = row.color;
          idBuf[cell] = row.drawing_id ?? -1;
          count++;
        }
        if (rows.length === 0 || rows.length < pageSize) break;
        from += pageSize;
      }
      if (cancelled) return;
      // Replay realtime events that landed during the fetch.
      const pending = fetchBufferRef.current;
      const pendingIds = fetchDrawingIdBufferRef.current;
      if (pending) {
        for (const [cell, color] of pending) {
          if (buf[cell] < 0 && color >= 0) count++;
          buf[cell] = color;
        }
      }
      if (pendingIds) {
        for (const [cell, did] of pendingIds) idBuf[cell] = did;
      }
      fetchBufferRef.current = null;
      fetchDrawingIdBufferRef.current = null;
      pixelsRef.current = buf;
      drawingIdRef.current = idBuf;
      setPlacedCount(count);
      setSnapshotVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
      fetchBufferRef.current = null;
      fetchDrawingIdBufferRef.current = null;
    };
  }, [meta?.supabase?.url, meta?.supabase?.anonKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  useEffect(() => {
    drawAll();
  }, [snapshotVersion, paletteRgb]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  useEffect(() => {
    const ids = new Set<number>();
    if (highlightedModel) {
      for (const [id, model] of drawingModelMap.current) {
        if (model === highlightedModel) ids.add(id);
      }
    }
    highlightedDrawingIds.current = ids;
    drawAll();
  }, [highlightedModel]);

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
    // A per-tab id so two tabs from the same user count separately. We
    // don't dedupe by user_name because we want the count to reflect how
    // many widgets are currently watching, not how many distinct people.
    const presenceKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const channel: RealtimeChannel = client
      .channel("pixels-live", {
        config: { presence: { key: presenceKey } },
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pixels" },
        (payload) => {
          const row = (payload.new ?? payload.old) as PixelRow | undefined;
          if (!row) return;
          const idx = row.y * CANVAS_SIZE + row.x;
          const prev = pixelsRef.current[idx];
          pixelsRef.current[idx] = row.color;
          const did = row.drawing_id ?? -1;
          drawingIdRef.current[idx] = did;
          // If a fetch is in flight, stash the event so it survives the
          // buffer replacement at fetch-completion.
          if (fetchBufferRef.current) {
            fetchBufferRef.current.set(idx, row.color);
          }
          if (fetchDrawingIdBufferRef.current) {
            fetchDrawingIdBufferRef.current.set(idx, did);
          }
          if (prev < 0 && row.color >= 0) {
            setPlacedCount((n) => n + 1);
          }
          drawOne(row.x, row.y, row.color, row.drawing_id);
        },
      )
      .on("presence", { event: "sync" }, () => {
        setLiveCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async (status) => {
        setLive(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          // track() registers our presence on this channel; the user_name
          // is included so we could later show who's here, not just count.
          await channel.track({ user_name: userNameRef.current ?? null });
        }
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      client.removeChannel(channel);
    };
  }, [meta?.supabase?.url, meta?.supabase?.anonKey]);

  // Push name updates into the live presence record without re-creating
  // the channel (we don't want to drop the postgres_changes subscription).
  userNameRef.current = userName;
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.track({ user_name: userName ?? null });
  }, [userName]);

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

  // Map a screen point (relative to outerRef) to canvas pixel coords. The
  // result is NOT clamped — callers should bounds-check (or clamp) as needed.
  function screenToCanvas(clientX: number, clientY: number) {
    const el = outerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    return { x: (mx - tx) / totalScale, y: (my - ty) / totalScale };
  }

  function clamp01N(v: number) {
    return Math.max(0, Math.min(CANVAS_SIZE, v));
  }

  // Cap the selection to the model's per-call pixel budget. Default 1000
  // matches the server's MAX_BATCH; the server passes its actual value via
  // widgetMeta so the two stay in sync if it ever changes.
  const maxArea = meta?.maxBatch ?? 1000;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Don't hijack clicks that landed on an interactive overlay (toolbar
    // buttons, selection chip, popover trigger, etc.) — let them handle the
    // event themselves.
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (mode === "select") {
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      const cx = clamp01N(x);
      const cy = clamp01N(y);
      selectionStart.current = { x: cx, y: cy };
      setSelectionDraft({ x: Math.floor(cx), y: Math.floor(cy), w: 0, h: 0 });
      setSelection(null);
      return;
    }

    panStart.current = { x: e.clientX, y: e.clientY };
    // Don't flip isDragging here — it controls the grabbing cursor and we
    // want the cursor to stay default until the user actually moves past
    // the click threshold in onPointerMove.
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Track the cell under the cursor for the hover highlight (regardless of
    // mode or drag state). Clears when the pointer leaves the canvas area.
    {
      const raw = screenToCanvas(e.clientX, e.clientY);
      const cx = Math.floor(raw.x);
      const cy = Math.floor(raw.y);
      if (cx >= 0 && cy >= 0 && cx < CANVAS_SIZE && cy < CANVAS_SIZE) {
        setHoverIfChanged({ x: cx, y: cy });
      } else {
        setHoverIfChanged(null);
      }
    }

    if (mode === "select") {
      const start = selectionStart.current;
      if (!start) return;
      const raw = screenToCanvas(e.clientX, e.clientY);
      let dx = clamp01N(raw.x) - start.x;
      let dy = clamp01N(raw.y) - start.y;
      // If the area would exceed the per-call cap, scale dx/dy back along
      // the drag direction so the rect "sticks" to the cap.
      const aw = Math.abs(dx);
      const ah = Math.abs(dy);
      if (aw * ah > maxArea && aw > 0 && ah > 0) {
        const factor = Math.sqrt(maxArea / (aw * ah));
        dx *= factor;
        dy *= factor;
      }
      const cursorX = start.x + dx;
      const cursorY = start.y + dy;
      const x0 = Math.floor(Math.min(start.x, cursorX));
      const y0 = Math.floor(Math.min(start.y, cursorY));
      const x1 = Math.ceil(Math.max(start.x, cursorX));
      const y1 = Math.ceil(Math.max(start.y, cursorY));
      setSelectionDraft({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      return;
    }
    const start = dragStart.current;
    if (!start) return;
    const dx = e.clientX - start.mx;
    const dy = e.clientY - start.my;
    if (!isDragging) {
      // Only enter drag (and flip the grabbing cursor) once the pointer has
      // moved past the click threshold.
      if (Math.hypot(dx, dy) < 4) return;
      setIsDragging(true);
    }
    setOffset({ x: start.ox + dx, y: start.oy + dy });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (mode === "select") {
      if (selectionDraft && selectionDraft.w > 0 && selectionDraft.h > 0) {
        setSelection(selectionDraft);
        // Drop back into pan mode so the user can move the canvas around
        // (and tweak the selection via its handles) without re-toggling.
        setMode("pan");
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
    if (!meta?.supabase?.url || !meta?.supabase?.anonKey) return;
    // Anchor the popover at the centre of the clicked pixel (not the mouse)
    // so the arrow points at the pixel itself.
    const ax = tx + (cx + 0.5) * totalScale;
    const ay = ty + (cy + 0.5) * totalScale;
    setPopover({ ax, ay, cx, cy, loading: true, drawing: null });
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

  async function openLeaderboard() {
    setLeaderboardOpen(true);
    if (leaderboardFetched.current) return;
    if (!meta?.supabase?.url || !meta?.supabase?.anonKey) return;
    setLeaderboardLoading(true);
    const client = createClient(meta.supabase.url, meta.supabase.anonKey, {
      auth: { persistSession: false },
    });
    // Fetch all drawings with a model name and aggregate client-side.
    // One row per tool call — won't be large enough to need pagination.
    const { data } = await client
      .from("drawings")
      .select("id, model_name, pixel_count")
      .not("model_name", "is", null);
    if (data) {
      const totals = new Map<string, number>();
      for (const row of data as { id: number; model_name: string; pixel_count: number }[]) {
        drawingModelMap.current.set(row.id, row.model_name);
        totals.set(row.model_name, (totals.get(row.model_name) ?? 0) + row.pixel_count);
      }
      const sorted = [...totals.entries()]
        .map(([model_name, pixels]) => ({ model_name, pixels }))
        .sort((a, b) => b.pixels - a.pixels);
      setLeaderboard(sorted);
      leaderboardFetched.current = true;
    }
    setLeaderboardLoading(false);
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

  // Drag-edit a committed selection: the body moves the rect, edge handles
  // resize one side at a time. Dimensions are in canvas coords; mouse deltas
  // get divided by totalScale to map back.
  type SelectionInteraction =
    | "move"
    | "resize-nw"
    | "resize-ne"
    | "resize-sw"
    | "resize-se";
  const selectionInteraction = useRef<{
    type: SelectionInteraction;
    startMouse: { x: number; y: number };
    startRect: Rect;
  } | null>(null);

  function beginSelectionInteraction(
    e: React.PointerEvent<HTMLDivElement>,
    type: SelectionInteraction,
  ) {
    if (e.button !== 0 || !selection) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectionInteraction.current = {
      type,
      startMouse: { x: e.clientX, y: e.clientY },
      startRect: selection,
    };
  }

  function onSelectionPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const ix = selectionInteraction.current;
    if (!ix) return;
    e.stopPropagation();
    const dx = (e.clientX - ix.startMouse.x) / totalScale;
    const dy = (e.clientY - ix.startMouse.y) / totalScale;
    let { x, y, w, h } = ix.startRect;
    if (ix.type === "move") {
      x = Math.round(x + dx);
      y = Math.round(y + dy);
      x = Math.max(0, Math.min(CANVAS_SIZE - w, x));
      y = Math.max(0, Math.min(CANVAS_SIZE - h, y));
    } else {
      // Corner resize: adjust the two edges meeting at the dragged corner.
      const movesLeft = ix.type === "resize-nw" || ix.type === "resize-sw";
      const movesTop = ix.type === "resize-nw" || ix.type === "resize-ne";
      if (movesLeft) {
        const newX = Math.round(Math.max(0, Math.min(x + w - 1, x + dx)));
        w = w - (newX - x);
        x = newX;
      } else {
        w = Math.round(Math.max(1, Math.min(CANVAS_SIZE - x, w + dx)));
      }
      if (movesTop) {
        const newY = Math.round(Math.max(0, Math.min(y + h - 1, y + dy)));
        h = h - (newY - y);
        y = newY;
      } else {
        h = Math.round(Math.max(1, Math.min(CANVAS_SIZE - y, h + dy)));
      }
      // Cap the area, keeping the corner opposite the dragged one pinned.
      if (w * h > maxArea) {
        const factor = Math.sqrt(maxArea / (w * h));
        const newW = Math.max(1, Math.floor(w * factor));
        const newH = Math.max(1, Math.floor(h * factor));
        if (movesLeft) x = x + w - newW;
        if (movesTop) y = y + h - newH;
        w = newW;
        h = newH;
      }
    }
    setSelection({ x, y, w, h });
  }

  function onSelectionPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!selectionInteraction.current) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    selectionInteraction.current = null;
  }

  // Escape clears any active zone selection (and exits select mode if it
  // was on). The Dialog and Popover handle their own Escape via Radix.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selection || selectionDraft || mode === "select") {
        clearSelection();
        setMode("pan");
        selectionStart.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, selectionDraft, mode]);

  const tx = centerX + offset.x;
  const ty = centerY + offset.y;
  const measured = outerSize.w > 0 && outerSize.h > 0;
  const ready = !!meta && measured;

  return (
    <div
      className={`canvas-wrap ${isFullscreen ? "fullscreen" : ""}`}
      data-llm={`Pixel canvas ${CANVAS_SIZE}x${CANVAS_SIZE}, ${placedCount} pixels placed${live ? "" : " (connecting)"}.${userName ? ` The user's chosen name is "${userName}" — pass this as user_name on every stamp-grid call.` : ""}${selection ? ` The user selected a target zone: x=${selection.x}, y=${selection.y}, width=${selection.w}, height=${selection.h}. Place the drawing inside this rectangle (top-left at (${selection.x},${selection.y}), bottom-right exclusive at (${selection.x + selection.w},${selection.y + selection.h})).` : ""} Use stamp-grid to draw.`}
    >
      <div
        ref={outerRef}
        className={`canvas-outer ${isDragging ? "dragging" : ""} ${mode === "select" ? "select-mode" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverIfChanged(null)}
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

        {hoverCell && !selectionDraft && !isDragging && (
          <div
            className="pointer-events-none absolute border border-foreground/30 mix-blend-difference"
            style={{
              left: tx + hoverCell.x * totalScale,
              top: ty + hoverCell.y * totalScale,
              width: totalScale,
              height: totalScale,
            }}
          />
        )}

        {selectionDraft && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-fuchsia-400 bg-fuchsia-400/10"
            style={{
              left: tx + selectionDraft.x * totalScale,
              top: ty + selectionDraft.y * totalScale,
              width: selectionDraft.w * totalScale,
              height: selectionDraft.h * totalScale,
            }}
          />
        )}

        {selection && !selectionDraft && (() => {
          const sx = tx + selection.x * totalScale;
          const sy = ty + selection.y * totalScale;
          const sw = selection.w * totalScale;
          const sh = selection.h * totalScale;
          const handles: {
            edge: SelectionInteraction;
            cx: number;
            cy: number;
            cursor: string;
          }[] = [
            { edge: "resize-nw", cx: sx,      cy: sy,      cursor: "nwse-resize" },
            { edge: "resize-ne", cx: sx + sw, cy: sy,      cursor: "nesw-resize" },
            { edge: "resize-sw", cx: sx,      cy: sy + sh, cursor: "nesw-resize" },
            { edge: "resize-se", cx: sx + sw, cy: sy + sh, cursor: "nwse-resize" },
          ];
          return (
            <>
              {/* Body of the selection — drag to move. */}
              <div
                className="absolute border-2 border-dashed border-fuchsia-400 bg-fuchsia-400/10 cursor-move"
                style={{ left: sx, top: sy, width: sw, height: sh }}
                onPointerDown={(e) => beginSelectionInteraction(e, "move")}
                onPointerMove={onSelectionPointerMove}
                onPointerUp={onSelectionPointerUp}
                onPointerCancel={onSelectionPointerUp}
              />
              {/* Edge handles — drag to resize one side. */}
              {handles.map((h) => (
                <div
                  key={h.edge}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-fuchsia-500 shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                  style={{ left: h.cx, top: h.cy, cursor: h.cursor }}
                  onPointerDown={(e) => beginSelectionInteraction(e, h.edge)}
                  onPointerMove={onSelectionPointerMove}
                  onPointerUp={onSelectionPointerUp}
                  onPointerCancel={onSelectionPointerUp}
                />
              ))}
            </>
          );
        })()}

        {popover && (
          <>
            {/* Highlight the selected pixel with a 1.5px outline so the user
                can see which cell the popover refers to. */}
            <div
              className="pointer-events-none absolute ring-2 ring-foreground/90 ring-offset-1 ring-offset-background/40 rounded-[1px]"
              style={{
                left: tx + popover.cx * totalScale,
                top: ty + popover.cy * totalScale,
                width: totalScale,
                height: totalScale,
              }}
            />
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
                sideOffset={Math.max(8, totalScale / 2 + 6)}
                collisionPadding={8}
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
                <PopoverArrow
                  width={12}
                  height={6}
                  className="fill-popover drop-shadow-[0_1px_0_rgba(0,0,0,0.06)]"
                />
              </PopoverContent>
            </Popover>
          </>
        )}

        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {liveCount > 0 && (
            <div
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-xs text-white backdrop-blur-sm"
              title={`${liveCount} viewer${liveCount === 1 ? "" : "s"} live on the canvas`}
            >
              <Users size={14} />
              <span className="font-mono tabular-nums">{liveCount}</span>
            </div>
          )}

          <Popover open={leaderboardOpen} onOpenChange={setLeaderboardOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Model leaderboard"
                title="Model leaderboard"
                onClick={openLeaderboard}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-black/55 text-white opacity-85 backdrop-blur-sm transition hover:bg-black/70 hover:opacity-100 cursor-pointer"
              >
                <Trophy size={16} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" sideOffset={8} className="w-64 p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Pixels placed by model</p>
              {leaderboardLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : leaderboard.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data yet.</p>
              ) : (
                <ol className="flex flex-col gap-0.5">
                  {leaderboard.map((entry, i) => {
                    const active = highlightedModel === entry.model_name;
                    return (
                      <li key={entry.model_name}>
                        <button
                          type="button"
                          onClick={() =>
                            setHighlightedModel(active ? null : entry.model_name)
                          }
                          className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors cursor-pointer border-0 text-left ${
                            active
                              ? "bg-foreground text-background"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <span className="w-4 shrink-0 text-right text-muted-foreground/70 tabular-nums">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {entry.model_name}
                          </span>
                          <span className="shrink-0 tabular-nums opacity-70">
                            {entry.pixels.toLocaleString()} px
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {highlightedModel && (
                <button
                  type="button"
                  onClick={() => setHighlightedModel(null)}
                  className="mt-2 w-full cursor-pointer rounded-md border-0 bg-muted px-2 py-1 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/80"
                >
                  Clear highlight
                </button>
              )}
            </PopoverContent>
          </Popover>

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
          {selection && (() => {
            const area = selection.w * selection.h;
            const atCap = area >= maxArea * 0.99;
            return (
              <div
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-fuchsia-500/85 px-2.5 text-xs text-white backdrop-blur-sm"
                title={atCap ? `At the per-call cap (${maxArea} pixels).` : undefined}
              >
                <span className="font-mono">
                  {selection.w}×{selection.h} · {area}/{maxArea}px
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
            );
          })()}
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
