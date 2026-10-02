import { formatMoney } from "@finance/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Share, StyleSheet, Switch, Text, View } from "react-native";

import {
  BackTitle,
  Button,
  Card,
  Chip,
  Chips,
  Input,
  Label,
  Muted,
  Notice,
  Screen,
  Segmented,
  Tag,
} from "../components/ui";
import type { CategoryRow, Household } from "../lib/household";
import { loadHousehold } from "../lib/household";
import {
  archiveCategory,
  createCategory,
  invitationUrl,
  inviteMember,
  minorToInput,
  removeMember,
  renameCategory,
  revokeInvitation,
  saveLimit,
  saveRule,
  type Outcome,
} from "../lib/manage";
import { supabase } from "../lib/supabase";
import { colors, space, type } from "../lib/theme";

type Member = { id: string; name: string; owner: boolean };
type Invite = { id: string; email: string; token: string; expiresAt: string };
type Rule = {
  id: string;
  kind: "expense" | "income";
  amountMinor: number;
  categoryId: string;
  personId: string;
  note: string;
  day: number;
  remind: number;
  active: boolean;
};

export default function SettingsScreen() {
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [categoryName, setCategoryName] = useState("");
  const [email, setEmail] = useState("");

  const load = useCallback(async () => {
    const result = await loadHousehold();
    if (result.status === "signed-out") {
      router.replace("/login");
      return;
    }
    if (result.status !== "ok") {
      setProblem(result.status === "none" ? "Prvo otvorite domaćinstvo." : "Podešavanja se ne otvaraju. Povucite ekran nadole.");
      setHousehold(null);
      return;
    }
    setHousehold(result.household);
    if (result.household.role !== "owner") {
      setProblem(null);
      return;
    }
    const [memberRows, invitationRows, ruleRows] = await Promise.all([
      supabase.from("memberships").select("user_id, role, profiles(display_name)").eq("household_id", result.household.householdId),
      supabase
        .from("invitations")
        .select("id, email, token, expires_at")
        .eq("household_id", result.household.householdId)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString()),
      supabase
        .from("recurring_rules")
        .select("id, kind, amount_minor, category_id, person_id, note, day_of_month, remind_days, active")
        .eq("household_id", result.household.householdId),
    ]);
    if (memberRows.error || invitationRows.error || ruleRows.error) {
      setProblem("Podešavanja se ne otvaraju. Povucite ekran nadole.");
      return;
    }
    setProblem(null);
    setMembers(
      (memberRows.data ?? [])
        .map((row) => {
          const profile = row.profiles as { display_name: string | null } | Array<{ display_name: string | null }> | null;
          const name = Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name;
          return { id: row.user_id as string, name: name?.trim() || "Član", owner: row.role === "owner" };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "sr")),
    );
    setInvites(
      (invitationRows.data ?? [])
        .map((row) => ({ id: row.id as string, email: row.email as string, token: row.token as string, expiresAt: row.expires_at as string }))
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
    );
    setRules(
      (ruleRows.data ?? []).map((row) => ({
        id: row.id as string,
        kind: row.kind as "expense" | "income",
        amountMinor: row.amount_minor as number,
        categoryId: row.category_id as string,
        personId: row.person_id as string,
        note: (row.note as string | null) ?? "",
        day: row.day_of_month as number,
        remind: row.remind_days as number,
        active: row.active as boolean,
      })),
    );
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(work: () => Promise<Outcome>) {
    if (busy) return null;
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      setNotice({ text: result.message, tone: result.ok ? "good" : "bad" });
      if (result.ok) await load();
      return result;
    } finally {
      setBusy(false);
    }
  }

  const owner = household?.role === "owner";
  const names = new Map(household?.categories.map((category) => [category.id, category.name]) ?? []);
  const people = new Map(members.map((member) => [member.id, member.name]));

  return (
    <Screen>
      <BackTitle title="Podešavanja" onBack={() => router.back()} />
      {household ? <Muted>{household.name}</Muted> : null}
      {problem ? <Notice>{problem}</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {household && !owner ? (
        <Card>
          <Muted>
            Kategorije, limite, članove, pozivnice i ponavljanja menja samo vlasnik. Vi vidite iste mesečne brojeve i dodajete unose.
          </Muted>
        </Card>
      ) : null}

      {household && owner ? (
        <>
          <Card>
            <Text style={styles.heading}>Kategorije</Text>
            <Muted>Vrsta se posle otvaranja ne menja. Limit prati samo trošak.</Muted>
            <Segmented
              options={[
                { value: "expense", label: "Trošak" },
                { value: "income", label: "Prihod" },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Input value={categoryName} onChangeText={setCategoryName} placeholder="Naziv kategorije" />
            <Button
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const result = await createCategory(household.householdId, categoryName, kind);
                  if (result.ok) setCategoryName("");
                  return result;
                })
              }
            >
              Dodaj kategoriju
            </Button>
            <Label>Aktivne</Label>
            {household.categories.filter((category) => !category.archived).length === 0 ? (
              <Muted>Nijedna aktivna kategorija.</Muted>
            ) : (
              household.categories
                .filter((category) => !category.archived)
                .sort((a, b) => a.name.localeCompare(b.name, "sr"))
                .map((category) => (
                  <CategoryEditor
                    key={`${category.id}:${category.name}:${category.limitMinor}`}
                    category={category}
                    householdId={household.householdId}
                    busy={busy}
                    onRun={run}
                  />
                ))
            )}
            <Label>Arhivirane</Label>
            {household.categories.filter((category) => category.archived).length === 0 ? (
              <Muted>Nijedna arhivirana kategorija.</Muted>
            ) : (
              household.categories
                .filter((category) => category.archived)
                .sort((a, b) => a.name.localeCompare(b.name, "sr"))
                .map((category) => (
                  <CategoryEditor
                    key={`${category.id}:${category.name}:${category.limitMinor}:archived`}
                    category={category}
                    householdId={household.householdId}
                    busy={busy}
                    onRun={run}
                    archived
                  />
                ))
            )}
          </Card>

          <Card>
            <Text style={styles.heading}>Članovi</Text>
            <Muted>Vlasnik ostaje. Uklanjaju se samo članovi, a njihovi unosi ostaju.</Muted>
            {members.map((member) => (
              <View key={member.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{member.name}</Text>
                  <Tag>{member.owner ? "vlasnik" : "član"}</Tag>
                  {member.id === household.userId ? <Tag>vi</Tag> : null}
                </View>
                {member.owner ? null : (
                  <Button quiet disabled={busy} onPress={() => void run(() => removeMember(household.householdId, member.id))}>
                    Ukloni
                  </Button>
                )}
              </View>
            ))}
          </Card>

          <Card>
            <Text style={styles.heading}>Pozivnice</Text>
            <Muted>Vrede sedam dana, jednom, i samo za upisanu adresu. Link prosleđujete sami.</Muted>
            <Input value={email} onChangeText={setEmail} placeholder="ime@primer.rs" autoCapitalize="none" keyboardType="email-address" />
            <Button
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const result = await inviteMember(household.householdId, email);
                  if (result.ok) setEmail("");
                  return result;
                })
              }
            >
              Napravi pozivnicu
            </Button>
            {invites.length === 0 ? <Muted>Nijedna pozivnica ne čeka.</Muted> : null}
            {invites.map((invite) => (
              <View key={invite.id} style={styles.block}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{invite.email}</Text>
                  <Tag>{`još ${daysLeft(invite.expiresAt)} d`}</Tag>
                </View>
                <Muted>{expiryLabel(invite.expiresAt)}</Muted>
                <Text selectable style={styles.link}>{invitationUrl(invite.token)}</Text>
                <View style={styles.actions}>
                  <Button quiet disabled={busy} onPress={() => void Share.share({ message: invitationUrl(invite.token) })}>
                    Podeli
                  </Button>
                  <Button quiet disabled={busy} onPress={() => void run(() => revokeInvitation(household.householdId, invite.id))}>
                    Povuci
                  </Button>
                </View>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={styles.heading}>Ponavljanja</Text>
            <Muted>Iznos, dan i podsetnik se menjaju ovde. Kategorija i osoba biraju se uz nov unos.</Muted>
            {rules.length === 0 ? <Muted>Nijedno ponavljanje.</Muted> : null}
            {rules.map((rule) => (
              <RuleEditor
                key={`${rule.id}:${rule.amountMinor}:${rule.day}:${rule.remind}:${rule.active}`}
                rule={rule}
                title={names.get(rule.categoryId) ?? "Kategorija"}
                person={people.get(rule.personId) ?? "Bivši član"}
                currency={household.currency}
                householdId={household.householdId}
                busy={busy}
                onRun={run}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function CategoryEditor({
  category,
  householdId,
  busy,
  archived = false,
  onRun,
}: {
  category: CategoryRow;
  householdId: string;
  busy: boolean;
  archived?: boolean;
  onRun: (work: () => Promise<Outcome>) => Promise<Outcome | null>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [limit, setLimit] = useState(minorToInput(category.limitMinor));

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.name}>{category.name}</Text>
          <Tag>{category.kind === "expense" ? "trošak" : "prihod"}</Tag>
          {archived ? <Tag>arhivirana</Tag> : null}
        </View>
        <Button quiet onPress={() => setOpen(!open)}>
          {open ? "Zatvori" : "Izmeni"}
        </Button>
      </View>
      {open && !archived ? (
        <>
          <Input value={name} onChangeText={setName} />
          <Button quiet disabled={busy} onPress={() => void onRun(() => renameCategory(householdId, category.id, name))}>
            Sačuvaj naziv
          </Button>
        </>
      ) : null}
      {open && category.kind === "expense" ? (
        <>
          <Label>Mesečni limit</Label>
          <Input value={limit} onChangeText={setLimit} placeholder="Prazno uklanja limit" keyboardType="decimal-pad" />
          <Button quiet disabled={busy} onPress={() => void onRun(() => saveLimit(householdId, category.id, limit))}>
            Sačuvaj limit
          </Button>
        </>
      ) : null}
      {open && category.kind === "income" ? <Muted>Prihod nema limit.</Muted> : null}
      {open && !archived ? (
        <Button quiet disabled={busy} onPress={() => void onRun(() => archiveCategory(householdId, category.id))}>
          Arhiviraj
        </Button>
      ) : null}
    </View>
  );
}

function RuleEditor({
  rule,
  title,
  person,
  currency,
  householdId,
  busy,
  onRun,
}: {
  rule: Rule;
  title: string;
  person: string;
  currency: string;
  householdId: string;
  busy: boolean;
  onRun: (work: () => Promise<Outcome>) => Promise<Outcome | null>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(minorToInput(rule.amountMinor));
  const [day, setDay] = useState(rule.day);
  const [remind, setRemind] = useState(rule.remind);
  const [active, setActive] = useState(rule.active);

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.rowText}>
            <Text style={styles.name}>{title}</Text>
            <Tag>{rule.kind === "expense" ? "trošak" : "prihod"}</Tag>
            {rule.active ? null : <Tag>ugašeno</Tag>}
          </View>
          <Muted>{`${person}${rule.note ? ` · ${rule.note}` : ""} · ${formatMoney(rule.amountMinor, currency)}`}</Muted>
        </View>
        <Button quiet onPress={() => setOpen(!open)}>
          {open ? "Zatvori" : "Izmeni"}
        </Button>
      </View>
      {open ? (
        <>
          <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Iznos" />
          <Label>Dan u mesecu</Label>
          <Chips>
            <Chip on={false} onPress={() => setDay(Math.max(1, day - 1))}>−</Chip>
            <Chip on onPress={() => undefined}>{`${day}.`}</Chip>
            <Chip on={false} onPress={() => setDay(Math.min(31, day + 1))}>+</Chip>
          </Chips>
          <Label>Podseti ranije</Label>
          <Chips>
            <Chip on={false} onPress={() => setRemind(Math.max(1, remind - 1))}>−</Chip>
            <Chip on onPress={() => undefined}>{remind === 1 ? "1 dan" : `${remind} dana`}</Chip>
            <Chip on={false} onPress={() => setRemind(Math.min(7, remind + 1))}>+</Chip>
          </Chips>
          <View style={styles.row}>
            <Text style={styles.name}>Uključeno</Text>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.accent }} />
          </View>
          <Button
            disabled={busy}
            onPress={() => void onRun(() => saveRule(householdId, rule.id, { amount, day, remind, active }))}
          >
            Sačuvaj ponavljanje
          </Button>
        </>
      ) : null}
    </View>
  );
}

function daysLeft(expiresAt: string): number {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

function expiryLabel(expiresAt: string): string {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return "nepoznato";
  return new Intl.DateTimeFormat("sr-RS", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

const styles = StyleSheet.create({
  heading: { ...type.title, color: colors.text },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  rowText: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  name: { ...type.body, fontWeight: "500", color: colors.text },
  block: {
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  actions: { flexDirection: "row", gap: space.sm },
  link: { ...type.caption, color: colors.accent },
});
