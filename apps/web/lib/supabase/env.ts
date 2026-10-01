/**
 * Oba imena su `NEXT_PUBLIC_`, pa ih Next ugrađuje u paket pri izgradnji.
 * Čitanje mora ostati direktan pristup članu `process.env.X` da bi zamena radila.
 */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Nedostaje NEXT_PUBLIC_SUPABASE_URL ili NEXT_PUBLIC_SUPABASE_ANON_KEY. Vidi apps/web/.env.local.example.",
    );
  }

  return { url, anonKey };
}
