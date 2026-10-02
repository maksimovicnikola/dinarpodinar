import { assertRemindDays, todayInBelgrade } from "@finance/domain";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { majorToMinor } from "../lib/rows";
import { supabase } from "../lib/supabase";

type Option = { id: string; name: string; kind?: "expense" | "income" };

export default function NewEntryScreen() {
  const router = useRouter();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Option[]>([]);
  const [people, setPeople] = useState<Option[]>([]);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [personId, setPersonId] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayInBelgrade(new Date()));
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [remindDays, setRemindDays] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      const auth = await supabase.auth.getUser();
      if (!auth.data.user) {
        router.replace("/login");
        return;
      }
      const membership = await supabase.from("memberships").select("household_id").eq("user_id", auth.data.user.id).limit(1).maybeSingle();
      if (!membership.data) return;
      setHouseholdId(membership.data.household_id);
      setPersonId(auth.data.user.id);
      const [categoryRows, memberRows] = await Promise.all([
        supabase.from("categories").select("id, name, kind").eq("household_id", membership.data.household_id).eq("archived", false),
        supabase.from("memberships").select("user_id, profiles(display_name)").eq("household_id", membership.data.household_id),
      ]);
      setCategories((categoryRows.data ?? []) as Option[]);
      setPeople(
        (memberRows.data ?? []).map((row) => {
          const profile = row.profiles as { display_name: string | null } | Array<{ display_name: string | null }> | null;
          const name = Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name;
          return { id: row.user_id, name: name?.trim() || "Član" };
        }),
      );
    })();
  }, [router]);

  const visible = categories.filter((category) => category.kind === kind);

  async function onSubmit() {
    if (!householdId || pending) return;
    setError(null);
    setPending(true);
    try {
      const amountMinor = majorToMinor(amount);
      if (!categoryId || !personId) throw new Error("nedostaje");
      const draft = {
        household_id: householdId,
        kind,
        amount_minor: amountMinor,
        category_id: categoryId,
        person_id: personId,
        occurred_on: occurredOn,
        note,
      };
      if (repeat) {
        const days = Number(remindDays);
        assertRemindDays(days);
        const day = Number(occurredOn.slice(8, 10));
        const created = await supabase.rpc("create_entry_with_rule", {
          p_household_id: householdId,
          p_kind: kind,
          p_amount_minor: amountMinor,
          p_category_id: categoryId,
          p_person_id: personId,
          p_occurred_on: occurredOn,
          p_note: note,
          p_day_of_month: day,
          p_remind_days: days,
          p_request_id: crypto.randomUUID(),
        });
        if (created.error) throw created.error;
      } else {
        const inserted = await supabase.from("entries").insert(draft);
        if (inserted.error) throw inserted.error;
      }
      const session = await supabase.auth.getSession();
      const web = process.env.EXPO_PUBLIC_WEB_URL;
      const token = session.data.session?.access_token;
      if (web && token) {
        await fetch(`${web}/api/alerts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ householdId }),
        });
      }
      router.back();
    } catch {
      setError("Unos nije sačuvan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12, backgroundColor: "#f4efe4" }}>
      <Text style={{ fontSize: 28, color: "#1c1915" }}>Novi unos</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => { setKind("expense"); setCategoryId(""); }}><Text>Trošak</Text></Pressable>
        <Pressable onPress={() => { setKind("income"); setCategoryId(""); }}><Text>Prihod</Text></Pressable>
      </View>
      <Text>{kind === "expense" ? "Trošak" : "Prihod"}</Text>
      <TextInput value={amount} onChangeText={setAmount} placeholder="Iznos" keyboardType="decimal-pad" style={field} />
      {visible.map((category) => (
        <Pressable key={category.id} onPress={() => setCategoryId(category.id)}>
          <Text>{categoryId === category.id ? `• ${category.name}` : category.name}</Text>
        </Pressable>
      ))}
      {people.map((person) => (
        <Pressable key={person.id} onPress={() => setPersonId(person.id)}>
          <Text>{personId === person.id ? `• ${person.name}` : person.name}</Text>
        </Pressable>
      ))}
      <TextInput value={occurredOn} onChangeText={setOccurredOn} placeholder="YYYY-MM-DD" style={field} />
      <TextInput value={note} onChangeText={setNote} placeholder="Beleška" style={field} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text>Ponavljaj svakog meseca</Text>
        <Switch value={repeat} onValueChange={setRepeat} />
      </View>
      {repeat ? <TextInput value={remindDays} onChangeText={setRemindDays} placeholder="Dana ranije" keyboardType="number-pad" style={field} /> : null}
      {error ? <Text style={{ color: "#8a2b1b" }}>{error}</Text> : null}
      <Pressable onPress={() => void onSubmit()} disabled={pending} style={{ backgroundColor: "#1c1915", padding: 14 }}>
        <Text style={{ color: "#f4efe4", textAlign: "center" }}>{pending ? "Čuvam…" : "Sačuvaj"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const field = { borderBottomWidth: 1, borderColor: "#1c1915", paddingVertical: 8, fontSize: 18 };
