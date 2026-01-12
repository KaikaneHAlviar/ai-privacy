import { build } from "esbuild";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const outdir = "dist/extension";

await mkdir(outdir, { recursive: true });

const common = {
    bundle: true,
    sourcemap: true,
    target: "es2018",
    logLevel: "info",
};

// Content scripts MUST NOT be modules at runtime
await build({
  ...common,
  entryPoints: ["extension/content/interceptor.ts"],
  outfile: "dist/extension/content/interceptor.js",
  format: "iife",
});

await build({
  ...common,
  entryPoints: ["extension/background/storage.ts"],
  outfile: "dist/extension/background/storage.js",
  format: "iife",
});

// Popup scripts can be esm, but iife is fine too if popup loads it as a normal script
await build({
  ...common,
  entryPoints: ["extension/ui/dashboard.ts"],
  outfile: "dist/extension/ui/dashboard.js",
  format: "esm",
});

await build({
  ...common,
  entryPoints: ["extension/popup.ts"],
  outfile: "dist/extension/popup.js",
  format: "esm",
});