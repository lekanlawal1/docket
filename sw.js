// Keeps Docket on the device so it opens and works without a connection. Nothing about
// people's files passes through here: tools read files straight from the page.
//
// App code is fetched fresh when there's a connection (so updates arrive at once) and taken
// from the cache when there isn't. The large libraries rarely change, so they come from the
// cache first.

// files:start (written by scripts/offline-list.mjs)
const VERSION = "2350d6d9b648";
const VENDOR_VERSION = "95f9fc1ff501";
const CORE = [
  "assets/apple-touch-icon.png",
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "css/docket.css",
  "./",
  "js/clean.js",
  "js/diff.js",
  "js/docx.js",
  "js/flatten.js",
  "js/formfind.js",
  "js/icons.js",
  "js/images.js",
  "js/layout.js",
  "js/main.js",
  "js/ocr.js",
  "js/pagetext.js",
  "js/pdf.js",
  "js/pictures.js",
  "js/projectfile.js",
  "js/projects.js",
  "js/qpdf.js",
  "js/ranges.js",
  "js/scanmath.js",
  "js/shrink.js",
  "js/text.js",
  "js/textsource.js",
  "js/tools.js",
  "js/tools/annotate.js",
  "js/tools/blank-pages.js",
  "js/tools/compare.js",
  "js/tools/compress-image.js",
  "js/tools/compress.js",
  "js/tools/convert-images.js",
  "js/tools/crop.js",
  "js/tools/enhance.js",
  "js/tools/extract-images.js",
  "js/tools/extract.js",
  "js/tools/fill-flat.js",
  "js/tools/fill-form.js",
  "js/tools/find.js",
  "js/tools/flatten.js",
  "js/tools/grayscale.js",
  "js/tools/images-to-pdf.js",
  "js/tools/merge.js",
  "js/tools/metadata.js",
  "js/tools/n-up.js",
  "js/tools/organise.js",
  "js/tools/page-numbers.js",
  "js/tools/paper.js",
  "js/tools/password.js",
  "js/tools/pdf-to-excel.js",
  "js/tools/pdf-to-jpg.js",
  "js/tools/pdf-to-text.js",
  "js/tools/pdf-to-word.js",
  "js/tools/photo-to-text.js",
  "js/tools/qr.js",
  "js/tools/redact.js",
  "js/tools/repair.js",
  "js/tools/resize-image.js",
  "js/tools/scan.js",
  "js/tools/searchable.js",
  "js/tools/sign.js",
  "js/tools/split.js",
  "js/tools/summary.js",
  "js/tools/watermark.js",
  "js/tools/workspace.js",
  "js/ui.js",
  "js/upscale.js",
  "js/workspace.js",
  "js/xlsx.js",
  "js/zip.js",
  "manifest.webmanifest",
  "vendor/pdf-lib/pdf-lib.esm.min.js",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs",
  "vendor/qrcode/qrcode.js"
];
const EXTRA = [
  "vendor/esrgan/realesr-general-x4v3.bin",
  "vendor/heic-to/heic-to.js",
  "vendor/qpdf/qpdf.js",
  "vendor/qpdf/qpdf.wasm",
  "vendor/tesseract/core/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/lang/eng.traineddata.gz",
  "vendor/tesseract/lang/fra.traineddata.gz",
  "vendor/tesseract/tesseract.esm.min.js",
  "vendor/tesseract/worker.min.js"
];
const EXTRA_BYTES = 18527745;
// files:end

const APP = `docket-app-${VERSION}`, LIBS = `docket-libs-${VENDOR_VERSION}`, FONTS = "docket-fonts";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (![APP, LIBS, FONTS].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// the page asks which extras are saved, and to save them all
self.addEventListener("message", (e) => {
  const reply = (msg) => e.source?.postMessage(msg);
  if (e.data === "offline-status") e.waitUntil(status().then(reply));
  if (e.data === "save-extras") e.waitUntil((async () => {
    const cache = await caches.open(LIBS);
    let done = 0;
    for (const f of EXTRA) {
      if (!(await cache.match(f))) await cache.add(f);
      reply({ type: "progress", done: ++done, of: EXTRA.length });
    }
    reply(await status());
  })().catch((err) => reply({ type: "error", message: String(err.message || err) })));
});

async function status() {
  const cache = await caches.open(LIBS);
  let saved = 0;
  for (const f of EXTRA) if (await cache.match(f)) saved++;
  return { type: "status", saved, of: EXTRA.length, bytes: EXTRA_BYTES };
}

const inScope = (url) => url.origin === location.origin;
const isLib = (url) => inScope(url) && url.pathname.includes("/vendor/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return e.respondWith(fontFirst(req));
  if (!inScope(url)) return;                                  // the portfolio bar and the like
  if (isLib(url)) return e.respondWith(cacheFirst(req));
  e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(LIBS)).put(req, res.clone());
  return res;
}

// fresh when online; the saved copy when offline or when the network is too slow to wait for
async function networkFirst(req) {
  const cache = await caches.open(APP);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  fresh.catch(() => {});                                      // offline: handled below
  const late = new Promise((r) => setTimeout(r, 4000));
  try {
    const res = await Promise.race([fresh, late.then(() => { throw new Error("slow"); })]);
    return res;
  } catch {
    const saved = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" && await cache.match("./"));
    return saved || fresh;
  }
}

async function fontFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}
