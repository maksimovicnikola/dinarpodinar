import { describe, expect, it, vi } from "vitest";

import {
  canSend,
  categoriesOfKind,
  defaultOccurredOn,
  draftKey,
  entryBlocker,
  entryErrorMessage,
  firstCategoryId,
  initialEntryState,
  isCalendarDate,
  isRequestId,
  newRequestId,
  phaseAfter,
  saveEntry,
  saveLabel,
  switchKind,
  ticketFor,
  validateEntry,
  type CategoryOption,
  type EntryDraft,
  type EntryFormState,
  type EntryGateway,
  type PersonOption,
  type RepeatingDraft,
} from "./entry-form";

const categories: CategoryOption[] = [
  { id: "food", name: "Hrana", kind: "expense" },
  { id: "bills", name: "Računi", kind: "expense" },
  { id: "misc-out", name: "Ostalo", kind: "expense" },
  { id: "salary", name: "Plata", kind: "income" },
  { id: "misc-in", name: "Ostalo", kind: "income" },
];

const people: PersonOption[] = [
  { id: "ana", name: "Ana" },
  { id: "marko", name: "Marko" },
];

const householdId = "11111111-2222-3333-4444-555555555555";

function state(overrides: Partial<EntryFormState> = {}): EntryFormState {
  return {
    kind: "expense",
    amount: "1.200",
    categoryId: "food",
    personId: "ana",
    occurredOn: "2026-09-30",
    note: "pijaca",
    repeat: false,
    remindDays: "1",
    ...overrides,
  };
}

function context() {
  return { householdId, categories, people };
}

// ----------------------------------------------------------------
// Ponuda kategorija i promena vrste
// ----------------------------------------------------------------

describe("categoriesOfKind", () => {
  it("vraća samo kategorije tražene vrste", () => {
    expect(categoriesOfKind(categories, "income").map((item) => item.id)).toEqual([
      "misc-in",
      "salary",
    ]);
  });

  it("redosled je određen: naziv na srpskom, pa identifikator", () => {
    expect(categoriesOfKind(categories, "expense").map((item) => item.name)).toEqual([
      "Hrana",
      "Ostalo",
      "Računi",
    ]);
  });

  it("istoimene kategorije razdvaja identifikator, pa redosled ne pleše", () => {
    const twins: CategoryOption[] = [
      { id: "b", name: "Hrana", kind: "expense" },
      { id: "a", name: "Hrana", kind: "expense" },
    ];
    expect(categoriesOfKind(twins, "expense").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("ne menja ulazni niz", () => {
    const input = [...categories];
    categoriesOfKind(input, "expense");
    expect(input.map((item) => item.id)).toEqual(categories.map((item) => item.id));
  });

  it("prazan spisak daje prazan izbor", () => {
    expect(firstCategoryId([], "expense")).toBe("");
  });
});

describe("switchKind", () => {
  it("prelazak na prihod bira kategoriju prihoda, ne zadržava trošak", () => {
    const next = switchKind(state({ categoryId: "food" }), "income", categories);
    expect(next.kind).toBe("income");
    expect(next.categoryId).toBe("misc-in");
    expect(categories.find((item) => item.id === next.categoryId)?.kind).toBe("income");
  });

  it("prelazak nazad na trošak bira kategoriju troška", () => {
    const income = switchKind(state(), "income", categories);
    const back = switchKind(income, "expense", categories);
    expect(back.kind).toBe("expense");
    expect(categories.find((item) => item.id === back.categoryId)?.kind).toBe("expense");
  });

  it("nijedna promena vrste ne ostavlja kategoriju pogrešne vrste", () => {
    let current = state();
    for (const kind of ["income", "expense", "income", "income", "expense"] as const) {
      current = switchKind(current, kind, categories);
      expect(categories.find((item) => item.id === current.categoryId)?.kind).toBe(current.kind);
    }
  });

  it("ista vrsta ne dira izbor", () => {
    const current = state({ categoryId: "bills" });
    expect(switchKind(current, "expense", categories)).toBe(current);
  });

  it("vrsta bez ijedne kategorije ostavlja prazan izbor, ne tuđu kategoriju", () => {
    const onlyExpense = categories.filter((item) => item.kind === "expense");
    const next = switchKind(state(), "income", onlyExpense);
    expect(next.kind).toBe("income");
    expect(next.categoryId).toBe("");
  });

  it("ostala polja prelaze netaknuta", () => {
    const current = state({ amount: "12,50", note: "struja", occurredOn: "2026-02-28" });
    const next = switchKind(current, "income", categories);
    expect(next.amount).toBe("12,50");
    expect(next.note).toBe("struja");
    expect(next.occurredOn).toBe("2026-02-28");
  });
});

// ----------------------------------------------------------------
// Početno stanje i podrazumevani datum
// ----------------------------------------------------------------

describe("defaultOccurredOn", () => {
  it("uzima beogradski dan, ne UTC dan", () => {
    // 22:30 UTC zimi je 23:30 u Beogradu — isti dan.
    const winterEvening = new Date("2026-01-01T22:30:00Z");
    expect(defaultOccurredOn(winterEvening)).toBe("2026-01-01");
    expect(winterEvening.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("posle 22h leti Beograd je već u sutrašnjem danu, a UTC nije", () => {
    // 22:30 UTC leti je 00:30 sledećeg dana u Beogradu.
    const summerEvening = new Date("2026-06-30T22:30:00Z");
    expect(defaultOccurredOn(summerEvening)).toBe("2026-07-01");
    expect(summerEvening.toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("posle ponoći u UTC-u Beograd je i dalje isti dan", () => {
    // 23:30 UTC zimi je 00:30 sledećeg dana u Beogradu.
    const past = new Date("2026-12-31T23:30:00Z");
    expect(defaultOccurredOn(past)).toBe("2027-01-01");
  });

  it("rani jutarnji UTC i Beograd se poklapaju", () => {
    expect(defaultOccurredOn(new Date("2026-03-15T09:00:00Z"))).toBe("2026-03-15");
  });

  it("vraćeni datum je prihvatljiv datum forme", () => {
    expect(isCalendarDate(defaultOccurredOn(new Date("2026-06-30T22:30:00Z")))).toBe(true);
  });
});

describe("initialEntryState", () => {
  it("kreće od troška, prve kategorije troška i praznog iznosa", () => {
    const initial = initialEntryState({ categories, people, today: "2026-09-30" });
    expect(initial.kind).toBe("expense");
    expect(initial.categoryId).toBe("food");
    expect(initial.amount).toBe("");
    expect(initial.note).toBe("");
    expect(initial.repeat).toBe(false);
    expect(initial.remindDays).toBe("1");
    expect(initial.occurredOn).toBe("2026-09-30");
  });

  it("bira prijavljenog člana kad je on u spisku", () => {
    const initial = initialEntryState({
      categories,
      people,
      signedInPersonId: "marko",
      today: "2026-09-30",
    });
    expect(initial.personId).toBe("marko");
  });

  it("pada na prvog člana kad prijavljeni nije u spisku", () => {
    const initial = initialEntryState({
      categories,
      people,
      signedInPersonId: "neko-drugi",
      today: "2026-09-30",
    });
    expect(initial.personId).toBe("ana");
  });

  it("bez ijednog člana ostavlja prazan izbor umesto tuđeg identifikatora", () => {
    const initial = initialEntryState({
      categories,
      people: [],
      signedInPersonId: "ana",
      today: "2026-09-30",
    });
    expect(initial.personId).toBe("");
  });
});

// ----------------------------------------------------------------
// Zabrana slanja kad domaćinstvo nema šta da ponudi
// ----------------------------------------------------------------

describe("entryBlocker", () => {
  it("ćuti kad ima i kategorija i članova", () => {
    expect(entryBlocker({ categories, people, kind: "expense" })).toBeNull();
    expect(entryBlocker({ categories, people, kind: "income" })).toBeNull();
  });

  it("javlja kad domaćinstvo nema nijednu aktivnu kategoriju", () => {
    expect(entryBlocker({ categories: [], people, kind: "expense" })).toMatch(
      /nema nijednu aktivnu kategoriju/,
    );
  });

  it("javlja za vrstu bez kategorije i imenuje vrstu", () => {
    const onlyExpense = categories.filter((item) => item.kind === "expense");
    expect(entryBlocker({ categories: onlyExpense, people, kind: "income" })).toMatch(
      /kategorije prihoda/,
    );

    const onlyIncome = categories.filter((item) => item.kind === "income");
    expect(entryBlocker({ categories: onlyIncome, people, kind: "expense" })).toMatch(
      /kategorije troška/,
    );
  });

  it("prazan spisak članova se javlja pre kategorija", () => {
    expect(entryBlocker({ categories: [], people: [], kind: "expense" })).toMatch(/članova/);
  });

  it("svaka poruka kaže šta sledeće", () => {
    const messages = [
      entryBlocker({ categories: [], people, kind: "expense" }),
      entryBlocker({ categories: [], people: [], kind: "expense" }),
      entryBlocker({ categories: categories.filter((c) => c.kind === "income"), people, kind: "expense" }),
    ];
    for (const message of messages) {
      expect(message).toMatch(/podešavanjima|Osvežite stranu/);
    }
  });
});

// ----------------------------------------------------------------
// Datum
// ----------------------------------------------------------------

describe("isCalendarDate", () => {
  it("prihvata stvaran datum", () => {
    expect(isCalendarDate("2026-09-30")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });

  it("odbija dan koji taj mesec nema", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-06-31")).toBe(false);
  });

  it("odbija oblike koji nisu YYYY-MM-DD", () => {
    for (const value of [
      "",
      "30.09.2026.",
      "2026-9-3",
      "26-09-30",
      "2026/09/30",
      "2026-09-30T00:00:00Z",
      " 2026-09-30",
      "2026-09-30 ",
      "2026-13-01",
      "2026-00-10",
      "2026-09-00",
      "2026-09-32",
    ]) {
      expect(isCalendarDate(value), value).toBe(false);
    }
  });

  it("odbija godine van prozora koji mesečni pregled ume da otvori", () => {
    expect(isCalendarDate("1899-12-31")).toBe(false);
    expect(isCalendarDate("1900-01-01")).toBe(true);
    expect(isCalendarDate("2999-12-31")).toBe(true);
    expect(isCalendarDate("3000-01-01")).toBe(false);
    expect(isCalendarDate("0012-02-20")).toBe(false);
  });
});

// ----------------------------------------------------------------
// Provera pre slanja
// ----------------------------------------------------------------

describe("validateEntry", () => {
  it("sastavlja nacrt sa iznosom u parama", () => {
    const checked = validateEntry(state({ amount: "12,50" }), context());
    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.draft).toEqual({
      householdId,
      kind: "expense",
      amountMinor: 1250,
      categoryId: "food",
      personId: "ana",
      occurredOn: "2026-09-30",
      note: "pijaca",
      repeat: null,
    });
  });

  it("iznos prolazi kroz majorToMinor i nosi njegovu poruku", () => {
    expect(validateEntry(state({ amount: "1.200" }), context())).toMatchObject({
      ok: true,
      draft: { amountMinor: 120000 },
    });

    for (const amount of ["", "0", "-5", "abc", "1,234", "01"]) {
      const checked = validateEntry(state({ amount }), context());
      expect(checked.ok, amount).toBe(false);
      expect(!checked.ok && checked.message).toBe("Iznos mora biti pozitivan ceo broj.");
    }
  });

  it("beleška se čisti od praznina", () => {
    const checked = validateEntry(state({ note: "  struja  " }), context());
    expect(checked.ok && checked.draft.note).toBe("struja");
  });

  it("odbija kategoriju koje nema u ponudi", () => {
    const checked = validateEntry(state({ categoryId: "" }), context());
    expect(checked).toEqual({ ok: false, message: "Izaberite kategoriju." });
  });

  it("odbija kategoriju pogrešne vrste, iako je kategorija stvarna", () => {
    const checked = validateEntry(state({ kind: "income", categoryId: "food" }), context());
    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.message).toMatch(/nije iste vrste/);
  });

  it("odbija osobu koja nije član", () => {
    const checked = validateEntry(state({ personId: "neko-drugi" }), context());
    expect(checked).toEqual({ ok: false, message: "Izaberite osobu kojoj unos pripada." });
  });

  it("odbija neispravan datum pre nego što dođe do baze", () => {
    const checked = validateEntry(state({ occurredOn: "2026-02-30" }), context());
    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.message).toMatch(/datum/);
  });

  it("ponavljanje uzima dan iz datuma i podsetnik iz polja", () => {
    const checked = validateEntry(
      state({ occurredOn: "2026-09-05", repeat: true, remindDays: "3" }),
      context(),
    );
    expect(checked.ok && checked.draft.repeat).toEqual({ dayOfMonth: 5, remindDays: 3 });
  });

  it("ponavljanje 31. ostaje 31 — kraći mesec rešava domen, ne forma", () => {
    const checked = validateEntry(
      state({ occurredOn: "2026-01-31", repeat: true }),
      context(),
    );
    expect(checked.ok && checked.draft.repeat?.dayOfMonth).toBe(31);
  });

  it("podsetnik prolazi kroz assertRemindDays", () => {
    for (const remindDays of ["1", "7"]) {
      expect(validateEntry(state({ repeat: true, remindDays }), context()).ok, remindDays).toBe(
        true,
      );
    }

    for (const remindDays of ["0", "8", "99"]) {
      const checked = validateEntry(state({ repeat: true, remindDays }), context());
      expect(checked.ok, remindDays).toBe(false);
      expect(!checked.ok && checked.message).toBe("Podsetnik je od 1 do 7 dana.");
    }
  });

  it("podsetnik koji nije ceo broj se odbija pre Number-a", () => {
    for (const remindDays of ["", " ", "1,5", "1.5", "tri", "-1", "+1", "1e0", "NaN"]) {
      const checked = validateEntry(state({ repeat: true, remindDays }), context());
      expect(checked.ok, remindDays).toBe(false);
      expect(!checked.ok && checked.message).toBe("Podsetnik je od 1 do 7 dana.");
    }
  });

  it("ugašeno ponavljanje ne gleda podsetnik", () => {
    const checked = validateEntry(state({ repeat: false, remindDays: "bezveze" }), context());
    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.draft.repeat).toBeNull();
  });

  it("neispravan datum se javlja i kad je ponavljanje uključeno", () => {
    const checked = validateEntry(
      state({ repeat: true, occurredOn: "2026-02-31", remindDays: "2" }),
      context(),
    );
    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.message).toMatch(/datum/);
  });

  it("ne menja stanje koje je dobio", () => {
    const current = state({ note: "  struja  ", repeat: true });
    const copy = { ...current };
    validateEntry(current, context());
    expect(current).toEqual(copy);
  });
});

// ----------------------------------------------------------------
// Slanje i brava protiv dvostrukog unosa
// ----------------------------------------------------------------

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    householdId,
    kind: "expense",
    amountMinor: 1250,
    categoryId: "food",
    personId: "ana",
    occurredOn: "2026-09-30",
    note: "pijaca",
    repeat: null,
    ...overrides,
  };
}

function gateway(overrides: Partial<EntryGateway> = {}): EntryGateway {
  return {
    insertEntry: vi.fn(async () => ({ error: null })),
    createWithRule: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

const REQUEST_ID = "7a1f0d9e-2b3c-4d5e-8f60-112233445566";

/** Fabrika koja vraća isti prolaz — pozivi se broje nad njim. */
function factory(api: EntryGateway) {
  return () => api;
}

describe("saveEntry", () => {
  it("običan unos ide direktnim upisom", async () => {
    const api = gateway();
    await expect(saveEntry(draft(), factory(api), REQUEST_ID)).resolves.toEqual({ ok: true });
    expect(api.insertEntry).toHaveBeenCalledTimes(1);
    expect(api.createWithRule).not.toHaveBeenCalled();
  });

  it("unos sa ponavljanjem ide kroz atomičnu RPC, nikad kroz dva upisa", async () => {
    const api = gateway();
    const repeating = draft({ repeat: { dayOfMonth: 5, remindDays: 3 } });
    await expect(saveEntry(repeating, factory(api), REQUEST_ID)).resolves.toEqual({ ok: true });
    expect(api.createWithRule).toHaveBeenCalledTimes(1);
    expect(api.insertEntry).not.toHaveBeenCalled();

    const call = (api.createWithRule as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call?.[0] as RepeatingDraft).repeat).toEqual({ dayOfMonth: 5, remindDays: 3 });
    expect(call?.[1]).toBe(REQUEST_ID);
  });

  it("greška iz baze postaje poruka, ne izuzetak", async () => {
    const api = gateway({
      insertEntry: vi.fn(async () => ({ error: { message: "Arhivirana kategorija ne prima nove unose" } })),
    });
    await expect(saveEntry(draft(), factory(api), REQUEST_ID)).resolves.toEqual({
      ok: false,
      message: "Kategorija je u međuvremenu arhivirana. Izaberite drugu i sačuvajte ponovo.",
    });
  });

  it("pad mreže postaje poruka, ne izuzetak", async () => {
    const api = gateway({
      insertEntry: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await expect(saveEntry(draft(), factory(api), REQUEST_ID)).resolves.toEqual({
      ok: false,
      message:
        "Nema veze sa serverom. Polja su ostala popunjena — proverite internet i pokušajte ponovo.",
    });
  });

  it("bačena vrednost koja nije Error i dalje daje rečenicu", async () => {
    const api = gateway({
      createWithRule: vi.fn(async () => {
        throw "pukla veza";
      }),
    });
    const result = await saveEntry(
      draft({ repeat: { dayOfMonth: 1, remindDays: 1 } }),
      factory(api),
      REQUEST_ID,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message.length).toBeGreaterThan(0);
  });

  it("nacrt ostaje netaknut i posle pada — polja forme se ne gube", async () => {
    const original = draft({ repeat: { dayOfMonth: 9, remindDays: 2 }, note: "struja" });
    const copy = structuredClone(original);
    const api = gateway({
      createWithRule: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });

    await saveEntry(original, factory(api), REQUEST_ID);
    expect(original).toEqual(copy);
  });

  it("pad same fabrike klijenta je ishod, ne izuzetak", async () => {
    const broken = () => {
      throw new Error(
        "Nedostaje NEXT_PUBLIC_SUPABASE_URL ili NEXT_PUBLIC_SUPABASE_ANON_KEY. Vidi apps/web/.env.local.example.",
      );
    };

    const result = await saveEntry(draft(), broken, REQUEST_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe(
      "Pokušajte ponovo. Ako se ponavlja, osvežite stranu i proverite kategoriju i osobu.",
    );
  });

  it("pad fabrike vraća istu fazu kao i pad mreže, pa dugme ne ostane na „Čuvam…“", async () => {
    const broken = () => {
      throw new Error("nema okoline");
    };

    const result = await saveEntry(draft({ repeat: { dayOfMonth: 3, remindDays: 1 } }), broken, REQUEST_ID);
    expect(phaseAfter("sending", result)).toBe("idle");
    expect(canSend(phaseAfter("sending", result))).toBe(true);
  });

  it("fabrika se zove tek pri slanju, jednom po pokušaju", async () => {
    const api = gateway();
    const create = vi.fn(() => api);

    expect(create).not.toHaveBeenCalled();
    await saveEntry(draft(), create, REQUEST_ID);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------
// Idempotencija: identifikator pokušaja
// ----------------------------------------------------------------

describe("ticketFor", () => {
  let counter = 0;
  const nextId = () => `id-${(counter += 1)}`;

  it("retry istog nacrta nosi isti identifikator", () => {
    counter = 0;
    const first = ticketFor(draft(), null, nextId);
    const retry = ticketFor(draft(), first, nextId);
    expect(retry.requestId).toBe(first.requestId);
    expect(retry).toBe(first);
  });

  it("promena bilo kog polja daje nov identifikator", () => {
    counter = 0;
    const base = ticketFor(draft(), null, nextId);

    const changed: Array<Partial<EntryDraft>> = [
      { amountMinor: 1251 },
      { categoryId: "bills" },
      { personId: "marko" },
      { occurredOn: "2026-09-29" },
      { note: "drugo" },
      { kind: "income" },
      { repeat: { dayOfMonth: 30, remindDays: 1 } },
    ];

    for (const patch of changed) {
      const next = ticketFor(draft(patch), base, nextId);
      expect(next.requestId, JSON.stringify(patch)).not.toBe(base.requestId);
    }
  });

  it("promena podsetnika daje nov identifikator", () => {
    counter = 0;
    const base = ticketFor(draft({ repeat: { dayOfMonth: 5, remindDays: 1 } }), null, nextId);
    const next = ticketFor(draft({ repeat: { dayOfMonth: 5, remindDays: 4 } }), base, nextId);
    expect(next.requestId).not.toBe(base.requestId);
  });

  it("posle uspeha karta se baca, pa isti nacrt dobija nov identifikator", () => {
    counter = 0;
    const first = ticketFor(draft(), null, nextId);
    // Dve stvarne pretplate istog iznosa, dana i kategorije moraju da budu dva unosa.
    const second = ticketFor(draft(), null, nextId);
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("povratak na raniji nacrt posle izmene ne vraća stari identifikator", () => {
    counter = 0;
    const first = ticketFor(draft(), null, nextId);
    const edited = ticketFor(draft({ amountMinor: 999 }), first, nextId);
    const back = ticketFor(draft(), edited, nextId);
    expect(back.requestId).not.toBe(first.requestId);
    expect(back.requestId).not.toBe(edited.requestId);
  });

  it("ključ nacrta pokriva svako polje koje ide u bazu", () => {
    const base = draftKey(draft());
    const fields: Array<Partial<EntryDraft>> = [
      { householdId: "99999999-9999-9999-9999-999999999999" },
      { kind: "income" },
      { amountMinor: 1 },
      { categoryId: "x" },
      { personId: "y" },
      { occurredOn: "2026-01-01" },
      { note: "z" },
      { repeat: { dayOfMonth: 1, remindDays: 1 } },
    ];

    for (const patch of fields) {
      expect(draftKey(draft(patch)), JSON.stringify(patch)).not.toBe(base);
    }
  });

  it("isti nacrt uvek daje isti ključ", () => {
    expect(draftKey(draft())).toBe(draftKey(draft()));
    expect(draftKey(draft({ repeat: { dayOfMonth: 5, remindDays: 2 } }))).toBe(
      draftKey(draft({ repeat: { dayOfMonth: 5, remindDays: 2 } })),
    );
  });
});

describe("newRequestId", () => {
  it("daje ispravan v4 UUID", () => {
    const value = newRequestId();
    expect(isRequestId(value), value).toBe(true);
  });

  it("dva poziva ne daju istu vrednost", () => {
    const seen = new Set(Array.from({ length: 64 }, () => newRequestId()));
    expect(seen.size).toBe(64);
  });

  it("rezerva bez randomUUID i dalje daje ispravan v4 UUID", () => {
    const original = globalThis.crypto;
    const fallback = {
      getRandomValues: (array: Uint8Array) => original.getRandomValues(array),
    } as unknown as Crypto;

    Object.defineProperty(globalThis, "crypto", { value: fallback, configurable: true });
    try {
      const value = newRequestId();
      expect(isRequestId(value), value).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("bez crypto-a baca, pa pozivalac mora da uhvati", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(() => newRequestId()).toThrow(/crypto/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("odbija niske koje nisu v4 UUID", () => {
    for (const value of ["", "nije-uuid", "7a1f0d9e2b3c4d5e8f60112233445566", REQUEST_ID.toUpperCase()]) {
      expect(isRequestId(value), value).toBe(false);
    }
  });
});

describe("brava protiv dvostrukog slanja", () => {
  it("šalje samo iz mirovanja", () => {
    expect(canSend("idle")).toBe(true);
    expect(canSend("sending")).toBe(false);
    expect(canSend("sent")).toBe(false);
  });

  it("neuspeh otključava, uspeh ostavlja zaključano", () => {
    expect(phaseAfter("sending", { ok: true })).toBe("sent");
    expect(phaseAfter("sending", { ok: false, message: "x" })).toBe("idle");
  });

  it("ishod koji stigne van slanja ne menja fazu", () => {
    expect(phaseAfter("sent", { ok: false, message: "x" })).toBe("sent");
    expect(phaseAfter("idle", { ok: true })).toBe("idle");
  });

  it("drugi klik dok prvi traje ne pravi drugi unos", async () => {
    const api = gateway();
    let phase = canSend("idle") ? "sending" : "idle";
    expect(phase).toBe("sending");

    // Drugi klik stiže pre nego što se prvi vratio.
    if (canSend(phase as "idle" | "sending" | "sent")) {
      await saveEntry(draft(), factory(api), REQUEST_ID);
    }
    expect(api.insertEntry).not.toHaveBeenCalled();

    const result = await saveEntry(draft(), factory(api), REQUEST_ID);
    phase = phaseAfter("sending", result);
    expect(phase).toBe("sent");
    expect(api.insertEntry).toHaveBeenCalledTimes(1);
  });

  it("natpis dugmeta prati fazu", () => {
    expect(saveLabel("idle")).toBe("Sačuvaj");
    expect(saveLabel("sending")).toBe("Čuvam…");
    expect(saveLabel("sent")).toBe("Čuvam…");
  });
});

// ----------------------------------------------------------------
// Prevod grešaka
// ----------------------------------------------------------------

describe("entryErrorMessage", () => {
  it("mreža", () => {
    for (const raw of [
      "TypeError: Failed to fetch",
      "fetch failed",
      "NetworkError when attempting to fetch resource.",
      "Network request failed",
      "Load failed",
    ]) {
      expect(entryErrorMessage(raw), raw).toMatch(/Nema veze sa serverom/);
    }
  });

  it("istekla sesija", () => {
    expect(entryErrorMessage("Prijava je obavezna")).toMatch(/Prijavite se ponovo/);
    expect(entryErrorMessage("JWT expired")).toMatch(/Prijavite se ponovo/);
  });

  it("nečlan i RLS", () => {
    expect(entryErrorMessage("Niste član domaćinstva")).toMatch(/Nemate pristup/);
    expect(entryErrorMessage('new row violates row-level security policy for table "entries"')).toMatch(
      /Nemate pristup/,
    );
  });

  it("poruke okidača iz baze", () => {
    expect(entryErrorMessage("Arhivirana kategorija ne prima nove unose")).toMatch(/arhivirana/);
    expect(entryErrorMessage("Vrsta kategorije ne odgovara vrsti unosa")).toMatch(/iste vrste/);
    expect(entryErrorMessage("Kategorija ne pripada ovom domaćinstvu")).toMatch(/Osvežite stranu/);
    expect(entryErrorMessage("Osoba nije član domaćinstva")).toMatch(/nije član/);
  });

  it("dvostruko ponavljanje u istom mesecu", () => {
    expect(
      entryErrorMessage('duplicate key value violates unique constraint "entries_one_rule_per_month"'),
    ).toBe("Ovaj mesec već ima unos iz tog ponavljanja.");
  });

  it("ograničenja kolona", () => {
    expect(entryErrorMessage('violates check constraint "recurring_rules_remind_days_check"')).toMatch(
      /1 do 7/,
    );
    expect(entryErrorMessage('violates check constraint "recurring_rules_day_of_month_check"')).toMatch(
      /1 do 31/,
    );
    expect(entryErrorMessage('violates check constraint "entries_amount_minor_check"')).toMatch(
      /pozitivan/,
    );
  });

  it("nepoznata i prazna greška i dalje kažu šta sledeće", () => {
    for (const raw of [null, undefined, "", "PGRST204", "nešto deseto"]) {
      expect(entryErrorMessage(raw)).toBe(
        "Pokušajte ponovo. Ako se ponavlja, osvežite stranu i proverite kategoriju i osobu.",
      );
    }
  });

  it("nikad ne vraća sirov tekst baze", () => {
    const raw = 'duplicate key value violates unique constraint "entries_one_rule_per_month"';
    expect(entryErrorMessage(raw)).not.toContain("constraint");
  });
});
