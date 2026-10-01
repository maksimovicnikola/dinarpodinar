/**
 * Stanje forme za pozivnicu stoji izvan `actions.ts`.
 *
 * `actions.ts` nosi direktivu `"use server"`, a Next svaki izvoz takvog modula
 * tretira kao server akciju i traži async funkciju. Izvoz obične vrednosti
 * odande obori stranu greškom E352 u izvršavanju.
 */

export type InvitationState = { error: string | null };

export const emptyInvitationState: InvitationState = { error: null };
