import { build } from "esbuild";
import { mkdir, copyFile, readdir, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const outdir = "dist/extension";
const srcdir = "extension"

await mkdir(outdir, { recursive: true });

const common = {
    bundle: true,
    sourcemap: true,
    target: "es2018",
    logLevel: "info",
};

// Recursively copy a folder (assets/icons, etc.)
async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}


// Copy a file if it exists (ignore if missing)
async function copyFileIfExists(src, dest) {
  try {
    const s = await stat(src);
    if (!s.isFile()) return;
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  } catch {
    // ignore if missing
  }
}

// Content scripts MUST NOT be modules at runtime
await build({
  ...common,
  entryPoints: [path.join(srcdir, "content", "interceptor.ts")],
  outfile: path.join(outdir, "content", "interceptor.js"),
  format: "iife",
});

await build({
  ...common,
  entryPoints: [path.join(srcdir, "background", "storage.ts")],
  outfile: path.join(outdir, "background", "storage.js"),
  format: "iife",
});

// Popup scripts can be esm, but iife is fine too if popup loads it as a normal script
await build({
  ...common,
  entryPoints: [path.join(srcdir, "ui", "dashboard.ts")],
  outfile: path.join(outdir, "ui", "dashboard.js"),
  format: "esm",
});

await build({
  ...common,
  entryPoints: [path.join(srcdir, "ui", "modal.ts")],
  outfile: path.join(outdir, "ui", "modal.js"),
  format: "esm",
});

await build({
  ...common,
  entryPoints: [path.join(srcdir, "popup.ts")],
  outfile: path.join(outdir, "popup.js"),
  format: "esm",
});

// Required Chrome extension static files:
await copyFileIfExists(
  path.join(srcdir, "manifest.json"),
  path.join(outdir, "/manifest.json")
);

await copyFileIfExists(
  path.join(srcdir, "popup.html"),
  path.join(outdir, "popup.html")
);

await copyDir(
  path.join(srcdir, "assets"),
  path.join(outdir, "assets")
);
