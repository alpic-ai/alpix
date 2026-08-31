export const PIXELS_CHANNEL = "pixels-live";
export const PIXEL_BATCH_EVENT = "pixel-batch";
export const CANVAS_RESET_EVENT = "canvas-reset";
export const MAX_PIXEL_BATCH = 4096;

export type PixelTuple = [x: number, y: number, color: number];

export type PixelBatchPayload = {
  drawingId: number;
  pixels: PixelTuple[];
};

export type CanvasResetPayload = {
  canvasId: number;
};
