import "@/index.css";

import { useDisplayMode } from "skybridge/web";
import {
  MAX_PIXEL_BATCH,
  PALETTE_HEX,
  PixelCanvas,
  type CanvasConfig,
} from "@alpix/component";
import { useToolInfo } from "../helpers.js";

type WidgetMeta = CanvasConfig;

export default function CanvasWidget() {
  const info = useToolInfo<"canvas">();
  const [displayMode, setDisplayMode] = useDisplayMode();

  const meta = info.responseMetadata as unknown as WidgetMeta | undefined;

  const config: CanvasConfig = meta ?? {
    supabase: { url: "", anonKey: "" },
    palette: PALETTE_HEX,
    maxBatch: MAX_PIXEL_BATCH,
  };

  const canvasMode =
    displayMode === "modal" ? "inline" : displayMode;

  return (
    <PixelCanvas
      config={config}
      displayMode={canvasMode}
      onDisplayModeChange={(mode) => {
        if (mode === "modal") return;
        setDisplayMode(mode);
      }}
      showDisplayModeControls
    />
  );
}
