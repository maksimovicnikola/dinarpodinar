import { useRouter } from "expo-router";
import { useState } from "react";

import { BackTitle, Button, Card, Input, Label, Muted, Notice, Screen } from "../components/ui";
import { createHousehold } from "../lib/manage";

export default function NewHouseholdScreen() {
  const router = useRouter();
  const [name, setName] = useState("Naša kuća");
  const [currency, setCurrency] = useState("RSD");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await createHousehold(name, currency);
      if (!result.ok) {
        setError(result.message);
        setPending(false);
        return;
      }
      router.replace("/");
    } catch {
      setError("Domaćinstvo nije otvoreno. Proverite vezu i pokušajte ponovo.");
      setPending(false);
    }
  }

  return (
    <Screen
      footer={
        <Button onPress={() => void onSubmit()} disabled={pending}>
          {pending ? "Otvaram…" : "Otvori domaćinstvo"}
        </Button>
      }
    >
      <BackTitle title="Novo domaćinstvo" onBack={() => router.back()} />
      <Muted>Vi ostajete vlasnik i jedini menjate podešavanja.</Muted>
      <Card>
        <Label>Naziv</Label>
        <Input value={name} onChangeText={setName} placeholder="Naša kuća" maxLength={80} />
        <Label>Valuta</Label>
        <Input value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} />
        {error ? <Notice>{error}</Notice> : null}
      </Card>
    </Screen>
  );
}
