export type EntryKind = "expense" | "income";

export type EntrySnapshot = {
  id: string;
  kind: EntryKind;
  amountMinor: number;
  categoryId: string;
  personId: string;
  personName: string;
  occurredOn: string;
};

export type CategorySnapshot = {
  id: string;
  name: string;
  kind: EntryKind;
  limitMinor: number | null;
};
