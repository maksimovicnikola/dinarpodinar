import { useRouter } from "expo-router";
import { useState } from "react";

import { BackTitle, Button, Card, Input, Label, Muted, Notice, Screen } from "../components/ui";
import { acceptInvitation } from "../lib/manage";

export default function InvitationScreen() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await acceptInvitation(token);
      if (!result.ok) {
        setError(result.message);
        setPending(false);
        return;
      }
      router.replace("/");
    } catch {
      setError("Pozivnica nije prihvaćena. Proverite vezu i pokušajte ponovo.");
      setPending(false);
    }
  }

  return (
    <Screen
      footer={
        <Button onPress={() => void onSubmit()} disabled={pending}>
          {pending ? "Prihvatam…" : "Prihvati pozivnicu"}
        </Button>
      }
    >
      <BackTitle title="Pozivnica" onBack={() => router.back()} />
      <Muted>Nalepite link koji vam je vlasnik poslao, ili samo kod iz linka. Prijavljeni ste adresom na koju je pozivnica napisana.</Muted>
      <Card>
        <Label>Link ili kod</Label>
        <Input
          value={token}
          onChangeText={setToken}
          placeholder="https://…/poziv/…"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {error ? <Notice>{error}</Notice> : null}
      </Card>
    </Screen>
  );
}
