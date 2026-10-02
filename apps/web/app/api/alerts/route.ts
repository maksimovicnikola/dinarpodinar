import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { monthKey, todayInBelgrade } from "@finance/domain";
import { sendLimitAlerts } from "jobs/run";

import { createWritableServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { supabase, cookieFailure } = await createWritableServerSupabase();
  const user = await supabase.auth.getUser();
  if (cookieFailure() || !user.data.user) {
    return NextResponse.json({ error: "Prijava je obavezna" }, { status: 401 });
  }
  const body = (await request.json()) as { householdId?: string };
  if (!body.householdId) return NextResponse.json({ error: "Nema domaćinstva" }, { status: 400 });
  const membership = await supabase
    .from("memberships")
    .select("role")
    .eq("household_id", body.householdId)
    .eq("user_id", user.data.user.id)
    .maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data) return NextResponse.json({ error: "Zabranjeno" }, { status: 403 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Nedostaje NEXT_PUBLIC_SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  await sendLimitAlerts(admin, body.householdId, monthKey(todayInBelgrade(new Date())));
  return NextResponse.json({ ok: true });
}
