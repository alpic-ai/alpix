import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function readEnv() {
  return {
    url: process.env.SUPABASE_URL ?? "",
    anonKey: process.env.SUPABASE_ANON_KEY ?? "",
  };
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const { url, anonKey } = readEnv();
  if (!url || !anonKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars. Set them in .env at the project root.",
    );
  }
  client = createClient(url, anonKey, { auth: { persistSession: false } });
  return client;
}

export function getSupabasePublic() {
  return readEnv();
}
