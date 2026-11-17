"use client";

import { occurrenceInMonth, type EntryKind, type RecurrenceCadence } from "@finance/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Notice } from "@/components/form";
import { entryErrorMessage } from "@/lib/entry-form";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Potvrda uplate pravi unos. Poništavanje briše taj unos i vraća dospeće.
 * Pravilo ostaje.
 */
export function OccurrenceActions({
  householdId,
  ruleId,
  month,
  kind,
  entryId,
  owner,
}: {
  householdId: string;
  ruleId: string;
  month: string;
  kind: EntryKind;
  entryId: string | null;
  owner: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const rule = await supabase
        .from("recurring_rules")
        .select("kind, amount_minor, category_id, person_id, note, day_of_month, cadence, month_of_year, active")
        .eq("id", ruleId)
        .eq("household_id", householdId)
        .maybeSingle();
      if (rule.error) throw rule.error;
      if (!rule.data?.active) {
        setError("Ponavljanje više nije uključeno.");
        return;
      }
      const cadence: RecurrenceCadence = rule.data.cadence === "yearly" ? "yearly" : "monthly";
      const occurredOn = occurrenceInMonth(
        month,
        rule.data.day_of_month,
        cadence,
        rule.data.month_of_year,
      );
      if (occurredOn === null) {
        setError("Ovo ponavljanje nema dospeće u ovom mesecu.");
        return;
      }
      const inserted = await supabase.from("entries").insert({
        household_id: householdId,
        kind: rule.data.kind,
        amount_minor: rule.data.amount_minor,
        category_id: rule.data.category_id,
        person_id: rule.data.person_id,
        occurred_on: occurredOn,
        note: rule.data.note ?? "",
        recurring_rule_id: ruleId,
      });
      if (inserted.error) {
        const message = inserted.error.message ?? "";
        if (inserted.error.code === "23505" || message.includes("entries_one_rule_per_month")) {
          router.refresh();
          return;
        }
        setError(entryErrorMessage(message));
        return;
      }
      router.refresh();
    } catch (caught) {
      setError(entryErrorMessage(caught instanceof Error ? caught.message : ""));
    } finally {
      setPending(false);
    }
  }

  async function undo() {
    if (pending || entryId === null) return;
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const removed = await supabase
        .from("entries")
        .delete()
        .eq("id", entryId)
        .eq("household_id", householdId)
        .select("id");
      if (removed.error) {
        setError(entryErrorMessage(removed.error.message));
        return;
      }
      if ((removed.data ?? []).length === 0) {
        setError("Ovaj unos više nije tu.");
        return;
      }
      router.refresh();
    } catch (caught) {
      setError(entryErrorMessage(caught instanceof Error ? caught.message : ""));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="row">
      {entryId === null ? (
        <button type="button" className="button" onClick={() => void confirm()} disabled={pending}>
          {pending ? "Unosim…" : kind === "income" ? "Primljeno" : "Plaćeno"}
        </button>
      ) : (
        <>
          <a className="button button--quiet" href={`/h/${householdId}/unos/${entryId}`}>
            Otvori unos
          </a>
          {owner ? (
            <button type="button" className="button button--quiet" onClick={() => void undo()} disabled={pending}>
              {pending ? "Brišem…" : "Poništi unos"}
            </button>
          ) : null}
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </span>
  );
}
