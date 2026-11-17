import {
  formatMoney,
  todayInBelgrade,
  unpaidReminders,
  type RecurrenceCadence,
} from "@finance/domain";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { dayLabel } from "../lib/format";
import { loadHousehold } from "../lib/household";
import { confirmOccurrence } from "../lib/manage";
import { notifyEntriesChanged } from "../lib/refresh";
import { supabase } from "../lib/supabase";
import { colors, radius, space, type } from "../lib/theme";
import { Button, Muted } from "./ui";

type Prompt = {
  ruleId: string;
  month: string;
  kind: "expense" | "income";
  name: string;
  amount: string;
  dueOn: string;
};

const STORAGE_KEY = "due_reminder_day";
const claimed = new Set<string>();

async function seenDay(householdId: string): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[householdId] ?? null;
  } catch {
    return null;
  }
}

async function rememberDay(householdId: string, today: string) {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[householdId] = today;
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Isti dan može ponovo da pita ako se dan ne sačuva.
  }
}

function neighborMonths(today: string): string[] {
  const [year, month] = today.split("-").map(Number);
  return [-1, 0, 1].map((delta) => {
    const index = year * 12 + (month - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

export function DueReminder() {
  const [items, setItems] = useState<Prompt[]>([]);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const today = todayInBelgrade(new Date());
      const result = await loadHousehold();
      if (cancelled || result.status !== "ok") return;
      const household = result.household;
      const claim = `${household.householdId}:${today}`;
      if (claimed.has(claim) || (await seenDay(household.householdId)) === today) return;

      const [rules, entries] = await Promise.all([
        supabase
          .from("recurring_rules")
          .select("id, kind, category_id, amount_minor, day_of_month, remind_days, cadence, month_of_year")
          .eq("household_id", household.householdId)
          .eq("active", true),
        supabase
          .from("entries")
          .select("recurring_rule_id, month_key")
          .eq("household_id", household.householdId)
          .in("month_key", neighborMonths(today))
          .not("recurring_rule_id", "is", null),
      ]);
      if (cancelled || rules.error || entries.error) return;
      if (claimed.has(claim) || (await seenDay(household.householdId)) === today) return;

      const names = new Map(household.categories.map((category) => [category.id, category.name]));
      const settled = new Set(
        (entries.data ?? [])
          .filter((row) => row.recurring_rule_id)
          .map((row) => `${row.recurring_rule_id}:${row.month_key}`),
      );
      const due = unpaidReminders(
        today,
        (rules.data ?? []).map((rule) => ({
          id: rule.id as string,
          dayOfMonth: rule.day_of_month as number,
          remindDays: rule.remind_days as number,
          cadence: (rule.cadence === "yearly" ? "yearly" : "monthly") as RecurrenceCadence,
          monthOfYear: rule.month_of_year as number | null,
        })),
        settled,
      );
      const byId = new Map((rules.data ?? []).map((rule) => [rule.id as string, rule]));
      const prompts: Prompt[] = due.flatMap((row) => {
        const rule = byId.get(row.ruleId);
        if (!rule) return [];
        return [{
          ruleId: row.ruleId,
          month: row.month,
          kind: rule.kind === "income" ? "income" : "expense",
          name: names.get(rule.category_id) ?? "Kategorija",
          amount: formatMoney(rule.amount_minor as number, household.currency),
          dueOn: row.occurrence,
        }];
      });
      if (cancelled || prompts.length === 0) return;
      claimed.add(claim);
      await rememberDay(household.householdId, today);
      if (cancelled) return;
      setHouseholdId(household.householdId);
      setItems(prompts);
      setOpen(true);
    }

    void check();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") void check();
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  async function confirm(item: Prompt) {
    if (!householdId || pendingId) return;
    setPendingId(item.ruleId);
    setError(null);
    const result = await confirmOccurrence(householdId, item.ruleId, item.month);
    setPendingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    notifyEntriesChanged();
    let remaining = 0;
    setItems((current) => {
      const next = current.filter((row) => !(row.ruleId === item.ruleId && row.month === item.month));
      remaining = next.length;
      return next;
    });
    if (remaining === 0) setOpen(false);
  }

  const today = todayInBelgrade(new Date());

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Kasnije" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <View style={styles.dialog}>
          <Text style={styles.title}>Imaš dospeća koja nisu uneta</Text>
          <Muted>Potvrda upisuje iznos u spisak. Kasnije ostavlja dospeće za sutra, a danas se ovaj prozor više ne otvara.</Muted>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {items.map((item) => (
              <View key={`${item.ruleId}:${item.month}`} style={styles.item}>
                <View style={styles.itemText}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Muted>{item.dueOn <= today ? "Dospelo" : "Dospeva"} {dayLabel(item.dueOn)}</Muted>
                  <Text style={styles.amount}>{item.amount}</Text>
                </View>
                <Button disabled={pendingId !== null} onPress={() => void confirm(item)}>
                  {pendingId === item.ruleId ? "Unosim…" : item.kind === "income" ? "Primljeno" : "Plaćeno"}
                </Button>
              </View>
            ))}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button quiet disabled={pendingId !== null} onPress={() => setOpen(false)}>
            Kasnije
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: space.lg,
    backgroundColor: "rgba(20, 23, 28, 0.4)",
  },
  dialog: {
    gap: space.md,
    maxHeight: "80%",
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  title: { ...type.title, color: colors.text },
  list: { flexGrow: 0 },
  listContent: { gap: space.md },
  item: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  itemText: { gap: 2 },
  name: { ...type.body, fontWeight: "600", color: colors.text },
  amount: { ...type.body, color: colors.text, fontVariant: ["tabular-nums"] },
  error: { ...type.caption, color: colors.over },
});
