import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
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
          data: { display_name: displayName },
        },
      });
      if (result.error) {
        setError("Kod nije poslat. Proverite adresu i pokušajte ponovo.");
        return;
      }
      setCode("");
      setSentTo(address);
    } catch {
      setError("Kod nije poslat. Proverite vezu i pokušajte ponovo.");
    } finally {
      setPending(false);
    }
  }

  async function onVerify() {
    if (!sentTo) return;
    setError(null);
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Kod ima šest cifara.");
      return;
    }
    setPending(true);
    try {
      const result = await supabase.auth.verifyOtp({ email: sentTo, token, type: "email" });
      if (result.error || !result.data.session) {
        setError("Kod nije ispravan ili je istekao. Zatražite novi.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Prijava nije uspela. Proverite vezu i pokušajte ponovo.");
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
      <Text style={{ color: "#3d3832" }}>Nema šifre. Ime i e-pošta, pa kod za jednu prijavu.</Text>
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
      {sentTo ? (
        <>
          <Text>Kod je poslat na {sentTo}.</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Kod iz mejla"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            style={{ borderBottomWidth: 1, borderColor: "#1c1915", paddingVertical: 10, fontSize: 24, letterSpacing: 4 }}
          />
          <Pressable onPress={() => void onVerify()} disabled={pending} style={{ backgroundColor: "#1c1915", padding: 14 }}>
            <Text style={{ color: "#f4efe4", textAlign: "center" }}>{pending ? "Proveravam…" : "Prijavi me"}</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPress={() => void onSubmit()}
        disabled={pending}
        style={sentTo ? { padding: 14, borderWidth: 1, borderColor: "#1c1915" } : { backgroundColor: "#1c1915", padding: 14 }}
      >
        <Text style={sentTo ? { textAlign: "center" } : { color: "#f4efe4", textAlign: "center" }}>
          {pending ? "Šaljem…" : sentTo ? "Pošalji novi kod" : "Pošalji kod"}
        </Text>
      </Pressable>
      <Pressable onPress={() => void onApple()} disabled={pending} style={{ padding: 14, borderWidth: 1, borderColor: "#1c1915" }}>
        <Text style={{ textAlign: "center" }}>Nastavi sa Apple-om</Text>
      </Pressable>
    </View>
  );
}
