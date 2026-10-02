import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { supabase } from "../../lib/supabase";
import { colors, type } from "../../lib/theme";

function queryValue(url: string, key: string): string | null {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  for (const part of query.split("&")) {
    const [name, value] = part.split("=");
    if (name === key && value) return decodeURIComponent(value);
  }
  return null;
}

export default function AuthCallback() {
  const router = useRouter();
  const url = Linking.useURL();
  const [message, setMessage] = useState("Prijavljujem…");

  useEffect(() => {
    if (!url) return;
    const code = queryValue(url, "code");
    void (async () => {
      if (!code) {
        setMessage("Link za prijavu nije potpun. Zatražite novi.");
        return;
      }
      const result = await supabase.auth.exchangeCodeForSession(code);
      if (result.error) {
        setMessage("Prijava nije uspela. Zatražite novi link.");
        return;
      }
      router.replace("/");
    })();
  }, [router, url]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24 }}>
      <Text style={{ ...type.body, color: colors.text, textAlign: "center" }}>{message}</Text>
    </View>
  );
}
