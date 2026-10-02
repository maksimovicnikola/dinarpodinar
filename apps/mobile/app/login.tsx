import * as AppleAuthentication from "expo-apple-authentication";
import * as Linking from "expo-linking";
import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    setError(null);
    setSentTo(null);
    const displayName = name.trim();
    const address = email.trim();
    if (displayName.length < 2) {
      setError("Ime mora imati bar dva znaka.");
      return;
    }
    if (!address.includes("@")) {
      setError("E-pošta nije ispravna.");
      return;
    }
    setPending(true);
    try {
      const result = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: Linking.createURL("auth/callback"),
          data: { display_name: displayName },
        },
      });
      if (result.error) {
        setError("Link nije poslat. Proverite adresu i pokušajte ponovo.");
        return;
      }
      setSentTo(address);
    } catch {
      setError("Link nije poslat. Proverite vezu i pokušajte ponovo.");
    } finally {
      setPending(false);
    }
  }

  async function onApple() {
    setError(null);
    if (Platform.OS !== "ios") {
      setError("Prijava preko Apple-a radi na iPhone-u.");
      return;
    }
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      setError("Prijava preko Apple-a nije dostupna na ovom uređaju.");
      return;
    }
    setPending(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const appleEmail = credential.email ?? email.trim();
      if (!appleEmail.includes("@")) {
        setError("Apple nije poslao e-poštu. Upišite je, pa pokušajte ponovo.");
        return;
      }
      if (!credential.identityToken) {
        setError("Apple nije vratio token za prijavu.");
        return;
      }
      const result = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });
      if (result.error) {
        setError("Prijava preko Apple-a nije uspela.");
      }
    } catch {
      setError("Prijava preko Apple-a nije uspela.");
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f4efe4", padding: 24, justifyContent: "center", gap: 12 }}>
      <Text style={{ fontSize: 13, letterSpacing: 1, color: "#6b6256" }}>DINAR PO DINAR</Text>
      <Text style={{ fontSize: 32, color: "#1c1915" }}>Otvorite svoju knjižicu</Text>
      <Text style={{ color: "#3d3832" }}>Nema šifre. Ime i e-pošta, pa link za jednu prijavu.</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Ime"
        autoCapitalize="words"
        style={{ borderBottomWidth: 1, borderColor: "#1c1915", paddingVertical: 10, fontSize: 18 }}
      />
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="E-pošta"
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ borderBottomWidth: 1, borderColor: "#1c1915", paddingVertical: 10, fontSize: 18 }}
      />
      {error ? <Text style={{ color: "#8a2b1b" }}>{error}</Text> : null}
      {sentTo ? <Text>Link je poslat na {sentTo}.</Text> : null}
      <Pressable onPress={() => void onSubmit()} disabled={pending} style={{ backgroundColor: "#1c1915", padding: 14 }}>
        <Text style={{ color: "#f4efe4", textAlign: "center" }}>{pending ? "Šaljem…" : "Pošalji link"}</Text>
      </Pressable>
      <Pressable onPress={() => void onApple()} disabled={pending} style={{ padding: 14, borderWidth: 1, borderColor: "#1c1915" }}>
        <Text style={{ textAlign: "center" }}>Nastavi sa Apple-om</Text>
      </Pressable>
    </View>
  );
}
