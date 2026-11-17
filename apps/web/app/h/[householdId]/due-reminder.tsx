"use client";

import {
  formatMoney,
  todayInBelgrade,
  unpaidReminders,
  type EntryKind,
  type RecurrenceCadence,
} from "@finance/domain";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/form";
import { formatDate } from "@/lib/month-view";
import { createBrowserSupabase } from "@/lib/supabase/client";

import { confirmOccurrencePayment } from "./occurrence";

type Prompt = {
  ruleId: string;
  month: string;
  kind: EntryKind;
  name: string;
  amount: string;
  dueOn: string;
};

const STORAGE_KEY = "due-reminder-day";
const claimed = new Set<string>();

function seenDay(householdId: string): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[householdId] ?? null;
  } catch {
    return null;
  }
}

function rememberDay(householdId: string, today: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[householdId] = today;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Prozor i dalje sme da se pokaže; sledeći ulazak istog dana može da ga ponovi.
  }
}

function neighborMonths(today: string): string[] {
  const [year, month] = today.split("-").map(Number);
  return [-1, 0, 1].map((delta) => {
    const index = year * 12 + (month - 1) + delta;
    const nextYear = Math.floor(index / 12);
    const nextMonth = (index % 12) + 1;
    return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  });
}

export function DueReminder({ householdId }: { householdId: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Prompt[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(householdId)) return;
    let cancelled = false;
    void (async () => {
      const today = todayInBelgrade(new Date());
      const claim = `${householdId}:${today}`;
      if (seenDay(householdId) === today || claimed.has(claim)) return;
      const supabase = createBrowserSupabase();
      const months = neighborMonths(today);
      const [rules, categories, entries, household] = await Promise.all([
        supabase
          .from("recurring_rules")
          .select("id, kind, category_id, amount_minor, day_of_month, remind_days, cadence, month_of_year")
          .eq("household_id", householdId)
          .eq("active", true),
        supabase.from("categories").select("id, name").eq("household_id", householdId),
        supabase
          .from("entries")
          .select("recurring_rule_id, month_key")
          .eq("household_id", householdId)
          .in("month_key", months)
          .not("recurring_rule_id", "is", null),
        supabase.from("households").select("currency").eq("id", householdId).maybeSingle(),
      ]);
      if (cancelled || rules.error || categories.error || entries.error || household.error || !household.data) return;
      const names = new Map((categories.data ?? []).map((row) => [row.id, row.name as string]));
      const settled = new Set(
        (entries.data ?? [])
          .filter((row) => row.recurring_rule_id)
          .map((row) => `${row.recurring_rule_id}:${row.month_key}`),
      );
      const open = unpaidReminders(
        today,
        (rules.data ?? []).map((rule) => ({
          id: rule.id as string,
          dayOfMonth: rule.day_of_month as number,
          remindDays: rule.remind_days as number,
          cadence: (rule.cadence === "yearly" ? "yearly" : "monthly") as RecurrenceCadence,
          monthOfYear: rule.month_of_year as number | null,
        })),
        settled,
      );
      if (cancelled || open.length === 0 || seenDay(householdId) === today || claimed.has(claim)) return;
      const byId = new Map((rules.data ?? []).map((rule) => [rule.id as string, rule]));
      const prompts: Prompt[] = open.flatMap((row) => {
        const rule = byId.get(row.ruleId);
        if (!rule) return [];
        const kind: EntryKind = rule.kind === "income" ? "income" : "expense";
        return [{
          ruleId: row.ruleId,
          month: row.month,
          kind,
          name: names.get(rule.category_id) ?? "Kategorija",
          amount: formatMoney(rule.amount_minor as number, household.data?.currency ?? "RSD"),
          dueOn: row.occurrence,
        }];
      });
      if (prompts.length === 0) return;
      claimed.add(claim);
      rememberDay(householdId, today);
      setItems(prompts);
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  useEffect(() => {
    const node = dialog.current;
    if (!node || items.length === 0 || node.open) return;
    node.showModal();
  }, [items]);

  async function confirm(item: Prompt) {
    if (pendingId) return;
    setPendingId(item.ruleId);
    setError(null);
    const message = await confirmOccurrencePayment(householdId, item.ruleId, item.month);
    setPendingId(null);
    if (message) {
      setError(message);
      return;
    }
    router.refresh();
    setItems((current) => {
      const next = current.filter((row) => !(row.ruleId === item.ruleId && row.month === item.month));
      if (next.length === 0) dialog.current?.close();
      return next;
    });
  }

  if (items.length === 0) return null;

  const today = todayInBelgrade(new Date());

  return (
    <dialog ref={dialog} className="dialog dialog--due" aria-labelledby="due-reminder-title">
      <h2 id="due-reminder-title">Imaš dospeća koja nisu uneta</h2>
      <p>Potvrda upisuje iznos u spisak. Kasnije ostavlja dospeće za sutra, a danas se ovaj prozor više ne otvara.</p>
      <ul className="due-list">
        {items.map((item) => (
          <li key={`${item.ruleId}:${item.month}`}>
            <span>
              <strong>{item.name}</strong>
              <span className="fine">
                {item.dueOn <= today ? "Dospelo" : "Dospeva"} {formatDate(item.dueOn)}
              </span>
            </span>
            <span className="due-list__side">
              <span className="amount">{item.amount}</span>
              <button
                type="button"
                className="button button--small"
                disabled={pendingId !== null}
                onClick={() => void confirm(item)}
              >
                {pendingId === item.ruleId ? "Unosim…" : item.kind === "income" ? "Primljeno" : "Plaćeno"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="row">
        <button type="button" className="button button--quiet" onClick={() => dialog.current?.close()}>
          Kasnije
        </button>
      </div>
    </dialog>
  );
}
