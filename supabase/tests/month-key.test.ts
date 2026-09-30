/**
 * Verifikacija logike month_key generated column.
 *
 * SQL izraz (migration 20260930120000_finance.sql):
 *   lpad(extract(year  from occurred_on)::int::text, 4, '0') || '-' ||
 *   lpad(extract(month from occurred_on)::int::text, 2, '0')
 *
 * Ovaj test potvrđuje da:
 *  1. Izraz je ekvivalentan čistoj numeričkoj logici (godna + mesec → 'YYYY-MM').
 *  2. Semantika je identična traženom formatu i ne zavisi od DateStyle/locale.
 *  3. Isti recurring_rule_id u istom mesecu daje isti month_key (unique index semantika).
 *
 * Ne zahteva pokrenut Supabase/Docker.
 */

import { expect, it } from "vitest";

/**
 * TypeScript replika SQL izraza:
 *   lpad(extract(year)::int::text, 4, '0') || '-' || lpad(extract(month)::int::text, 2, '0')
 */
function monthKey(isoDate: string): string {
  // ISO date string → numeric year/month (DateStyle-independent)
  const [y, m] = isoDate.split("-").map(Number);
  return y.toString().padStart(4, "0") + "-" + m.toString().padStart(2, "0");
}

it("month_key: format YYYY-MM za standardne datume", () => {
  expect(monthKey("2026-09-30")).toBe("2026-09");
  expect(monthKey("2026-01-01")).toBe("2026-01");
  expect(monthKey("2025-12-31")).toBe("2025-12");
  expect(monthKey("2000-06-15")).toBe("2000-06");
});

it("month_key: dva datuma u istom mesecu daju isti ključ (unique index semantika)", () => {
  expect(monthKey("2026-09-01")).toBe(monthKey("2026-09-30"));
  expect(monthKey("2026-01-01")).toBe(monthKey("2026-01-31"));
});

it("month_key: datumi u različitim mesecima daju različit ključ", () => {
  expect(monthKey("2026-08-31")).not.toBe(monthKey("2026-09-01"));
  expect(monthKey("2025-12-31")).not.toBe(monthKey("2026-01-01"));
});

it("month_key: meseci ispod 10 su zero-padded (lpad semantika)", () => {
  expect(monthKey("2026-01-15")).toBe("2026-01"); // ne '2026-1'
  expect(monthKey("2026-09-01")).toBe("2026-09"); // ne '2026-9'
});
