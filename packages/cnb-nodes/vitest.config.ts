import { defineConfig } from "vitest/config";

// `@dafthunk/runtime` re-exports its Workflows runtime, which imports modules
// only the Workers runtime provides. Reuse the runtime package's own stubs so
// the module graph loads under Node.
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workflows": new URL(
        "../runtime/src/__test-stubs__/cloudflare-workflows.ts",
        import.meta.url
      ).pathname,
      "@cloudflare/sandbox": new URL(
        "../runtime/src/__test-stubs__/cloudflare-sandbox.ts",
        import.meta.url
      ).pathname,
    },
  },
});
