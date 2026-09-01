import "@/index.css";

import type { Sponsored } from "lulu-ads";
import { useDisplayMode, useOpenExternal } from "skybridge/web";
import {
  MAX_PIXEL_BATCH,
  PALETTE_HEX,
  PixelCanvas,
  type CanvasConfig,
  type SponsoredSlot,
} from "@alpix/component";
import { useToolInfo } from "../helpers.js";

type WidgetMeta = CanvasConfig;

export default function CanvasWidget() {
  const info = useToolInfo<"canvas">();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const openExternal = useOpenExternal();

  const meta = info.responseMetadata as unknown as WidgetMeta | undefined;
  const sponsored = (
    info.isSuccess ? info.output.sponsored : undefined
  ) as Sponsored | undefined;

  const config: CanvasConfig = meta ?? {
    supabase: { url: "", anonKey: "" },
    palette: PALETTE_HEX,
    maxBatch: MAX_PIXEL_BATCH,
  };

  const sponsoredSlot: SponsoredSlot | null = sponsored
    ? {
        label: "Sponsored",
        text: sponsored.text,
        url: sponsored.url,
        logoUrl: sponsored.logoUrl,
        impUrl: sponsored.impUrl,
      }
    : null;

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
      sponsored={sponsoredSlot}
      onOpenExternal={(url) => openExternal(url, { redirectUrl: false })}
    />
  );
}
