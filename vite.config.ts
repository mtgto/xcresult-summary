import { defineConfig } from "vite";

// Bundles the action into a single ESM file for Node.js. GitHub Actions runs dist/index.mjs
// directly without installing dependencies, so all dependencies are bundled.
export default defineConfig({
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    target: "node24",
    minify: false,
    rolldownOptions: {
      output: { format: "es", entryFileNames: "index.mjs" },
    },
  },
  ssr: {
    noExternal: true,
    target: "node",
  },
});
