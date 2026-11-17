import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  limitThresholds,
  monthKey,
  summarizeMonth,
  todayInBelgrade,
  type RecurrenceCadence,
} from "@finance/domain";
import { reminderOccurrences } from "./decide";

type Admin = SupabaseClient;

function admin(): Admin {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Nedostaje SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function claim(client: Admin, householdId: string, dedupeKey: string): Promise<boolean> {
  const inserted = await client.from("sent_notifications").insert({
    household_id: householdId,
    dedupe_key: dedupeKey,
  }).select("id");
  if (inserted.error?.code === "23505") return false;
  if (inserted.error) throw inserted.error;
  return (inserted.data?.length ?? 0) > 0;
}

async function pushToHousehold(client: Admin, householdId: string, body: string) {
  const members = await client.from("memberships").select("user_id").eq("household_id", householdId);
  if (members.error) throw members.error;
  const ids = (members.data ?? []).map((row) => row.user_id);
  if (ids.length === 0) return;
  const tokens = await client.from("push_tokens").select("token").in("user_id", ids);
  if (tokens.error) throw tokens.error;
  const list = (tokens.data ?? []).map((row) => row.token);
  if (list.length === 0) return;
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(list.map((to) => ({ to, body }))),
  });
  if (!response.ok) throw new Error(`Expo push nije prihvaćen (${response.status})`);
}

export async function sendLimitAlerts(client: Admin, householdId: string, month: string) {
  const categories = await client.from("categories").select("id, name, kind, limit_minor").eq("household_id", householdId).eq("archived", false);
  if (categories.error) throw categories.error;
  const entries = await client.from("entries").select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on").eq("household_id", householdId).eq("month_key", month);
  if (entries.error) throw entries.error;
  const summary = summarizeMonth({
    month,
    categories: (categories.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      limitMinor: row.limit_minor,
    })),
    entries: (entries.data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      amountMinor: row.amount_minor,
      categoryId: row.category_id,
      personId: row.person_id,
      personName: row.person_name,
      occurredOn: row.occurred_on,
    })),
  });
  for (const category of summary.categories) {
    const thresholds = limitThresholds(category.spentMinor, category.limitMinor);
    for (const threshold of thresholds.slice(-1)) {
      const claimed = await claim(client, householdId, `limit:${category.categoryId}:${month}:${threshold}`);
      if (claimed) await pushToHousehold(client, householdId, `${category.name} je prešla ${threshold}% limita.`);
    }
  }
}

/**
 * Jedan podsetnik po pravilu, prvi put kad neko uđe u prozor dospeća.
 *
 * Unos se ovde ne pravi. Plaćanje se beleži tek kad ga član potvrdi, jer
 * zaboravljena rata ne sme sama da uđe u zbir.
 */
export async function sendDueReminders(client: Admin, householdId: string, today: string) {
  const rules = await client
    .from("recurring_rules")
    .select("id, category_id, day_of_month, month_of_year, cadence, remind_days")
    .eq("household_id", householdId)
    .eq("active", true);
  if (rules.error) throw rules.error;

  for (const rule of rules.data ?? []) {
    const cadence: RecurrenceCadence = rule.cadence === "yearly" ? "yearly" : "monthly";
    const occurrences = reminderOccurrences({
      today,
      dayOfMonth: rule.day_of_month,
      remindDays: rule.remind_days,
      cadence,
      monthOfYear: rule.month_of_year,
    });

    for (const occurrence of occurrences) {
      const month = monthKey(occurrence);
      const existing = await client
        .from("entries")
        .select("id")
        .eq("recurring_rule_id", rule.id)
        .eq("month_key", month)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) continue;

      const claimed = await claim(client, householdId, `reminder:${rule.id}:${month}`);
      if (!claimed) continue;

      const category = await client.from("categories").select("name").eq("id", rule.category_id).single();
      if (category.error) throw category.error;
      const name = category.data?.name ?? "unos";
      const body =
        occurrence < today
          ? `Podsetnik: ${name} je dospeo ${occurrence}, a nije unet.`
          : `Podsetnik: ${name} dospeva ${occurrence}.`;
      await pushToHousehold(client, householdId, body);
      break;
    }
  }
}

export async function runDay(now: Date) {
  const client = admin();
  const today = todayInBelgrade(now);
  const rules = await client.from("recurring_rules").select("household_id");
  if (rules.error) throw rules.error;
  const households = new Set((rules.data ?? []).map((row) => row.household_id as string));
  for (const householdId of households) {
    await sendDueReminders(client, householdId, today);
    await sendLimitAlerts(client, householdId, monthKey(today));
  }
}
