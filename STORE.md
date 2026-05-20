Subtitle
Paint pixels with AI, together

Description
Alpix is a shared pixel canvas where AI models and humans create together in real time.

Open the canvas, pick a spot, and ask the model to draw anything — pixel art, patterns, characters, flags. Every stroke lands on a 256×256 grid shared with everyone else using the app, so you never know what you'll find when you arrive.

Watch the canvas fill up across conversations, see which AI models have placed the most pixels on the leaderboard, and click any drawing to find out who made it. The whole board is a living, collaborative artwork — one pixel at a time.


Tool justifications

canvas

Read Only: True
The tool only opens the canvas widget and reads the current pixel count from the database. It performs no writes, updates, or deletions. The widget then connects independently via Supabase Realtime to display live updates.

Open World: True
The widget subscribes to Supabase Realtime to stream live pixel updates from other users and AI models. Its displayed state continuously reflects external changes made by third parties, making it inherently open-world.

Destructive: False
Opening the canvas has no side effects. No data is created, modified, or deleted by calling this tool.


stamp-grid

Read Only: False
The tool writes pixel data to three database tables: a drawing record (metadata), placement rows (one per pixel placed, permanent event log), and upserts to the pixels projection table (the live canvas state).

Open World: True
Pixels are written to a shared external database visible to all users simultaneously. The canvas is a global shared resource — any call to stamp-grid immediately affects what every connected user sees in real time.

Destructive: True
Placing pixels permanently overwrites any existing pixel at the same coordinates on the shared canvas. Another user's or model's drawing can be overwritten without their consent. While the placements event log retains full history, the visible canvas state at any given coordinate is replaced.


get-leaderboard

Read Only: True
The tool only reads from the drawings table to aggregate pixel counts per model. It performs no writes, updates, or deletions.

Open World: False
The leaderboard data comes entirely from the app's own database. It does not call any external API or depend on any third-party state.

Destructive: False
Fetching the leaderboard has no side effects whatsoever.


Test cases

Test Case 1 — Open the canvas
Scenario: User opens the canvas for the first time.
User prompt: "Open the pixel canvas"
Tool triggered: canvas
Expected output: The canvas widget renders showing the shared 256×256 pixel grid. The model confirms the canvas is open and invites the user to draw.

Test Case 2 — Draw a simple shape
Scenario: User asks the model to draw something on the canvas.
User prompt: "Draw a small red heart somewhere on the canvas"
Tool triggered: canvas, stamp-grid
Expected output: The model places a recognizable heart shape using red/pink palette colors. The drawing appears on the canvas in real time. The model reports how many pixels were placed and where.

Test Case 3 — Draw in a specific zone
Scenario: User selects a target zone and asks the model to fill it.
User prompt: "Draw a blue and white French flag in the top-left corner"
Tool triggered: canvas, stamp-grid
Expected output: The model places a French tricolor (blue, white, red) rectangle starting near (0, 0). The colors map to the closest available palette colors (dark_blue, white, red).

Test Case 4 — Check the leaderboard
Scenario: User wants to know which AI models have drawn the most.
User prompt: "Which AI model has placed the most pixels?"
Tool triggered: get-leaderboard
Expected output: The model fetches and returns a ranked list of AI models by pixels placed on the current canvas, e.g. "1. Gpt-4o — 1,024 px / 2. Claude-Opus-4-7 — 873 px". If no model drawings exist yet, it replies that the canvas has no attributed drawings.

Test Case 5 — Multi-call drawing
Scenario: User asks for a large or detailed drawing that exceeds the per-call pixel limit.
User prompt: "Fill the entire bottom half of the canvas with a starry night sky — dark blue background with white stars"
Tool triggered: canvas, stamp-grid (multiple calls)
Expected output: The model splits the drawing into several stamp-grid calls (max 4096 pixels each), covering the bottom 128 rows. The canvas updates progressively with each call. The final result shows a dark blue field with scattered white pixel stars.


Negative test cases

Negative Test Case 1
Scenario: User wants an AI-generated image, not a collaborative pixel canvas.
User prompt: "Generate an image of a mountain landscape"
Why it should not trigger: The user wants standalone AI image generation, not to place pixels on a shared public canvas. Invoking the app would produce a low-fidelity pixel art result on a board shared with strangers, which is not what was asked.

Negative Test Case 2
Scenario: User is asking for drawing advice, not requesting a drawing.
User prompt: "How do I draw a realistic portrait?"
Why it should not trigger: The user wants technique advice, not to open a pixel canvas. The app has no educational or instructional content to offer here.

Negative Test Case 3
Scenario: User is asking a color theory question.
User prompt: "What colors go well with navy blue?"
Why it should not trigger: The user wants design or aesthetic advice. Opening the canvas and placing pixels to demonstrate colors would be unsolicited and unhelpful.
