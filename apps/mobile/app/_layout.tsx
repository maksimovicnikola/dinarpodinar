import { Stack } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";

export function usePushToken() {
  useEffect(() => {
    void (async () => {
      const session = await supabase.auth.getSession();
      if (!session.data.session) return;
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;
      const token = await Notifications.getExpoPushTokenAsync();
      const user = await supabase.auth.getUser();
      if (!user.data.user) return;
      await supabase.from("push_tokens").upsert({
        user_id: user.data.user.id,
        token: token.data,
      });
    })();
  }, []);
}

export default function RootLayout() {
  usePushToken();
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="novi" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}
