import {
  formatMoney,
  limitState,
  monthKey,
  occurrenceDate,
  suggest,
  summarizeMonth,
  todayInBelgrade,
  type EntrySnapshot,
  type LimitState,
} from "@finance/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Amount, Card, LimitBar, Muted, Notice, Screen, Tag, Title } from "../../components/ui";
import { dayLabel, monthTitle, shiftMonth } from "../../lib/format";
import { loadHousehold } from "../../lib/household";
import { toEntrySnapshot } from "../../lib/rows";
import { supabase } from "../../lib/supabase";
import { colors, space, type } from "../../lib/theme";

type Bar = { id: string; name: string; spent: string; limit: string | null; width: number; state: LimitState; percent: number | null };
type Due = { id: string; name: string; date: string; amount: string; settled: boolean };
type Overview = {
  householdName: string;
  leftover: string;
  leftoverNegative: boolean;
  income: string;
  expense: string;
  sentence: string;
  bars: Bar[];
  due: Due[];
};

export default function OverviewScreen() {
  const router = useRouter();
  const [month, setMonth] = useState(() => monthKey(todayInBelgrade(new Date())));
  const [view, setView] = useState<Overview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await loadHousehold();
    if (result.status === "signed-out") {
      router.replace("/login");
      return;
    }
    if (result.status === "none") {
      setMessage("Domaćinstvo se otvara na vebu. Kad postanete član, povucite ekran nadole.");
      return;
    }
    if (result.status === "error") {
      setMessage("Pregled se ne otvara. Proverite vezu i povucite ekran nadole.");
      return;
    }
    const { household } = result;
    const earlier = shiftMonth(month, -1);
    const [entries, rules] = await Promise.all([
      supabase
        .from("entries")
        .select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on, recurring_rule_id")
        .eq("household_id", household.householdId)
        .in("month_key", earlier === null ? [month] : [month, earlier]),
      supabase
        .from("recurring_rules")
        .select("id, category_id, amount_minor, day_of_month")
        .eq("household_id", household.householdId)
        .eq("active", true),
    ]);
    if (entries.error || rules.error) {
      setMessage("Pregled se ne otvara. Proverite vezu i povucite ekran nadole.");
      return;
    }

    const all = (entries.data ?? []).map((row) => ({ ...toEntrySnapshot(row), ruleId: row.recurring_rule_id as string | null }));
    const current: EntrySnapshot[] = all.filter((entry) => monthKey(entry.occurredOn) === month);
    const previous = earlier === null ? null : all.filter((entry) => monthKey(entry.occurredOn) === earlier);
    const summary = summarizeMonth({ month, categories: household.categories, entries: current });
    const money = (minor: number) => formatMoney(minor, household.currency);

    const bars = summary.categories
      .filter((category) => category.kind === "expense" && category.spentMinor > 0)
      .sort((a, b) => b.spentMinor - a.spentMinor || a.name.localeCompare(b.name, "sr"))
      .map((category) => ({
        id: category.categoryId,
        name: category.name,
        spent: money(category.spentMinor),
        limit: category.limitMinor ? money(category.limitMinor) : null,
        width: category.limitMinor
          ? Math.min(100, Math.round((category.spentMinor * 100) / category.limitMinor))
          : 100,
        state: limitState(category.spentMinor, category.limitMinor),
        percent: category.limitMinor ? Math.floor((category.spentMinor * 100) / category.limitMinor) : null,
      }));

    const [year, monthNumber] = month.split("-").map(Number);
    const settled = new Set(all.filter((entry) => monthKey(entry.occurredOn) === month).map((entry) => entry.ruleId));
    const names = new Map(household.categories.map((category) => [category.id, category.name]));
    const due = (rules.data ?? [])
      .map((rule) => {
        const dueOn = occurrenceDate(year, monthNumber, rule.day_of_month);
        return {
          id: rule.id as string,
          name: names.get(rule.category_id) ?? "Kategorija",
          dueOn,
          date: dayLabel(dueOn),
          amount: money(rule.amount_minor),
          settled: settled.has(rule.id),
        };
      })
      .sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));

    setMessage(null);
    setView({
      householdName: household.name,
      leftover: money(summary.leftoverMinor),
      leftoverNegative: summary.leftoverMinor < 0,
      income: money(summary.incomeMinor),
      expense: money(summary.expenseMinor),
      sentence: suggest({
        currency: household.currency,
        categories: household.categories,
        current,
        previous,
      }).sentence,
      bars,
      due,
    });
  }, [month, router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const before = shiftMonth(month, -1);
  const after = shiftMonth(month, 1);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={styles.header}>
        <Muted>{view?.householdName ?? "Dinar po dinar"}</Muted>
        <View style={styles.stepper}>
          <StepButton label="Prethodni mesec" icon="chevron.left" disabled={!before} onPress={() => before && setMonth(before)} />
          <Text style={styles.month}>{monthTitle(month)}</Text>
          <StepButton label="Sledeći mesec" icon="chevron.right" disabled={!after} onPress={() => after && setMonth(after)} />
        </View>
      </View>

      {message ? <Notice>{message}</Notice> : null}

      {view ? (
        <>
          <Card>
            <Muted>Ostatak</Muted>
            <Amount size="display" tone={view.leftoverNegative ? "over" : "text"}>
              {view.leftover}
            </Amount>
            <View style={styles.figures}>
              <View style={styles.figure}>
                <Muted>Prihod</Muted>
                <Amount>{view.income}</Amount>
              </View>
              <View style={styles.figure}>
                <Muted>Trošak</Muted>
                <Amount>{view.expense}</Amount>
              </View>
            </View>
            <View style={styles.verdict}>
              <Text style={styles.verdictText}>{view.sentence}</Text>
            </View>
          </Card>

          <Card>
            <Title>Kategorije</Title>
            {view.bars.length === 0 ? (
              <Muted>Nema troškova u ovom mesecu.</Muted>
            ) : (
              view.bars.map((bar) => (
                <View key={bar.id} style={styles.bar}>
                  <View style={styles.barHead}>
                    <Text style={styles.name}>{bar.name}</Text>
                    {bar.state === "near" || bar.state === "over" ? (
                      <Tag tone={bar.state}>{`${bar.percent}%`}</Tag>
                    ) : null}
                  </View>
                  <Text style={styles.barAmount}>
                    <Text style={styles.barSpent}>{bar.spent}</Text>
                    {bar.limit ? ` / ${bar.limit}` : ""}
                  </Text>
                  <LimitBar width={bar.width} state={bar.state} />
                </View>
              ))
            )}
          </Card>

          <Card>
            <Title>Uskoro dospeva</Title>
            {view.due.length === 0 ? (
              <Muted>Nema mesečnih ponavljanja.</Muted>
            ) : (
              view.due.map((row) => (
                <View key={row.id} style={styles.dueRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.barName}>
                      <Text style={styles.name}>{row.name}</Text>
                      {row.settled ? <Tag tone="good">Uneto</Tag> : null}
                    </View>
                    <Muted>{row.date}</Muted>
                  </View>
                  <Amount>{row.amount}</Amount>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function StepButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: "chevron.left" | "chevron.right";
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={[styles.step, disabled ? { opacity: 0 } : null]}
    >
      <SymbolView name={icon} tintColor={colors.text} size={16} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs, paddingTop: space.sm, paddingBottom: space.xs },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  month: { ...type.title, color: colors.text },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  figures: { flexDirection: "row", gap: space.xl },
  figure: { gap: 2 },
  verdict: { backgroundColor: colors.bg, borderRadius: 10, padding: space.md },
  verdictText: { ...type.small, color: colors.text },
  bar: { gap: 6 },
  barHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  barName: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  name: { ...type.body, fontWeight: "500", color: colors.text, flexShrink: 1 },
  barAmount: { ...type.caption, color: colors.muted, fontVariant: ["tabular-nums"] },
  barSpent: { color: colors.text, fontWeight: "600" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: space.md },
});
