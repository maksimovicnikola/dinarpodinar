import type { LimitState } from "@finance/domain";
import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, meterColor, radius, space, type } from "../lib/theme";

export function Screen({
  children,
  refreshControl,
  footer,
}: {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Amount({
  children,
  size = "body",
  tone = "text",
}: {
  children: ReactNode;
  size?: "small" | "body" | "title" | "display";
  tone?: "text" | "over";
}) {
  return (
    <Text
      style={[
        type[size],
        styles.amount,
        size === "body" || size === "small" ? styles.amountStrong : null,
        tone === "over" ? { color: colors.over } : null,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  children,
  onPress,
  quiet = false,
  disabled = false,
}: {
  children: string;
  onPress: () => void;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        quiet ? styles.buttonQuiet : styles.buttonPrimary,
        pressed && !disabled ? { opacity: 0.85 } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={[styles.buttonText, quiet ? { color: colors.text } : null]}>{children}</Text>
    </Pressable>
  );
}

export function Chip({
  children,
  on,
  onPress,
}: {
  children: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on ? styles.chipOn : null]}
    >
      <Text style={[styles.chipText, on ? { color: "#FFFFFF" } : null]}>{children}</Text>
    </Pressable>
  );
}

export function Chips({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {children}
      </ScrollView>
    );
  }
  return <View style={styles.chipsWrap}>{children}</View>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, on ? styles.segmentOn : null]}
          >
            <Text style={[styles.segmentText, on ? { color: colors.text } : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor="#9AA1AA" {...props} style={[styles.input, props.style]} />;
}

export function Notice({ children, tone = "bad" }: { children: ReactNode; tone?: "bad" | "good" }) {
  return (
    <View style={[styles.notice, tone === "good" ? styles.noticeGood : styles.noticeBad]}>
      <Text style={{ ...type.small, color: tone === "good" ? colors.accentStrong : "#9A2B22" }}>{children}</Text>
    </View>
  );
}

/** Traka limita; crtica na 80% je prag upozorenja. */
export function LimitBar({ width, state }: { width: number; state: LimitState }) {
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.meterFill, { width: `${width}%`, backgroundColor: meterColor[state] }]} />
      {state === "free" ? null : <View style={styles.meterTick} />}
    </View>
  );
}

export function Tag({ children, tone = "quiet" }: { children: string; tone?: "quiet" | "near" | "over" | "good" }) {
  const palette = {
    quiet: [colors.soft, colors.muted],
    near: [colors.nearSoft, "#8A5A12"],
    over: [colors.overSoft, "#9A2B22"],
    good: [colors.accentSoft, colors.accentStrong],
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: palette[0] }]}>
      <Text style={[styles.tagText, { color: palette[1] }]}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 120, gap: space.md },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
  },
  title: { ...type.title, color: colors.text },
  muted: { ...type.caption, color: colors.muted },
  label: { ...type.caption, fontWeight: "600", color: colors.text },
  amount: { color: colors.text, fontVariant: ["tabular-nums"] },
  amountStrong: { fontWeight: "600" },
  button: {
    minHeight: 50,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonQuiet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  buttonText: { ...type.body, fontWeight: "600", color: "#FFFFFF" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chipsRow: { flexDirection: "row", gap: space.sm, paddingRight: space.lg },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { ...type.small, fontWeight: "500", color: colors.text },
  segmented: { flexDirection: "row", backgroundColor: colors.soft, borderRadius: radius.control, padding: 3 },
  segment: { flex: 1, minHeight: 38, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segmentOn: {
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentText: { ...type.small, fontWeight: "600", color: colors.muted },
  input: {
    ...type.body,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  notice: { borderRadius: radius.control, padding: space.md },
  noticeBad: { backgroundColor: colors.overSoft },
  noticeGood: { backgroundColor: colors.accentSoft },
  meter: { height: 8, borderRadius: radius.pill, backgroundColor: colors.soft, justifyContent: "center" },
  meterFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: radius.pill },
  meterTick: {
    position: "absolute",
    left: "80%",
    top: -3,
    bottom: -3,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
    opacity: 0.35,
  },
  tag: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 12, fontWeight: "600" },
});
