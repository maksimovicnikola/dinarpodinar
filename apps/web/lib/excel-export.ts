import ExcelJS from "exceljs";

const SHEET_MONTHS = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

export type ExportEntry = {
  occurredOn: string;
  kind: "expense" | "income";
  amountMinor: number;
  categoryName: string;
  personName: string;
  note: string;
  repeating: boolean;
};

/** „2026-10“ → „Oktobar 2026“. Ime lista u Excelu. */
export function sheetTitle(monthKey: string): string {
  const [yearText, monthText] = monthKey.split("-");
  const month = Number(monthText);
  const name = SHEET_MONTHS[month - 1];
  if (!yearText || !name) {
    throw new Error("Mesec mora biti YYYY-MM.");
  }
  return `${name} ${yearText}`;
}

export function workbookFilename(householdName: string): string {
  const cleaned = householdName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${cleaned || "dinar-po-dinar"}.xlsx`;
}

function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function signedMajor(entry: ExportEntry): number {
  const signed = entry.kind === "expense" ? -entry.amountMinor : entry.amountMinor;
  return signed / 100;
}

function utcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12));
}

/**
 * Jedan list po mesecu, hronološki. Iznos je broj: prihod pozitivan, trošak negativan,
 * pa zbir kolone jeste trenutno stanje tog meseca.
 */
export async function buildHouseholdWorkbook(input: {
  currency: string;
  entries: readonly ExportEntry[];
  emptyMonth: string;
}): Promise<Uint8Array> {
  const byMonth = new Map<string, ExportEntry[]>();
  for (const entry of input.entries) {
    const key = monthKeyOf(entry.occurredOn);
    const rows = byMonth.get(key);
    if (rows) rows.push(entry);
    else byMonth.set(key, [entry]);
  }

  const months = [...byMonth.keys()].sort();
  if (months.length === 0) months.push(input.emptyMonth);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dinar po dinar";

  for (const month of months) {
    const sheet = workbook.addWorksheet(sheetTitle(month), {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Datum", key: "date", width: 14 },
      { header: "Vrsta", key: "kind", width: 12 },
      { header: "Iznos", key: "amount", width: 16 },
      { header: "Valuta", key: "currency", width: 10 },
      { header: "Kategorija", key: "category", width: 22 },
      { header: "Osoba", key: "person", width: 18 },
      { header: "Beleška", key: "note", width: 36 },
      { header: "Ponavljanje", key: "repeat", width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };

    const rows = (byMonth.get(month) ?? []).slice().sort((a, b) => {
      if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
      const category = a.categoryName.localeCompare(b.categoryName, "sr");
      if (category !== 0) return category;
      return a.personName.localeCompare(b.personName, "sr");
    });

    for (const entry of rows) {
      const added = sheet.addRow({
        date: utcDate(entry.occurredOn),
        kind: entry.kind === "income" ? "Prihod" : "Trošak",
        amount: signedMajor(entry),
        currency: input.currency,
        category: entry.categoryName,
        person: entry.personName,
        note: entry.note,
        repeat: entry.repeating ? "Da" : "Ne",
      });
      added.getCell("date").numFmt = "dd.mm.yyyy";
      added.getCell("amount").numFmt = "#,##0.00";
    }

    const last = Math.max(sheet.rowCount, 1);
    if (rows.length > 0) {
      sheet.autoFilter = { from: "A1", to: `H${last}` };
      const total = sheet.addRow([]);
      total.getCell(1).value = "Trenutno stanje";
      total.getCell(1).font = { bold: true };
      total.getCell(3).value = { formula: `SUM(C2:C${last})` };
      total.getCell(3).numFmt = "#,##0.00";
      total.getCell(3).font = { bold: true };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
