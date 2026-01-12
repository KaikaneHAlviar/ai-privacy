import { mkdir, cp } from "fs/promises";
import { existsSync } from "fs";

const SRC = "extension";
const DEST = "dist/extension";

async function copyIfExists(src, dest) {
  if (!existsSync(src)) return;
  await cp(src, dest, { recursive: true });
}

async function main() {
  await mkdir(DEST, { recursive: true });

  // Copy required static files
  await copyIfExists(`${SRC}/manifest.json`, `${DEST}/manifest.json`);
  await copyIfExists(`${SRC}/popup.html`, `${DEST}/popup.html`);

  // (Optional later)
  // await copyIfExists(`${SRC}/icons`, `${DEST}/icons`);
}

main().catch((err) => {
  console.error("Failed to copy static files:", err);
  process.exit(1);
});
