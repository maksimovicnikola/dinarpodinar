import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { Button, Card, Input, Label, Muted, Notice, Screen } from "../components/ui";
import { supabase } from "../lib/supabase";
import { colors, space, type } from "../lib/theme";

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
        return;
      }
      router.replace("/");
    } catch {
      setError("Prijava preko Apple-a nije uspela.");
    } finally {
      setPending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        <View style={styles.hero}>
          <Text style={styles.brand}>Dinar po dinar</Text>
          <Text style={styles.heading}>{sentTo ? "Upišite kod" : "Prijava"}</Text>
          <Muted style={styles.lead}>
            {sentTo
              ? `Poslali smo šestocifreni kod na ${sentTo}.`
              : "Bez lozinke. Upišite ime i e-poštu, a mi šaljemo kod za prijavu."}
          </Muted>
        </View>

        {sentTo ? (
          <Card>
            <Input
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoFocus
              maxLength={6}
              accessibilityLabel="Kod iz mejla"
              style={styles.code}
            />
            {error ? <Notice>{error}</Notice> : null}
            <Button onPress={() => void onVerify()} disabled={pending}>
              {pending ? "Proveravam…" : "Prijavi me"}
            </Button>
            <Button quiet onPress={() => void onSubmit()} disabled={pending}>
              Pošalji novi kod
            </Button>
          </Card>
        ) : (
          <Card>
            <View style={styles.field}>
              <Label>Ime</Label>
              <Input value={name} onChangeText={setName} placeholder="Kako da vas zovemo" autoCapitalize="words" textContentType="givenName" />
            </View>
            <View style={styles.field}>
              <Label>E-pošta</Label>
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder="ime@primer.rs"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
              />
            </View>
            {error ? <Notice>{error}</Notice> : null}
            <Button onPress={() => void onSubmit()} disabled={pending}>
              {pending ? "Šaljem…" : "Pošalji kod"}
            </Button>
          </Card>
        )}

        {sentTo ? null : (
          <Button quiet onPress={() => void onApple()} disabled={pending}>
            Nastavi sa Apple-om
          </Button>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm, paddingTop: space.xxl, paddingBottom: space.md },
  brand: { ...type.small, fontWeight: "600", color: colors.accent },
  heading: { ...type.display, color: colors.text },
  lead: { ...type.body },
  field: { gap: space.sm },
  code: { fontSize: 28, lineHeight: 34, letterSpacing: 8, textAlign: "center", fontVariant: ["tabular-nums"], minHeight: 60 },
});
