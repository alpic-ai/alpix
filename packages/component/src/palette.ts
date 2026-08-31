export const PALETTE = [
  { name: "dark_red", hex: "#6D001A" },
  { name: "red", hex: "#BE0039" },
  { name: "orange_red", hex: "#FF4500" },
  { name: "orange", hex: "#FFA800" },
  { name: "yellow", hex: "#FFD635" },
  { name: "pale_yellow", hex: "#FFF8B8" },
  { name: "dark_green", hex: "#00A368" },
  { name: "green", hex: "#00CC78" },
  { name: "light_green", hex: "#7EED56" },
  { name: "dark_teal", hex: "#00756F" },
  { name: "teal", hex: "#009EAA" },
  { name: "light_teal", hex: "#00CCC0" },
  { name: "dark_blue", hex: "#2450A4" },
  { name: "blue", hex: "#3690EA" },
  { name: "light_blue", hex: "#51E9F4" },
  { name: "indigo", hex: "#493AC1" },
  { name: "periwinkle", hex: "#6A5CFF" },
  { name: "lavender", hex: "#94B3FF" },
  { name: "dark_purple", hex: "#811E9F" },
  { name: "purple", hex: "#B44AC0" },
  { name: "pink_purple", hex: "#E4ABFF" },
  { name: "magenta", hex: "#DE107F" },
  { name: "pink", hex: "#FF3881" },
  { name: "light_pink", hex: "#FF99AA" },
  { name: "dark_brown", hex: "#6D482F" },
  { name: "brown", hex: "#9C6926" },
  { name: "beige", hex: "#FFB470" },
  { name: "black", hex: "#000000" },
  { name: "dark_gray", hex: "#515252" },
  { name: "gray", hex: "#898D90" },
  { name: "light_gray", hex: "#D4D7D9" },
  { name: "white", hex: "#FFFFFF" },
] as const;

export type ColorName = (typeof PALETTE)[number]["name"];

export const COLOR_NAMES = PALETTE.map((p) => p.name) as readonly ColorName[];

export const COLOR_INDEX: Record<ColorName, number> = Object.fromEntries(
  PALETTE.map((p, i) => [p.name, i]),
) as Record<ColorName, number>;

export const CANVAS_SIZE = 256;
