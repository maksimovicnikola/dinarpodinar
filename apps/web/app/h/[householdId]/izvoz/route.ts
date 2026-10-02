import { monthKey, todayInBelgrade } from "@finance/domain";
import { redirect } from "next/navigation";

import { buildHouseholdWorkbook, workbookFilename, type ExportEntry } from "@/lib/excel-export";
import { loginPathWithNext, uuidParam } from "@/lib/next-path";
import { createServerComponentSupabase } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ householdId: string }> },
) {
  const { householdId: raw } = await context.params;
  const householdId = uuidParam(raw);
  if (householdId === null) {
    return new Response("Adresa nije ispravna.", { status: 400 });
  }

  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();
  if (!auth.data.user) {
    redirect(loginPathWithNext(`/h/${householdId}/izvoz`));
  }

  const [household, categories, entries] = await Promise.all([
    supabase.from("households").select("name, currency").eq("id", householdId).maybeSingle(),
    supabase.from("categories").select("id, name").eq("household_id", householdId),
    supabase
      .from("entries")
      .select("kind, amount_minor, category_id, person_name, occurred_on, note, recurring_rule_id")
      .eq("household_id", householdId)
      .order("occurred_on", { ascending: true }),
  ]);

  if (household.error || categories.error || entries.error || !household.data) {
    return new Response("Izvoz nije uspeo. Osvežite stranu i pokušajte ponovo.", { status: 500 });
  }

  const names = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
  const rows: ExportEntry[] = (entries.data ?? []).map((row) => ({
    occurredOn: row.occurred_on,
    kind: row.kind,
    amountMinor: row.amount_minor,
    categoryName: names.get(row.category_id) ?? "Kategorija",
    personName: row.person_name,
    note: row.note ?? "",
    repeating: row.recurring_rule_id !== null,
  }));

  const bytes = await buildHouseholdWorkbook({
    currency: household.data.currency,
    entries: rows,
    emptyMonth: monthKey(todayInBelgrade(new Date())),
  });
  const filename = workbookFilename(household.data.name);
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
