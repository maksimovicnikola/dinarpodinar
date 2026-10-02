import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { limitThresholds, monthKey, summarizeMonth, todayInBelgrade } from "@finance/domain";
import { dueActions, occurrenceThisMonth } from "./decide";

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
    for (const threshold of limitThresholds(category.spentMinor, category.limitMinor)) {
      const claimed = await claim(client, householdId, `limit:${category.categoryId}:${month}:${threshold}`);
      if (claimed) await pushToHousehold(client, householdId, `${category.name} je prešla ${threshold}% limita.`);
    }
  }
}

export async function runDay(now: Date) {
  const client = admin();
  const today = todayInBelgrade(now);
  const rules = await client.from("recurring_rules").select("id, household_id, kind, amount_minor, category_id, person_id, note, day_of_month, remind_days, active");
  if (rules.error) throw rules.error;
  const households = new Set<string>();
  for (const rule of rules.data ?? []) {
    households.add(rule.household_id);
    const occurrence = occurrenceThisMonth(today, rule.day_of_month);
    const month = monthKey(occurrence);
    const existing = await client.from("entries").select("id").eq("recurring_rule_id", rule.id).eq("month_key", month).maybeSingle();
    if (existing.error) throw existing.error;
    const sent = await client.from("sent_notifications").select("id").eq("household_id", rule.household_id).eq("dedupe_key", `reminder:${rule.id}:${month}`).maybeSingle();
    if (sent.error) throw sent.error;
    const actions = dueActions({
      today,
      dayOfMonth: rule.day_of_month,
      remindDays: rule.remind_days,
      active: rule.active,
      reminderSent: Boolean(sent.data),
      entryExists: Boolean(existing.data),
    });
    if (actions.includes("insert")) {
      const inserted = await client.from("entries").insert({
        household_id: rule.household_id,
        kind: rule.kind,
        amount_minor: rule.amount_minor,
        category_id: rule.category_id,
        person_id: rule.person_id,
        occurred_on: occurrence,
        note: rule.note,
        recurring_rule_id: rule.id,
        created_by: rule.person_id,
      });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    }
    if (actions.includes("remind")) {
      const claimed = await claim(client, rule.household_id, `reminder:${rule.id}:${month}`);
      if (claimed) {
        const category = await client.from("categories").select("name").eq("id", rule.category_id).single();
        if (category.error) throw category.error;
        await pushToHousehold(client, rule.household_id, `Podsetnik: ${category.data?.name ?? "unos"} dospeva ${occurrence}.`);
      }
    }
  }
  for (const householdId of households) {
    await sendLimitAlerts(client, householdId, monthKey(today));
  }
}
