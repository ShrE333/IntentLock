import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    // Each SQL suite boots its own PostgreSQL WASM instance. Serial files avoid
    // CPU/memory contention during PGlite startup on Windows and small CI hosts.
    // Keep isolation and concurrency within each test (e.g. replay checks) intact.
    fileParallelism: false,
  },
});
