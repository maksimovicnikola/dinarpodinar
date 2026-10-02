/** Isto pravilo kao na webu: ime se pita samo dok nalog nema sačuvano ime. */
export function needsDisplayName(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return true;
  }

  const raw = "display_name" in metadata ? metadata.display_name : null;
  const name = typeof raw === "string" ? raw.trim() : "";
  return name.length < 2;
}

export function checkedDisplayName(raw: string): string | null {
  const value = raw.trim();
  return value.length >= 2 && value.length <= 80 ? value : null;
}
