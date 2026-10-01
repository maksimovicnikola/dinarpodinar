import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  resolve: {
    // Isti `@/` alias kao u tsconfig-u, da test može da uveze module aplikacije.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // `tests/` traži pokrenut Supabase i izgrađenu aplikaciju, pa ne ulazi u
    // podrazumevani ran. Ide kroz `pnpm test:seam` (vitest.seam.config.ts).
    exclude: [...configDefaults.exclude, "tests/**"],
  },
});
