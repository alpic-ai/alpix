/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_DESCOPE_PROJECT_ID?: string;
  readonly VITE_DESCOPE_FLOW_ID?: string;
  readonly VITE_DESCOPE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
