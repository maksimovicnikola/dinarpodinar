import { Stack } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { supabase } from "../lib/supabase";

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
  return <Stack screenOptions={{ headerShown: false }} />;
}
