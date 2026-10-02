import { SymbolView } from "expo-symbols";
import { Tabs, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../../lib/theme";

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Pregled",
            tabBarIcon: ({ color }) => <SymbolView name="chart.bar.fill" tintColor={color} size={22} />,
          }}
        />
        <Tabs.Screen
          name="lista"
          options={{
            title: "Unosi",
            tabBarIcon: ({ color }) => <SymbolView name="list.bullet" tintColor={color} size={22} />,
          }}
        />
      </Tabs>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Novi unos"
        onPress={() => router.push("/novi")}
        style={({ pressed }) => [
          styles.add,
          { bottom: insets.bottom + 49 + 16 },
          pressed ? { opacity: 0.85 } : null,
        ]}
      >
        <SymbolView name="plus" tintColor="#FFFFFF" size={24} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  add: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
