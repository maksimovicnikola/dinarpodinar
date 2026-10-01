/**
 * Čuvar granice `"use server"`.
 *
 * Next tretira svaki izvoz iz `"use server"` modula kao server akciju i traži da
 * to bude async funkcija. Izvoz obične vrednosti (objekat, konstanta, klasa)
 * obori stranu u izvršavanju greškom E352, a ne pri izgradnji — zato typecheck i
 * `next build` to ne uhvate.
 *
 * Test ne gleda spisak fajlova koji smo zapamtili, nego pretražuje aplikaciju i
 * proverava svaki modul koji sam proglasi `"use server"`. Nov modul je pokriven
 * bez dopune testa.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const APP_ROOT = join(import.meta.dirname, "..");
const SCANNED_DIRS = ["app", "lib", "components"];
const SOURCE = /\.(?:ts|tsx)$/;
const IS_TEST = /\.test\.(?:ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  let found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      found = found.concat(sourceFiles(full));
      continue;
    }

    if (SOURCE.test(entry) && !IS_TEST.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

/**
 * Direktiva važi samo kao prvi izraz modula, pa se prvo skidaju komentari i
 * prazni redovi. Pominjanje `"use server"` u komentaru ili usred fajla
 * (direktiva na nivou funkcije) ne čini modul server modulom.
 */
export function hasModuleLevelUseServer(source: string): boolean {
  let rest = source.replace(/^\uFEFF/, "").trimStart();

  while (rest.startsWith("//") || rest.startsWith("/*")) {
    if (rest.startsWith("//")) {
      const lineEnd = rest.indexOf("\n");
      if (lineEnd === -1) {
        return false;
      }
      rest = rest.slice(lineEnd + 1).trimStart();
      continue;
    }

    const blockEnd = rest.indexOf("*/");
    if (blockEnd === -1) {
      return false;
    }
    rest = rest.slice(blockEnd + 2).trimStart();
  }

  return /^(['"])use server\1\s*;?/.test(rest);
}

/** Fajlovi u korenu aplikacije (`proxy.ts`, `next.config.ts`) bez ulaska u `.next` i `node_modules`. */
function rootSourceFiles(): string[] {
  return readdirSync(APP_ROOT)
    .map((entry) => join(APP_ROOT, entry))
    .filter((full) => statSync(full).isFile() && SOURCE.test(full) && !IS_TEST.test(full));
}

const serverModules = [
  ...rootSourceFiles(),
  ...SCANNED_DIRS.flatMap((dir) => sourceFiles(join(APP_ROOT, dir))),
].filter((file) => hasModuleLevelUseServer(readFileSync(file, "utf8")));

describe("prepoznavanje direktive", () => {
  it("prihvata direktivu kao prvi izraz, uz komentare i oba tipa navodnika", () => {
    expect(hasModuleLevelUseServer('"use server";\n')).toBe(true);
    expect(hasModuleLevelUseServer("'use server'\n")).toBe(true);
    expect(hasModuleLevelUseServer('// napomena\n/* blok */\n"use server";\n')).toBe(true);
  });

  it("odbija pominjanje koje nije direktiva modula", () => {
    expect(hasModuleLevelUseServer('// "use server" je ovde samo u komentaru\n')).toBe(false);
    expect(hasModuleLevelUseServer('import x from "y";\n"use server";\n')).toBe(false);
    expect(hasModuleLevelUseServer('async function a() {\n  "use server";\n}\n')).toBe(false);
    expect(hasModuleLevelUseServer('"use client";\n')).toBe(false);
  });
});

describe("'use server' moduli", () => {
  it("pretraga nalazi server module (inače test ništa ne bi proveravao)", () => {
    expect(serverModules.length).toBeGreaterThan(0);
  });

  it.each(serverModules.map((file) => [file.slice(APP_ROOT.length + 1), file]))(
    "%s izvozi isključivo async funkcije",
    async (_label, file) => {
      const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
      const exported = Object.entries(loaded).filter(([name]) => name !== "__esModule");

      expect(exported.length).toBeGreaterThan(0);

      for (const [name, value] of exported) {
        // Tipovi se brišu u izvršavanju, pa ovde stižu samo pravi izvozi.
        expect(typeof value, `${name} mora biti funkcija`).toBe("function");
        expect(
          (value as { constructor: { name: string } }).constructor.name,
          `${name} mora biti async funkcija`,
        ).toBe("AsyncFunction");
      }
    },
  );
});
