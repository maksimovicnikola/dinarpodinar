/**
 * Ime se pita samo za nalog koji ga još nema. Postojeći nalog nosi
 * `display_name` u metapodacima od prve prijave, pa se kasnije ne pita ponovo.
 * Prazno ili jednoslovno ime se ne računa.
 */
export function needsDisplayName(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return true;
  }

  const raw = "display_name" in metadata ? metadata.display_name : null;
  const name = typeof raw === "string" ? raw.trim() : "";
  return name.length < 2;
}

/** Prijava koja je već uspela, ali nov nalog još treba da kaže ime. */
export function loginNamePath(next: string): string {
  const params = new URLSearchParams({ ime: "1", next });
  return `/login?${params.toString()}`;
}
