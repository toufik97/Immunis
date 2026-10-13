import { defineConfig } from "vitest/config";

// Scoped to the repo suite: agent skills under .agents/ ship their own
// test files, which must never run (or time out workers) here.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
