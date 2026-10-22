// Writes the list of files the service worker keeps for offline use into sw.js, with versions
// taken from the files' contents, so any change to the site reaches installed copies.
// Run after changing files: `npm run offline`. `--check` fails instead of writing (npm test).

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const hash = (files) => { const h = createHash("sha256"); for (const f of files) h.update(f).update(readFileSync(join(root, f))); return h.digest("hex").slice(0, 12); };

// everything the pages need, kept on the first visit
const core = ["index.html", "manifest.webmanifest", ...walk("css"), ...walk("js"), ...walk("assets"),
  "vendor/pdf-lib/pdf-lib.esm.min.js", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "vendor/qrcode/qrcode.js"].sort();
// the big parts only some tools use (reading scans, Repair, iPhone photos): kept once used, or
// all at once from "Save every tool for offline"
const extra = walk("vendor").filter((f) => !/LICENSE/.test(f) && !core.includes(f)).sort();
const size = extra.reduce((n, f) => n + statSync(join(root, f)).size, 0);

const block = `// files:start (written by scripts/offline-list.mjs)
const VERSION = "${hash(core)}";
const VENDOR_VERSION = "${hash(extra)}";
const CORE = ${JSON.stringify(core.map((f) => (f === "index.html" ? "./" : f)), null, 2)};
const EXTRA = ${JSON.stringify(extra, null, 2)};
const EXTRA_BYTES = ${size};
// files:end`;

const swPath = join(root, "sw.js");
const sw = readFileSync(swPath, "utf8");
const next = sw.replace(/\/\/ files:start[\s\S]*?\/\/ files:end/, block);
if (process.argv.includes("--check")) {
  if (next !== sw) { console.error("sw.js's file list is out of date: run `npm run offline`."); process.exit(1); }
} else {
  writeFileSync(swPath, next);
  console.log(`sw.js: ${core.length} core files, ${extra.length} extra (${(size / 1e6).toFixed(1)} MB), version ${hash(core)}`);
}
