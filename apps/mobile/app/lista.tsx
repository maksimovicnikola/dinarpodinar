import { formatMoney, monthKey } from "@finance/domain";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { supabase } from "../lib/supabase";

type Row = {
  id: string;
  kind: "expense" | "income";
  amount_minor: number;
  category_id: string;
  person_id: string;
  person_name: string;
  occurred_on: string;
};

export default function ListScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [currency, setCurrency] = useState("RSD");
  const [personId, setPersonId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const auth = await supabase.auth.getUser();
      if (!auth.data.user) {
        router.replace("/login");
        return;
      }
      const membership = await supabase.from("memberships").select("household_id").eq("user_id", auth.data.user.id).limit(1).maybeSingle();
      if (!membership.data) return;
      const householdId = membership.data.household_id;
      const [household, categoryRows, entryRows] = await Promise.all([
        supabase.from("households").select("currency").eq("id", householdId).maybeSingle(),
        supabase.from("categories").select("id, name").eq("household_id", householdId),
        supabase
          .from("entries")
          .select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on")
          .eq("household_id", householdId)
          .order("occurred_on", { ascending: false }),
      ]);
      if (household.error || categoryRows.error || entryRows.error) {
        setError("Lista se ne otvara.");
        return;
      }
      setCurrency(household.data?.currency ?? "RSD");
      setCategories(categoryRows.data ?? []);
      setRows((entryRows.data ?? []) as Row[]);
    })();
  }, [router]);

  const people = [...new Map(rows.map((row) => [row.person_id, row.person_name])).entries()];
  const months = [...new Set(rows.map((row) => monthKey(row.occurred_on)))];
  const shown = rows.filter((row) => {
    if (personId && row.person_id !== personId) return false;
    if (categoryId && row.category_id !== categoryId) return false;
    if (month && monthKey(row.occurred_on) !== month) return false;
    return true;
  });
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 10, backgroundColor: "#f4efe4" }}>
      <Text style={{ fontSize: 28, color: "#1c1915" }}>Lista</Text>
      {error ? <Text>{error}</Text> : null}
      <Text>Osoba</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable onPress={() => setPersonId("")}><Text>{personId === "" ? "• Svi" : "Svi"}</Text></Pressable>
        {people.map(([id, name]) => (
          <Pressable key={id} onPress={() => setPersonId(id)}>
            <Text>{personId === id ? `• ${name}` : name}</Text>
          </Pressable>
        ))}
      </View>
      <Text>Kategorija</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable onPress={() => setCategoryId("")}><Text>{categoryId === "" ? "• Sve" : "Sve"}</Text></Pressable>
        {categories.map((category) => (
          <Pressable key={category.id} onPress={() => setCategoryId(category.id)}>
            <Text>{categoryId === category.id ? `• ${category.name}` : category.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text>Mesec</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable onPress={() => setMonth("")}><Text>{month === "" ? "• Svi" : "Svi"}</Text></Pressable>
        {months.map((key) => (
          <Pressable key={key} onPress={() => setMonth(key)}>
            <Text>{month === key ? `• ${key}` : key}</Text>
          </Pressable>
        ))}
      </View>
      {shown.map((row) => (
        <View key={row.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: "#d9d0c3" }}>
          <Text>{row.occurred_on}</Text>
          <Text>{categoryName.get(row.category_id) ?? "Kategorija"}</Text>
          <Text>{row.person_name}</Text>
          <Text>{formatMoney(row.amount_minor, currency)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
