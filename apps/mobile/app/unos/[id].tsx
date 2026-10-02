import { todayInBelgrade } from "@finance/domain";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { BackTitle, Button, Card, Chip, Chips, Input, Label, Muted, Notice, Screen } from "../../components/ui";
import { dayLabel } from "../../lib/format";
import { loadHousehold, type Household } from "../../lib/household";
import { explain, minorToInput, moneyOrEmpty } from "../../lib/manage";
import { supabase } from "../../lib/supabase";
import { colors, radius, space, type } from "../../lib/theme";

type Entry = {
  id: string;
  kind: "expense" | "income";
  amountMinor: number;
  categoryId: string;
  personId: string;
  personName: string;
  occurredOn: string;
  note: string;
};

export default function EditEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const entryId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [household, setHousehold] = useState<Household | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [personId, setPersonId] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [note, setNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pickerDate = useMemo(() => belgradeNoon(occurredOn || todayInBelgrade(new Date())), [occurredOn]);

  useEffect(() => {
    void (async () => {
      const result = await loadHousehold();
      if (result.status === "signed-out") {
        router.replace("/login");
        return;
      }
      if (result.status !== "ok") {
        setError("Unos se ne otvara. Proverite vezu.");
        return;
      }
      if (result.household.role !== "owner") {
        setError("Unos menja samo vlasnik domaćinstva.");
        setHousehold(result.household);
        return;
      }
      const row = await supabase
        .from("entries")
        .select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on, note")
        .eq("id", entryId)
        .eq("household_id", result.household.householdId)
        .maybeSingle();
      if (row.error || !row.data) {
        setError("Ovaj unos više nije tu.");
        return;
      }
      const loaded: Entry = {
        id: row.data.id,
        kind: row.data.kind,
        amountMinor: row.data.amount_minor,
        categoryId: row.data.category_id,
        personId: row.data.person_id,
        personName: row.data.person_name,
        occurredOn: row.data.occurred_on,
        note: row.data.note ?? "",
      };
      setHousehold(result.household);
      setEntry(loaded);
      setAmount(minorToInput(loaded.amountMinor));
      setCategoryId(loaded.categoryId);
      setPersonId(loaded.personId);
      setOccurredOn(loaded.occurredOn);
      setNote(loaded.note);
    })();
  }, [entryId, router]);

  const categories = (household?.categories ?? []).filter(
    (category) => category.kind === entry?.kind && (!category.archived || category.id === entry.categoryId),
  );
  const people = household?.people ?? [];
  const former = entry && !people.some((person) => person.id === entry.personId);

  async function onSave() {
    if (!household || !entry || pending) return;
    const money = moneyOrEmpty(amount);
    if (!money.ok || money.value === null) {
      setError("Upišite iznos, na primer 4.200 ili 12,50.");
      return;
    }
    if (note.trim().length > 120) {
      setError("Beleška može imati najviše 120 znakova.");
      return;
    }
    setPending(true);
    setError(null);
    const saved = await supabase
      .from("entries")
      .update({
        amount_minor: money.value,
        category_id: categoryId,
        person_id: personId,
        occurred_on: occurredOn,
        note: note.trim(),
      })
      .eq("id", entry.id)
      .eq("household_id", household.householdId)
      .select("id");
    setPending(false);
    if (saved.error) {
      setError(explain(saved.error.message));
      return;
    }
    if ((saved.data ?? []).length === 0) {
      setError("Ovaj unos više nije tu.");
      return;
    }
    router.back();
  }

  async function onDelete() {
    if (!household || !entry || pending || !confirmDelete) return;
    setPending(true);
    setError(null);
    const removed = await supabase.from("entries").delete().eq("id", entry.id).eq("household_id", household.householdId).select("id");
    setPending(false);
    if (removed.error) {
      setError(explain(removed.error.message));
      return;
    }
    if ((removed.data ?? []).length === 0) {
      setError("Ovaj unos više nije tu.");
      return;
    }
    router.back();
  }

  return (
    <Screen
      footer={
        entry ? (
          <Button onPress={() => void onSave()} disabled={pending}>
            {pending ? "Čuvam…" : "Sačuvaj izmenu"}
          </Button>
        ) : undefined
      }
    >
      <BackTitle title="Izmena unosa" onBack={() => router.back()} />
      {error ? <Notice>{error}</Notice> : null}
      {entry ? (
        <>
          <Muted>{entry.kind === "expense" ? "Trošak" : "Prihod"}. Vrsta se ne menja.</Muted>
          <Card>
            <Label>Iznos</Label>
            <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Label>Kategorija</Label>
            <Chips>
              {categories.map((category) => (
                <Chip key={category.id} on={categoryId === category.id} onPress={() => setCategoryId(category.id)}>
                  {category.archived ? `${category.name} (arhivirana)` : category.name}
                </Chip>
              ))}
            </Chips>
            <Label>Ko</Label>
            <Chips>
              {former ? (
                <Chip on={personId === entry.personId} onPress={() => setPersonId(entry.personId)}>
                  {`${entry.personName} (više nije član)`}
                </Chip>
              ) : null}
              {people.map((person) => (
                <Chip key={person.id} on={personId === person.id} onPress={() => setPersonId(person.id)}>
                  {person.name}
                </Chip>
              ))}
            </Chips>
            <Label>Datum</Label>
            <Pressable accessibilityRole="button" onPress={() => setPickerOpen(true)} style={styles.dateButton}>
              <Text style={styles.dateText}>{dayLabel(occurredOn)}</Text>
            </Pressable>
            <Label>Beleška</Label>
            <Input value={note} onChangeText={setNote} placeholder="Nije obavezno" maxLength={120} />
          </Card>
          <Card>
            <View style={styles.row}>
              <Text style={styles.deleteLabel}>Razumem da se unos briše zauvek</Text>
              <Switch value={confirmDelete} onValueChange={setConfirmDelete} trackColor={{ true: colors.over }} />
            </View>
            <Muted>Brisanje se ne može poništiti. Mesečni zbir se menja odmah.</Muted>
            <Button quiet disabled={!confirmDelete || pending} onPress={() => void onDelete()}>
              Obriši unos
            </Button>
          </Card>
        </>
      ) : null}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable accessibilityLabel="Zatvori kalendar" style={StyleSheet.absoluteFill} onPress={() => setPickerOpen(false)} />
          <View style={styles.calendar}>
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display="inline"
              locale="sr-Latn"
              timeZoneName="Europe/Belgrade"
              themeVariant="light"
              accentColor={colors.accent}
              onValueChange={(_event, date) => {
                setOccurredOn(todayInBelgrade(date));
                setPickerOpen(false);
              }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function belgradeNoon(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 10));
}

const styles = StyleSheet.create({
  dateButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    justifyContent: "center",
  },
  dateText: { ...type.small, fontWeight: "600", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  deleteLabel: { ...type.body, color: colors.text, flex: 1 },
  backdrop: { flex: 1, justifyContent: "center", padding: space.lg, backgroundColor: "rgba(20, 23, 28, 0.4)" },
  calendar: { backgroundColor: colors.surface, borderRadius: radius.card, overflow: "hidden", minHeight: 360 },
});
