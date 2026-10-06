import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${path}`), { path });
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerComponentSupabase: vi.fn(),
}));

const { redirect } = await import("next/navigation");
const { createServerComponentSupabase } = await import("@/lib/supabase/server");
const { default: HomePage } = await import("./page");

const mockedSupabase = vi.mocked(createServerComponentSupabase);
const redirected = vi.mocked(redirect);

const INVITE_TOKEN = "11111111-2222-4333-8444-555555555555";

async function runHomePage() {
  try {
    await HomePage();
    return { redirectedTo: null };
  } catch (caught) {
    const path = (caught as { path?: unknown }).path;
    if (typeof path !== "string") {
      throw caught;
    }
    return { redirectedTo: path };
  }
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects invited user to the pending invite instead of creating a new household", async () => {
    const membershipQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const invitationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ token: INVITE_TOKEN, email: "nova@primer.rs" }],
        error: null,
      }),
    };

    mockedSupabase.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u-1", email: "NOVA@PRIMER.RS" } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return membershipQuery;
        }
        if (table === "invitations") {
          return invitationQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as any);

    const outcome = await runHomePage();

    expect(redirected).toHaveBeenCalledWith(`/poziv/${INVITE_TOKEN}`);
    expect(outcome.redirectedTo).toBe(`/poziv/${INVITE_TOKEN}`);
  });

  it("redirects new user to create a household when there is no membership or pending invite", async () => {
    const membershipQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const invitationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    mockedSupabase.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u-2", email: "nema@primer.rs" } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return membershipQuery;
        }
        if (table === "invitations") {
          return invitationQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as any);

    const outcome = await runHomePage();

    expect(redirected).toHaveBeenCalledWith("/novo");
    expect(outcome.redirectedTo).toBe("/novo");
  });
});
