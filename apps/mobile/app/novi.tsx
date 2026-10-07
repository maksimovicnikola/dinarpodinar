import { addCalendarDays, assertRemindDays, todayInBelgrade } from "@finance/domain";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button, Chip, Chips, Input, Label, Muted, Notice, Screen, Segmented } from "../components/ui";
import { dayLabel } from "../lib/format";
import { loadHousehold, type Household } from "../lib/household";
import { newRequestId } from "../lib/request-id";
import { majorToMinor } from "../lib/rows";
import { supabase } from "../lib/supabase";
import { colors, radius, space, type } from "../lib/theme";

type Kind = "expense" | "income";
type When = "today" | "yesterday" | "other";

export default function NewEntryScreen() {
  const router = useRouter();
  const today = todayInBelgrade(new Date());
  const yesterday = addCalendarDays(today, -1);
  const [household, setHousehold] = useState<Household | null>(null);
  const [kind, setKind] = useState<Kind>("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [when, setWhen] = useState<When>("today");
  const [otherDay, setOtherDay] = useState(today);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerReadyAt = useRef(0);
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [remindDays, setRemindDays] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await loadHousehold();
      if (result.status === "signed-out") {
        router.replace("/login");
        return;
      }
      if (result.status !== "ok") {
        setError("Domaćinstvo se ne otvara. Proverite vezu.");
        return;
      }
      setHousehold(result.household);
      setPersonId(result.household.userId);
    })();
  }, [router]);

  const visible = (household?.categories ?? [])
    .filter((category) => category.kind === kind && !category.archived)
    .sort((a, b) => a.name.localeCompare(b.name, "sr"));
  const selectedCategory = visible.find((category) => category.id === categoryId);
  const filteredCategories = visible.filter((category) =>
    category.name.toLocaleLowerCase("sr").includes(categoryQuery.trim().toLocaleLowerCase("sr")),
  );
  const occurredOn = when === "today" ? today : when === "yesterday" ? yesterday : otherDay;
  const pickerDate = useMemo(() => belgradeNoon(otherDay), [otherDay]);

  function chooseKind(next: Kind) {
    setKind(next);
    setCategoryId("");
  }

  function openPicker() {
    pickerReadyAt.current = Date.now() + 400;
    setWhen("other");
    setPickerOpen(true);
  }

  function chooseDate(date: Date) {
    setOtherDay(todayInBelgrade(date));
    if (Date.now() < pickerReadyAt.current) return;
    setPickerOpen(false);
  }

  async function onSubmit() {
    if (!household || pending) return;
    setError(null);
    let amountMinor: number;
    try {
      amountMinor = majorToMinor(amount);
    } catch {
      setError("Upišite iznos, na primer 4.200 ili 12,50.");
      return;
    }
    if (!categoryId) {
      setError("Izaberite kategoriju.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
      setError("Izaberite datum.");
      return;
    }
    setPending(true);
    try {
      if (repeat) {
        assertRemindDays(remindDays);
        const created = await supabase.rpc("create_entry_with_rule", {
          p_household_id: household.householdId,
          p_kind: kind,
          p_amount_minor: amountMinor,
          p_category_id: categoryId,
          p_person_id: personId,
          p_occurred_on: occurredOn,
          p_note: note,
          p_day_of_month: Number(occurredOn.slice(8, 10)),
          p_remind_days: remindDays,
          p_request_id: newRequestId(),
        });
        if (created.error) throw created.error;
      } else {
        const inserted = await supabase.from("entries").insert({
          household_id: household.householdId,
          kind,
          amount_minor: amountMinor,
          category_id: categoryId,
          person_id: personId,
          occurred_on: occurredOn,
          note,
        });
        if (inserted.error) throw inserted.error;
      }
      const session = await supabase.auth.getSession();
      const web = process.env.EXPO_PUBLIC_WEB_URL;
      const token = session.data.session?.access_token;
      if (web && token) {
        const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(4000) : undefined;
        void fetch(`${web}/api/alerts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ householdId: household.householdId }),
          signal,
        }).catch(() => undefined);
      }
      router.dismissTo("/");
    } catch {
      setError("Unos nije sačuvan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen
        footer={
          <Button onPress={() => void onSubmit()} disabled={pending || !household}>
            {pending ? "Čuvam…" : "Sačuvaj"}
          </Button>
        }
      >
        <View style={styles.top}>
          <Text style={styles.heading}>Novi unos</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Zatvori" hitSlop={10} onPress={() => router.back()} style={styles.close}>
            <SymbolView name="xmark" tintColor={colors.muted} size={14} weight="bold" />
          </Pressable>
        </View>

        <Segmented<Kind>
          options={[
            { value: "expense", label: "Trošak" },
            { value: "income", label: "Prihod" },
          ]}
          value={kind}
          onChange={chooseKind}
        />

        <View style={styles.amountBox}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor="#B5BBC3"
            keyboardType="decimal-pad"
            autoFocus
            accessibilityLabel="Iznos"
            style={styles.amount}
          />
          <Text style={styles.currency}>{household?.currency ?? "RSD"}</Text>
        </View>

        <View style={styles.section}>
          <Label>Kategorija</Label>
          {visible.length === 0 ? (
            <Muted>Kategorije se dodaju u Podešavanjima.</Muted>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Kategorija: ${selectedCategory?.name ?? "nije izabrana"}`}
              accessibilityHint="Otvara pretragu kategorija"
              onPress={() => {
                setCategoryQuery("");
                setCategoryPickerOpen(true);
              }}
              style={styles.categorySelect}
            >
              <Text style={[styles.categorySelectText, !selectedCategory ? styles.categoryPlaceholder : null]}>
                {selectedCategory?.name ?? "Izaberite kategoriju"}
              </Text>
              <Text style={styles.categoryChevron}>⌄</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <Label>Beleška</Label>
          <Input value={note} onChangeText={setNote} placeholder="Nije obavezno" />
        </View>

        <View style={styles.section}>
          <Label>Datum</Label>
          <Chips>
            <Chip on={when === "today"} onPress={() => setWhen("today")}>Danas</Chip>
            <Chip on={when === "yesterday"} onPress={() => setWhen("yesterday")}>Juče</Chip>
            <Chip on={when === "other"} onPress={openPicker}>Drugi dan</Chip>
          </Chips>
          {when === "other" ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Promeni datum" onPress={openPicker} style={styles.dateButton}>
              <Text style={styles.dateButtonText}>{dayLabel(otherDay)}</Text>
            </Pressable>
          ) : (
            <Muted>{dayLabel(occurredOn)}</Muted>
          )}
        </View>

        {household && household.people.length > 1 ? (
          <View style={styles.section}>
            <Label>Osoba</Label>
            <Chips>
              {household.people.map((person) => (
                <Chip key={person.id} on={personId === person.id} onPress={() => setPersonId(person.id)}>
                  {person.name}
                </Chip>
              ))}
            </Chips>
          </View>
        ) : null}

        <View style={styles.repeat}>
          <View style={styles.repeatRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.repeatTitle}>Ponavljaj svakog meseca</Text>
              <Muted>{`Svakog ${Number(occurredOn.slice(8, 10)) || "—"}. u mesecu`}</Muted>
            </View>
            <Switch value={repeat} onValueChange={setRepeat} trackColor={{ true: colors.accent }} />
          </View>
          {repeat ? (
            <View style={[styles.repeatRow, styles.repeatLine]}>
              <Text style={[styles.repeatTitle, { flex: 1 }]}>Podseti me ranije</Text>
              <View style={styles.stepper}>
                <StepButton icon="minus" label="Dan manje" disabled={remindDays <= 1} onPress={() => setRemindDays(remindDays - 1)} />
                <Text style={styles.stepValue}>{remindDays === 1 ? "1 dan" : `${remindDays} dana`}</Text>
                <StepButton icon="plus" label="Dan više" disabled={remindDays >= 7} onPress={() => setRemindDays(remindDays + 1)} />
              </View>
            </View>
          ) : null}
        </View>

        {error ? <Notice>{error}</Notice> : null}
      </Screen>
      <Modal
        visible={categoryPickerOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setCategoryPickerOpen(false)}
      >
        <View style={styles.categoryBackdrop}>
          <Pressable
            accessibilityLabel="Zatvori izbor kategorije"
            style={StyleSheet.absoluteFill}
            onPress={() => setCategoryPickerOpen(false)}
          />
          <KeyboardAvoidingView behavior="padding" style={styles.categorySheetWrap}>
            <View style={styles.categorySheet} accessibilityViewIsModal>
              <View style={styles.categorySheetHeading}>
                <Text style={styles.categorySheetTitle}>Izaberite kategoriju</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Zatvori"
                  hitSlop={8}
                  onPress={() => setCategoryPickerOpen(false)}
                  style={styles.close}
                >
                  <SymbolView name="xmark" tintColor={colors.muted} size={14} weight="bold" />
                </Pressable>
              </View>
              <Input
                value={categoryQuery}
                onChangeText={setCategoryQuery}
                placeholder="Pretraži kategorije"
                autoFocus
                accessibilityLabel="Pretraži kategorije"
                returnKeyType="search"
              />
              <FlatList
                style={styles.categoryList}
                data={filteredCategories}
                keyExtractor={(category) => category.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={7}
                ListEmptyComponent={<Muted>Kategorija nije pronađena.</Muted>}
                renderItem={({ item }) => {
                  const selected = item.id === categoryId;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setCategoryId(item.id);
                        setCategoryPickerOpen(false);
                        setCategoryQuery("");
                      }}
                      style={({ pressed }) => [
                        styles.categoryOption,
                        selected ? styles.categoryOptionSelected : null,
                        pressed ? styles.categoryOptionPressed : null,
                      ]}
                    >
                      <Text style={styles.categoryOptionText}>{item.name}</Text>
                      {selected ? <Text style={styles.categoryCheck}>✓</Text> : null}
                    </Pressable>
                  );
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
              onValueChange={(_event, date) => chooseDate(date)}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

/** 10:00 UTC je uvek isti kalendarski dan u Beogradu, i zimi i leti. */
function belgradeNoon(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 10));
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "minus" | "plus";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.step, disabled ? { opacity: 0.35 } : null]}
    >
      <SymbolView name={icon} tintColor={colors.text} size={13} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: space.sm },
  heading: { ...type.title, color: colors.text },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  amountBox: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: space.sm, paddingVertical: space.lg },
  amount: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: "600",
    color: colors.text,
    fontVariant: ["tabular-nums"],
    minWidth: 60,
    textAlign: "center",
  },
  currency: { ...type.body, color: colors.muted, fontWeight: "500" },
  section: { gap: space.sm },
  categorySelect: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  categorySelectText: { ...type.body, flex: 1, color: colors.text },
  categoryPlaceholder: { color: colors.muted },
  categoryChevron: { fontSize: 22, color: colors.muted, marginTop: -5 },
  categoryBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20, 23, 28, 0.4)",
  },
  categorySheetWrap: { width: "100%", height: "82%", justifyContent: "flex-end" },
  categorySheet: {
    height: "100%",
    gap: space.md,
    padding: space.lg,
    paddingBottom: space.xl,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  categoryList: { flex: 1 },
  categorySheetHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  categorySheetTitle: { ...type.title, color: colors.text },
  categoryOption: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  categoryOptionSelected: { backgroundColor: colors.accentSoft },
  categoryOptionPressed: { opacity: 0.7 },
  categoryOptionText: { ...type.body, color: colors.text },
  categoryCheck: { ...type.body, color: colors.accent, fontWeight: "700" },
  dateButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  dateButtonText: { ...type.small, fontWeight: "600", color: colors.text },
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: space.lg,
    backgroundColor: "rgba(20, 23, 28, 0.4)",
  },
  calendar: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: "hidden",
    minHeight: 360,
  },
  repeat: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
  },
  repeatRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  repeatLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  repeatTitle: { ...type.body, color: colors.text },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  step: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { ...type.small, fontWeight: "600", color: colors.text, minWidth: 52, textAlign: "center", fontVariant: ["tabular-nums"] },
});
