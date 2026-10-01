import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Šav testovi: traže pokrenut lokalni Supabase i `pnpm --filter web build`.
 * Drže se van podrazumevanog rana jer dižu pravi `next start` i pišu u bazu.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Jedan server i jedna priprema po fajlu; paralelni ran bi se tukao oko porta.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
