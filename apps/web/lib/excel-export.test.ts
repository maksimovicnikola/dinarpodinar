import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildHouseholdWorkbook, sheetTitle, workbookFilename, type ExportEntry } from "./excel-export";

function entry(patch: Partial<ExportEntry> = {}): ExportEntry {
  return {
    occurredOn: "2026-10-02",
    kind: "expense",
    amountMinor: 1_000_000,
    categoryName: "Računi",
    personName: "Jelena",
    note: "struja",
    repeating: true,
    ...patch,
  };
}

async function sheets(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  return workbook;
}

describe("sheetTitle", () => {
  it("naziva list kao mesec i godina", () => {
    expect(sheetTitle("2026-10")).toBe("Oktobar 2026");
    expect(sheetTitle("2026-09")).toBe("Septembar 2026");
  });
});

describe("buildHouseholdWorkbook", () => {
  it("daje po jedan list za svaki mesec, od starijeg ka novijem", async () => {
    const bytes = await buildHouseholdWorkbook({
      currency: "RSD",
      emptyMonth: "2026-10",
      entries: [
        entry({ occurredOn: "2026-10-02", kind: "expense", amountMinor: 1_000_000 }),
        entry({ occurredOn: "2026-09-05", kind: "income", amountMinor: 9_000_000, categoryName: "Plata", repeating: false, note: "" }),
      ],
    });
    const workbook = await sheets(bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Septembar 2026", "Oktobar 2026"]);

    const october = workbook.getWorksheet("Oktobar 2026");
    expect(october?.getRow(2).getCell(2).value).toBe("Trošak");
    expect(october?.getRow(2).getCell(3).value).toBe(-10_000);
    expect(october?.getRow(2).getCell(5).value).toBe("Računi");
    expect(october?.getRow(2).getCell(6).value).toBe("Jelena");
    expect(october?.getRow(2).getCell(7).value).toBe("struja");
    expect(october?.getRow(2).getCell(8).value).toBe("Da");

    const september = workbook.getWorksheet("Septembar 2026");
    expect(september?.getRow(2).getCell(2).value).toBe("Prihod");
    expect(september?.getRow(2).getCell(3).value).toBe(90_000);
    expect(september?.getRow(2).getCell(8).value).toBe("Ne");
  });

  it("prazan mesec i dalje ima list sa zaglavljem", async () => {
    const bytes = await buildHouseholdWorkbook({ currency: "RSD", entries: [], emptyMonth: "2026-10" });
    const workbook = await sheets(bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Oktobar 2026"]);
    expect(workbook.getWorksheet("Oktobar 2026")?.getRow(1).getCell(1).value).toBe("Datum");
  });
});

describe("workbookFilename", () => {
  it("čuva naziv domaćinstva", () => {
    expect(workbookFilename("Petrović")).toBe("Petrović.xlsx");
  });
});
