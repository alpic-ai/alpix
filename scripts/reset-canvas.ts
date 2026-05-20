#!/usr/bin/env npx tsx
/// <reference types="node" />
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

const { count: pixelCount } = await supa
  .from("pixels")
  .select("*", { count: "exact", head: true });

const { count: drawingCount } = await supa
  .from("drawings")
  .select("*", { count: "exact", head: true });

const { data: current } = await supa
  .from("canvases")
  .select("id, created_at")
  .order("id", { ascending: false })
  .limit(1)
  .single();

console.log(`Current canvas: #${current?.id} (started ${current?.created_at})`);
console.log(`  ${pixelCount} pixels, ${drawingCount} drawings`);
console.log("");
console.log("Archiving and resetting...");

const { data: newCanvas, error: canvasErr } = await supa
  .from("canvases")
  .insert({})
  .select("id")
  .single();

if (canvasErr || newCanvas == null) {
  console.error("Failed to create new canvas:", canvasErr?.message);
  process.exit(1);
}

const { error: truncateErr } = await supa.from("pixels").delete().gte("x", 0);

if (truncateErr) {
  console.error("Failed to truncate pixels:", truncateErr.message);
  process.exit(1);
}

console.log(`Done. Canvas #${newCanvas.id} is now active and empty.`);
