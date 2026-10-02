import { formatMoney, limitThresholds, monthKey, suggest, summarizeMonth, todayInBelgrade } from "@finance/domain";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { toCategorySnapshot, toEntrySnapshot } from "../lib/rows";
import { supabase } from "../lib/supabase";

function previousMonth(month: string): string | null {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (year === 1900 && monthNumber === 1) return null;
  if (monthNumber === 1) return `${year - 1}-12`;
  return `${year}-${String(monthNumber - 1).padStart(2, "0")}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const [status, setStatus] = useState("Učitavam knjižicu…");
  const [view, setView] = useState<{
    currency: string;
    income: string;
    expense: string;
    leftover: string;
    sentence: string;
    alerts: string[];
    householdId: string;
  } | null>(null);

  const load = useCallback(async () => {
    const auth = await supabase.auth.getUser();
    if (!auth.data.user) {
      router.replace("/login");
      return;
    }
    const membership = await supabase.from("memberships").select("household_id").eq("user_id", auth.data.user.id).limit(1).maybeSingle();
    if (membership.error) {
      setStatus("Knjižica se ne otvara. Proverite vezu.");
      return;
    }
    if (!membership.data) {
      setStatus("Domaćinstvo se otvara na vebu. Kad postanete član, osvežite ovaj ekran.");
      return;
    }
    const householdId = membership.data.household_id;
    const today = todayInBelgrade(new Date());
    const month = monthKey(today);
    const earlier = previousMonth(month);
    const [household, categories, entries] = await Promise.all([
      supabase.from("households").select("currency").eq("id", householdId).maybeSingle(),
      supabase.from("categories").select("id, name, kind, limit_minor").eq("household_id", householdId),
      supabase
        .from("entries")
        .select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on")
        .eq("household_id", householdId)
        .in("month_key", earlier === null ? [month] : [month, earlier]),
    ]);
    if (household.error || categories.error || entries.error || !household.data) {
      setStatus("Knjižica se ne otvara. Proverite vezu.");
      return;
    }
    const categorySnapshots = (categories.data ?? []).map(toCategorySnapshot);
    const entrySnapshots = (entries.data ?? []).map(toEntrySnapshot);
    const current = entrySnapshots.filter((entry) => monthKey(entry.occurredOn) === month);
    const previous = earlier === null ? null : entrySnapshots.filter((entry) => monthKey(entry.occurredOn) === earlier);
    const summary = summarizeMonth({ month, categories: categorySnapshots, entries: current });
    const sentence = suggest({
      currency: household.data.currency,
      categories: categorySnapshots,
      current,
      previous,
    }).sentence;
    const alerts = summary.categories.flatMap((category) =>
      limitThresholds(category.spentMinor, category.limitMinor).map(
        (threshold) => `${category.name} je na ${threshold}% limita`,
      ),
    );
    setView({
      currency: household.data.currency,
      income: formatMoney(summary.incomeMinor, household.data.currency),
      expense: formatMoney(summary.expenseMinor, household.data.currency),
      leftover: formatMoney(summary.leftoverMinor, household.data.currency),
      sentence,
      alerts,
      householdId,
    });
    setStatus("");
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16, backgroundColor: "#f4efe4", flexGrow: 1 }}>
      <Text style={{ fontSize: 13, letterSpacing: 1, color: "#6b6256" }}>DINAR PO DINAR</Text>
      {status ? <Text>{status}</Text> : null}
      {view ? (
        <View style={{ gap: 12 }}>
          <Text>Prihod {view.income}</Text>
          <Text>Trošak {view.expense}</Text>
          <Text>Ostatak {view.leftover}</Text>
          <Text>{view.sentence}</Text>
          {view.alerts.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          <Pressable onPress={() => router.push("/novi")} style={{ backgroundColor: "#1c1915", padding: 14 }}>
            <Text style={{ color: "#f4efe4", textAlign: "center" }}>Novi unos</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/lista")} style={{ padding: 14, borderWidth: 1, borderColor: "#1c1915" }}>
            <Text style={{ textAlign: "center" }}>Lista</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}
