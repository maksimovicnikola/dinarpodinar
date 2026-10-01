import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Isti `@/` alias kao u tsconfig-u, da test može da uveze module aplikacije.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
