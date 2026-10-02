import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { Button, Card, Input, Label, Muted, Notice, Screen } from "../components/ui";
import { checkedDisplayName, needsDisplayName } from "../lib/display-name";
import { supabase } from "../lib/supabase";
import { colors, space, type } from "../lib/theme";

type Step = "email" | "code" | "name";

export default function LoginScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function finishOrAskName(metadata: unknown) {
    if (needsDisplayName(metadata)) {
      setStep("name");
      return;
    }
    router.replace("/");
  }

  async function saveName(value: string): Promise<boolean> {
    const auth = await supabase.auth.getUser();
    const userId = auth.data.user?.id;
    if (!userId) {
      setError("Prijava je istekla. Pošaljite novi kod.");
      setStep("email");
      return false;
    }
    const profile = await supabase.from("profiles").update({ display_name: value }).eq("id", userId);
    if (profile.error) {
      setError("Ime nije sačuvano. Pokušajte ponovo.");
      return false;
    }
    const marked = await supabase.auth.updateUser({ data: { display_name: value } });
    if (marked.error) {
      setError("Ime nije sačuvano. Pokušajte ponovo.");
      return false;
    }
    return true;
  }

  async function onSubmit() {
    setError(null);
    const address = email.trim();
    if (!address.includes("@")) {
      setError("E-pošta nije ispravna.");
      return;
    }
    setPending(true);
    try {
      const result = await supabase.auth.signInWithOtp({ email: address });
      if (result.error) {
        setError("Kod nije poslat. Proverite adresu i pokušajte ponovo.");
        return;
      }
      setEmail(address);
      setCode("");
      setStep("code");
    } catch {
      setError("Kod nije poslat. Proverite vezu i pokušajte ponovo.");
    } finally {
      setPending(false);
    }
  }

  async function onVerify() {
    setError(null);
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Kod ima šest cifara.");
      return;
    }
    setPending(true);
    try {
      const result = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (result.error || !result.data.session) {
        setError("Kod nije ispravan ili je istekao. Zatražite novi.");
        return;
      }
      finishOrAskName(result.data.user?.user_metadata);
    } catch {
      setError("Prijava nije uspela. Proverite vezu i pokušajte ponovo.");
    } finally {
      setPending(false);
    }
  }

  async function onSaveName() {
    setError(null);
    const value = checkedDisplayName(name);
    if (!value) {
      setError("Ime mora imati bar dva znaka.");
      return;
    }
    setPending(true);
    try {
      const saved = await saveName(value);
      if (saved) router.replace("/");
    } catch {
      setError("Ime nije sačuvano. Proverite vezu i pokušajte ponovo.");
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
      const appleName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter((part) => part && part.trim().length > 0)
        .join(" ")
        .trim();
      if (needsDisplayName(result.data.user?.user_metadata) && checkedDisplayName(appleName)) {
        const saved = await saveName(appleName);
        if (!saved) {
          setName(appleName);
          setStep("name");
          return;
        }
        router.replace("/");
        return;
      }
      finishOrAskName(result.data.user?.user_metadata);
    } catch {
      setError("Prijava preko Apple-a nije uspela.");
    } finally {
      setPending(false);
    }
  }

  const heading = step === "code" ? "Upišite kod" : step === "name" ? "Vaše ime" : "Prijava";
  const lead =
    step === "code"
      ? `Poslali smo šestocifreni kod na ${email}.`
      : step === "name"
        ? "Ovako vas vide ostali u domaćinstvu. Pitamo samo jednom, za nov nalog."
        : "Bez lozinke. Upišite e-poštu, a mi šaljemo kod za prijavu.";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        <View style={styles.hero}>
          <Text style={styles.brand}>Dinar po dinar</Text>
          <Text style={styles.heading}>{heading}</Text>
          <Muted style={styles.lead}>{lead}</Muted>
        </View>

        {step === "code" ? (
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
        ) : null}

        {step === "email" ? (
          <Card>
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
        ) : null}

        {step === "name" ? (
          <Card>
            <View style={styles.field}>
              <Label>Ime</Label>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="Kako da vas zovemo"
                autoCapitalize="words"
                textContentType="givenName"
                autoFocus
              />
            </View>
            {error ? <Notice>{error}</Notice> : null}
            <Button onPress={() => void onSaveName()} disabled={pending}>
              {pending ? "Čuvam…" : "Sačuvaj ime"}
            </Button>
          </Card>
        ) : null}

        {step === "email" ? (
          <Button quiet onPress={() => void onApple()} disabled={pending}>
            Nastavi sa Apple-om
          </Button>
        ) : null}
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
