import { formatMoney, monthKey } from "@finance/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Button, Card, Chip, Chips, Label, Muted, Notice, Screen, Tag } from "../../components/ui";
import { dayLabel, monthTitle } from "../../lib/format";
import { loadHousehold, type Household } from "../../lib/household";
import { supabase } from "../../lib/supabase";
import { colors, space, type } from "../../lib/theme";

type Row = {
  id: string;
  kind: "expense" | "income";
  amount_minor: number;
  category_id: string;
  person_id: string;
  person_name: string;
  occurred_on: string;
  note: string | null;
  recurring_rule_id: string | null;
};

export default function EntriesScreen() {
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [personId, setPersonId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [month, setMonth] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await loadHousehold();
    if (result.status === "signed-out") {
      router.replace("/login");
      return;
    }
    if (result.status !== "ok") {
      setEmpty(result.status === "none");
      setHousehold(null);
      setMessage(result.status === "none" ? null : "Unosi se ne otvaraju. Proverite vezu i povucite ekran nadole.");
      return;
    }
    const entries = await supabase
      .from("entries")
      .select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on, note, recurring_rule_id")
      .eq("household_id", result.household.householdId)
      .order("occurred_on", { ascending: false });
    if (entries.error) {
      setMessage("Unosi se ne otvaraju. Proverite vezu i povucite ekran nadole.");
      return;
    }
    setEmpty(false);
    setMessage(null);
    setHousehold(result.household);
    setRows((entries.data ?? []) as Row[]);
  }, [router]);

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

  const categoryName = new Map(household?.categories.map((category) => [category.id, category.name]) ?? []);
  const usedCategories = [...new Set(rows.map((row) => row.category_id))]
    .map((id) => ({ id, name: categoryName.get(id) ?? "Kategorija" }))
    .sort((a, b) => a.name.localeCompare(b.name, "sr"));
  const people = [...new Map(rows.map((row) => [row.person_id, row.person_name])).entries()];
  const months = [...new Set(rows.map((row) => monthKey(row.occurred_on)))];
  const shown = rows.filter(
    (row) =>
      (!personId || row.person_id === personId) &&
      (!categoryId || row.category_id === categoryId) &&
      (!month || monthKey(row.occurred_on) === month),
  );
  const days: Array<{ date: string; rows: Row[] }> = [];
  for (const row of shown) {
    const last = days[days.length - 1];
    if (last && last.rows[0]?.occurred_on === row.occurred_on) last.rows.push(row);
    else days.push({ date: row.occurred_on, rows: [row] });
  }
  const currency = household?.currency ?? "RSD";

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={styles.header}>
        <Text style={styles.heading}>Unosi</Text>
      </View>
      {message ? <Notice>{message}</Notice> : null}
      {empty ? (
        <Card>
          <Muted>Još nemate domaćinstvo. Otvorite ga ovde, ili prihvatite pozivnicu.</Muted>
          <Button onPress={() => router.push("/novo")}>Otvori domaćinstvo</Button>
          <Button quiet onPress={() => router.push("/poziv")}>Imam pozivnicu</Button>
        </Card>
      ) : null}

      <View style={styles.filters}>
        <Label>Mesec</Label>
        <Chips scroll>
          <Chip on={month === ""} onPress={() => setMonth("")}>Svi</Chip>
          {months.map((key) => (
            <Chip key={key} on={month === key} onPress={() => setMonth(key)}>
              {monthTitle(key)}
            </Chip>
          ))}
        </Chips>
        {people.length > 1 ? (
          <>
            <Label>Osoba</Label>
            <Chips scroll>
              <Chip on={personId === ""} onPress={() => setPersonId("")}>Svi</Chip>
              {people.map(([id, name]) => (
                <Chip key={id} on={personId === id} onPress={() => setPersonId(id)}>
                  {name}
                </Chip>
              ))}
            </Chips>
          </>
        ) : null}
        <Label>Kategorija</Label>
        <Chips scroll>
          <Chip on={categoryId === ""} onPress={() => setCategoryId("")}>Sve</Chip>
          {usedCategories.map((category) => (
            <Chip key={category.id} on={categoryId === category.id} onPress={() => setCategoryId(category.id)}>
              {category.name}
            </Chip>
          ))}
        </Chips>
      </View>

      {household && days.length === 0 ? (
        <Card>
          <Muted>Nema unosa za ovaj izbor.</Muted>
        </Card>
      ) : null}

      {days.map((day) => (
        <View key={day.date} style={{ gap: space.sm }}>
          <Muted style={styles.dayHead}>{dayLabel(day.date)}</Muted>
          <Card style={styles.group}>
            {day.rows.map((row, index) => (
              <Pressable
                key={row.id}
                disabled={household?.role !== "owner"}
                accessibilityRole={household?.role === "owner" ? "button" : undefined}
                onPress={() => router.push(`/unos/${row.id}`)}
                style={[styles.entry, index > 0 ? styles.entryLine : null]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.entryName}>
                    <Text style={styles.name}>{categoryName.get(row.category_id) ?? "Kategorija"}</Text>
                    {row.recurring_rule_id ? <Tag>ponavljanje</Tag> : null}
                  </View>
                  <Muted>{row.note ? `${row.person_name} · ${row.note}` : row.person_name}</Muted>
                </View>
                <Text style={[styles.amount, row.kind === "income" ? { color: colors.accent } : null]}>
                  {`${row.kind === "income" ? "+" : "−"}${formatMoney(row.amount_minor, currency)}`}
                </Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: space.sm },
  heading: { ...type.display, fontSize: 28, lineHeight: 34, color: colors.text },
  filters: { gap: space.sm },
  dayHead: { paddingHorizontal: space.xs, marginTop: space.sm },
  group: { paddingVertical: 0, gap: 0 },
  entry: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  entryLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  entryName: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { ...type.body, fontWeight: "500", color: colors.text },
  amount: { ...type.body, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
});
