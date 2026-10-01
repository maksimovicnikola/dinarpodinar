import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "./env";

export function createBrowserSupabase() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
