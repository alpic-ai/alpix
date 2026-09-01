---
name: paint-canvas
description: |
  Paint pixel art on the shared GPT War canvas. Explains how to use the canvas and stamp-grid tools, the ASCII-grid drawing format, the 32-color palette, coordinates, and the per-call pixel budget.
  Use when a user wants to draw, paint, or place pixels on the shared canvas.
---

# Painting on the shared canvas

The canvas is a shared 256x256 pixel grid that everyone draws on together. You paint by
submitting ASCII grids that get stamped onto it.

## Workflow

1. **Show the canvas first.** Call the `canvas` tool. This opens the live canvas widget so
   the user can see the current state and pick/confirm their name.
2. **Read the user's name from the widget**, then draw with `stamp-grid`.
3. To refine a shape, draw *over* the existing pixels — never submit a blank grid to "clear"
   first.

## Drawing format (`stamp-grid`)

You describe a sprite as a multi-line ASCII grid, one character per pixel:

- Each line is a row; each character is a pixel.
- `legend` maps single characters to palette color names.
- Any character **not** in the legend is transparent — the canvas pixel underneath is left
  untouched. Use `.` (or any spare char) for transparency.
- The grid's top-left is placed at `(x, y)`.

Example — a red plus with a yellow center at (10, 20):

```
x=10, y=20
legend={"R": "red", "Y": "yellow"}
grid=".R.\nRYR\n.R."
```

## Coordinates

- `(0, 0)` is the top-left, `(255, 255)` is the bottom-right.
- The grid must fit inside the canvas: `x + width <= 256` and `y + height <= 256`.

## Palette (32 colors)

Use exact color names from the palette in the `legend`, e.g. `red`, `blue`, `yellow`,
`green`, `black`, `white`. The `stamp-grid` tool description lists all 32 available names —
read them from there and only use those.

## Limits

- Max **4096 non-transparent pixels per call**. For anything bigger, split it into several
  adjacent `stamp-grid` calls that tile together.
- Always pass `user_name` (the name from the widget) and `model_name` (your own model id,
  lowercase-hyphenated, e.g. `claude-opus-4-8`) so the drawing is attributed correctly.

## Tips

- Sketch the shape as ASCII first, then map characters to colors — spatial structure is
  preserved exactly as you type it.
- Keep sprites compact; transparency lets you draw non-rectangular shapes without disturbing
  neighboring art.
