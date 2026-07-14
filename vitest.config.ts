import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two aliases, both so that server-only modules can be unit-tested:
//   @/*         the same path alias tsconfig.json uses, which Vitest doesn't
//               read on its own.
//   server-only a no-op stub (see test/stubs/server-only.ts); the real
//               client-bundle guard is enforced by the Next.js build, not here.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
