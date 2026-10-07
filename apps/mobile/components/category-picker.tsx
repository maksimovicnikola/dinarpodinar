import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";

import { Input, Muted } from "./ui";
import { colors, radius, space, type } from "../lib/theme";

export type SelectableCategory = { id: string; name: string; archived?: boolean };

export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  emptyMessage = "Nema dostupnih kategorija.",
}: {
  categories: SelectableCategory[];
  selectedId: string;
  onSelect: (categoryId: string) => void;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = categories.find((category) => category.id === selectedId);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("sr");
    return categories.filter((category) =>
      (category.archived ? `${category.name} arhivirana` : category.name)
        .toLocaleLowerCase("sr")
        .includes(normalizedQuery),
    );
  }, [categories, query]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      {categories.length === 0 ? (
        <Muted>{emptyMessage}</Muted>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Kategorija: ${selected ? categoryLabel(selected) : "nije izabrana"}`}
          accessibilityHint="Otvara pretragu kategorija"
          onPress={() => {
            setQuery("");
            setOpen(true);
          }}
          style={styles.select}
        >
          <Text style={styles.selectText}>
            {selected ? categoryLabel(selected) : "Izaberite kategoriju"}
          </Text>
          <Text style={styles.chevron}>⌄</Text>
        </Pressable>
      )}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          <Pressable
            accessibilityLabel="Zatvori izbor kategorije"
            style={StyleSheet.absoluteFill}
            onPress={close}
          />
          <KeyboardAvoidingView behavior="padding" style={styles.sheetWrap}>
            <View style={styles.sheet} accessibilityViewIsModal>
              <View style={styles.heading}>
                <Text style={styles.title}>Izaberite kategoriju</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Zatvori"
                  hitSlop={8}
                  onPress={close}
                  style={styles.close}
                >
                  <SymbolView name="xmark" tintColor={colors.muted} size={14} weight="bold" />
                </Pressable>
              </View>
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder="Pretraži kategorije"
                autoFocus
                accessibilityLabel="Pretraži kategorije"
                returnKeyType="search"
              />
              <FlatList
                style={styles.list}
                data={filtered}
                keyExtractor={(category) => category.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={7}
                ListEmptyComponent={<Muted>Kategorija nije pronađena.</Muted>}
                renderItem={({ item }) => {
                  const isSelected = item.id === selectedId;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => {
                        onSelect(item.id);
                        close();
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        isSelected ? styles.optionSelected : null,
                        pressed ? styles.optionPressed : null,
                      ]}
                    >
                      <Text style={styles.optionText}>{categoryLabel(item)}</Text>
                      {isSelected ? <Text style={styles.check}>✓</Text> : null}
                    </Pressable>
                  );
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

function categoryLabel(category: SelectableCategory): string {
  return category.archived ? `${category.name} (arhivirana)` : category.name;
}

const styles = StyleSheet.create({
  select: {
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
  selectText: { ...type.body, flex: 1, color: colors.text },
  chevron: { fontSize: 22, color: colors.muted, marginTop: -5 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20, 23, 28, 0.4)" },
  sheetWrap: { width: "100%", height: "82%", justifyContent: "flex-end" },
  sheet: {
    height: "100%",
    gap: space.md,
    padding: space.lg,
    paddingBottom: space.xl,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  title: { ...type.title, color: colors.text },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flex: 1 },
  option: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  optionSelected: { backgroundColor: colors.accentSoft },
  optionPressed: { opacity: 0.7 },
  optionText: { ...type.body, color: colors.text },
  check: { ...type.body, color: colors.accent, fontWeight: "700" },
});
