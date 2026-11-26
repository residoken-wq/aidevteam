import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC is needed so decorator metadata is emitted for NestJS dependency injection in tests.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
