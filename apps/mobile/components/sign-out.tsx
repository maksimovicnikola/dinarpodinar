import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { supabase } from "../lib/supabase";
import { colors, type } from "../lib/theme";

import { Button } from "./ui";

export function SignOutLink() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onPress() {
    if (pending) return;
    setPending(true);
    try {
      await supabase.auth.signOut();
      const session = await supabase.auth.getSession();
      if (!session.data.session) router.replace("/login");
    } finally {
      setPending(false);
    }
  }

  return (
    <Pressable accessibilityRole="button" onPress={() => void onPress()} disabled={pending} hitSlop={8}>
      <Text style={styles.link}>{pending ? "Odjavljujem…" : "Odjavi se"}</Text>
    </Pressable>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onPress() {
    if (pending) return;
    setPending(true);
    try {
      await supabase.auth.signOut();
      const session = await supabase.auth.getSession();
      if (!session.data.session) router.replace("/login");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button quiet disabled={pending} onPress={() => void onPress()}>
      {pending ? "Odjavljujem…" : "Odjavi se"}
    </Button>
  );
}

const styles = StyleSheet.create({
  link: { ...type.small, fontWeight: "600", color: colors.accent },
});
