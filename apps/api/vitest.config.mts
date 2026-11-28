import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC is needed so decorator metadata is emitted for NestJS dependency injection in tests.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Integration suites recreate the schema and run every migration in beforeAll; with 17+ migrations that takes
    // more than the 10s default on slower local PostgreSQL (CI is faster). Test bodies keep the default timeout.
    hookTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
