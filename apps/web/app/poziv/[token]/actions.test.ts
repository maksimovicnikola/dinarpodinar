/**
 * Redosled provera u prihvatanju pozivnice.
 *
 * Pozivnica je jednokratna: `accept_invitation` je potroši i upiše članstvo.
 * Ako osvežena sesija nije upisana u kolačiće, do RPC-a ne sme da se stigne —
 * inače pozvani dobije grešku, a pozivnica ostane potrošena i nepovratna.
 *
 * Teglji su samo Supabase klijent i `redirect`; provera tokena i prevod
 * grešaka idu pravim kodom. Isti slučaj nad pravom bazom stoji u šav testu
 * (`tests/podesavanja-seam.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { invitationErrorMessage } from "@/lib/auth-messages";
import type { WritableServerSupabase } from "@/lib/supabase/server";

import { emptyInvitationState, type InvitationState } from "./state";

vi.mock("@/lib/supabase/server", () => ({ createWritableServerSupabase: vi.fn() }));

vi.mock("next/navigation", () => ({
  // Pravi `redirect` prekida izvršavanje bacanjem; teglj to oponaša, da test
  // ne prođe kroz kod koji u aplikaciji nikad ne bi bio dosegnut.
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${path}`), { path });
  }),
}));

const { createWritableServerSupabase } = await import("@/lib/supabase/server");
const { redirect } = await import("next/navigation");
const { acceptInvitationAction } = await import("./actions");

const spawned = vi.mocked(createWritableServerSupabase);
const redirected = vi.mocked(redirect);

const TOKEN = "11111111-2222-4333-8444-555555555555";
const KUCA = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const REFUSED = new Error("Cookie write refused");

type RpcResult = { data: string | null; error: { message: string } | null };

/** Teglj klijenta: `cookieFailure` vraća zadati red ishoda, jedan po pozivu. */
function stubClient(
  options: {
    user?: { id: string; email: string } | null;
    cookieFailures?: unknown[];
    rpcResult?: RpcResult;
  } = {},
) {
  const { user = { id: "u-1", email: "zvani@primer.rs" }, cookieFailures = [] } = options;
  const rpcResult = options.rpcResult ?? { data: KUCA, error: null };

  const rpc = vi.fn(async () => rpcResult);
  const getUser = vi.fn(async () => ({ data: { user }, error: null }));

  let asked = 0;
  const cookieFailure = vi.fn(() => cookieFailures[asked++] ?? null);

  spawned.mockResolvedValue({
    supabase: { auth: { getUser }, rpc },
    cookieFailure,
  } as unknown as WritableServerSupabase);

  return { getUser, rpc, cookieFailure };
}

function form(token: string | null): FormData {
  const data = new FormData();
  if (token !== null) {
    data.set("token", token);
  }
  return data;
}

type Outcome = { state: InvitationState | null; redirectedTo: string | null };

/** Hvata `redirect`, koji se u pravom kodu propagira kao izuzetak. */
async function run(token: string | null): Promise<Outcome> {
  try {
    const state = await acceptInvitationAction(emptyInvitationState, form(token));
    return { state, redirectedTo: null };
  } catch (caught) {
    const path = (caught as { path?: unknown }).path;
    if (typeof path !== "string") {
      throw caught;
    }
    return { state: null, redirectedTo: path };
  }
}

/** Utiša log i vrati njegov sadržaj: diagnostika je deo ponašanja. */
async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; diagnostics: string[] }> {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const result = await work();
    // Poruke se prepisuju pre `mockRestore`, jer on briše i zapisane pozive.
    return { result, diagnostics: logged.mock.calls.map((call) => String(call[0])) };
  } finally {
    logged.mockRestore();
  }
}

describe("acceptInvitationAction i upis kolačića", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ne poziva RPC kad sesija nije upisana u kolačiće", async () => {
    const client = stubClient({ cookieFailures: [REFUSED] });

    const { result, diagnostics } = await quiet(() => run(TOKEN));

    // Ovo je ceo smisao testa: pozivnica nije ni dotaknuta.
    expect(client.rpc).not.toHaveBeenCalled();
    expect(redirected).not.toHaveBeenCalled();

    expect(result.state).toEqual({ error: invitationErrorMessage("kolacici-pre") });
    expect(result.state?.error).toMatch(/nije iskorišćena/);

    // Razlog ide u log, a ne na ekran.
    expect(diagnostics.some((line) => line.includes("nije upisana u kolačiće"))).toBe(true);
  });

  it("ne poziva RPC ni kad uz pali upis nema prijavljenog korisnika", async () => {
    // Preusmerenje na prijavu tu ne pomaže: isti pregledač bi odbio i kolačiće
    // sa prijave, pa je tačna poruka bolja od vrtnje u krug.
    const client = stubClient({ user: null, cookieFailures: [REFUSED] });

    const { result } = await quiet(() => run(TOKEN));

    expect(client.rpc).not.toHaveBeenCalled();
    expect(redirected).not.toHaveBeenCalled();
    expect(result.state).toEqual({ error: invitationErrorMessage("kolacici-pre") });
  });

  it("kad je upis prošao, kolačići se pitaju pre RPC-a i pozivnica se prihvata", async () => {
    const client = stubClient();

    const { state, redirectedTo } = await run(TOKEN);

    expect(client.rpc).toHaveBeenCalledWith("accept_invitation", { p_token: TOKEN });
    expect(redirectedTo).toBe(`/h/${KUCA}`);
    expect(state).toBeNull();

    // Redosled, ne samo broj poziva: provera stoji ispred RPC-a.
    expect(client.cookieFailure.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[0],
    );
  });

  it("pad upisa posle prihvatanja daje drugu poruku, jer je pozivnica potrošena", async () => {
    const client = stubClient({ cookieFailures: [null, REFUSED] });

    const { result } = await quiet(() => run(TOKEN));

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result.state).toEqual({ error: invitationErrorMessage("kolacici") });
    expect(result.state?.error).toMatch(/prihvaćena/);
  });

  it("neprijavljen posetilac sa ispravnim kolačićima ide na prijavu, bez RPC-a", async () => {
    const client = stubClient({ user: null });

    const { redirectedTo } = await run(TOKEN);

    expect(client.rpc).not.toHaveBeenCalled();
    expect(redirectedTo).toBe(`/login?next=%2Fpoziv%2F${TOKEN}`);
  });

  it("neispravan token ne otvara ni klijenta", async () => {
    const { state } = await run("nije-uuid");

    expect(spawned).not.toHaveBeenCalled();
    expect(state).toEqual({ error: invitationErrorMessage("token") });
  });

  it("greška iz RPC-a se prevodi, a kolačići se ne pominju", async () => {
    const client = stubClient({
      rpcResult: { data: null, error: { message: "Pozivnica je već iskorišćena" } },
    });

    const { result } = await quiet(() => run(TOKEN));

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result.state).toEqual({ error: invitationErrorMessage("iskoriscena") });
  });
});
