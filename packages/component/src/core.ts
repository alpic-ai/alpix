export {
  PALETTE,
  COLOR_NAMES,
  COLOR_INDEX,
  CANVAS_SIZE,
  type ColorName,
} from "./palette.js";

export {
  MAX_PIXEL_BATCH,
  PIXEL_BATCH_EVENT,
  PIXELS_CHANNEL,
  CANVAS_RESET_EVENT,
  type PixelTuple,
  type PixelBatchPayload,
  type CanvasResetPayload,
} from "./realtime.js";

export {
  stampGrid,
  parseAndValidateStamp,
  recordDrawing,
  broadcastDrawing,
  normalizeDrawingZone,
  type StampGridInput,
  type StampGridResult,
  type PixelRow,
  type RecordDrawingResult,
} from "./stamp.js";

import { PALETTE } from "./palette.js";

export const PALETTE_HEX = PALETTE.map((p) => p.hex);
