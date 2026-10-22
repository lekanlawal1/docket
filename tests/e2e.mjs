// Drives every tool in a real browser with generated files and checks what comes out.
// Run: node tests/e2e.mjs   (needs Playwright; set PW to its index.mjs if it isn't installed locally)
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { makeFixtures } from "./fixtures.mjs";

const { chromium } = await import(process.env.PW || "playwright");
const root = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".gz": "application/gzip" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
// BASE=https://.../docket/ runs the same checks against a deployed copy
const base = process.env.BASE || `http://localhost:${server.address().port}/`;

const fx = await mkdtemp(join(tmpdir(), "docket-"));
await makeFixtures(fx);
const lease = join(fx, "lease.pdf"), second = join(fx, "second.pdf"), form = join(fx, "form.pdf"), photo = join(fx, "photo.pdf"), bail = join(fx, "bail.pdf");

const browser = await chromium.launch({
  ...(process.env.CHROME && { executablePath: process.env.CHROME }),
  // behind a proxy, a deployed copy can only be reached through it
  ...(process.env.BASE && process.env.HTTPS_PROXY && { proxy: { server: process.env.HTTPS_PROXY } }),
});
const page = await browser.newPage({ acceptDownloads: true, ignoreHTTPSErrors: !!process.env.CHROME, viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// web fonts come from Google; a blocked font isn't the site's fault
page.on("console", (m) => m.type() === "error" && !/fonts\.g|portfolio-bar|ERR_CERT|ERR_TUNNEL/.test(m.text() + m.location().url) && errors.push(m.text()));

// a picture for the image tools: a screenshot of the home page will do
await page.goto(base);
const png = join(fx, "harbour.png");
await page.screenshot({ path: png });

let failed = 0;
async function check(name, fn) {
  const before = errors.length;
  try {
    await fn();
    if (errors.length > before) throw new Error("console: " + errors.slice(before).join(" | "));
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${err.message.split("\n")[0]}`);
  }
}

async function open(id, files) {
  // going to the same hash twice doesn't reload the tool, so start from home each time
  await page.goto(base);
  await page.goto(base + "#/" + id);
  await page.waitForSelector(".workbench");
  if (files) await page.locator(".main .dock input").first().setInputFiles(files);
}

// clicks `button` and returns the downloaded file's bytes and name
async function save(button = ".desk .go") {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.locator(button).click()]);
  return { name: dl.suggestedFilename(), data: await readFile(await dl.path()) };
}

// pages and text of a PDF, read by the site's own copy of pdf.js
const readPdf = (data) => page.evaluate(async (b64) => {
  const { openForView, pageTexts } = await import(new URL("js/pdf.js", location.href).href);
  const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return { pages: doc.numPages, texts: await pageTexts(doc) };
}, data.toString("base64"));

const pdfLib = () => import("../vendor/pdf-lib/pdf-lib.esm.min.js");
const zipNames = async (data) => {
  const path = join(fx, "out.zip");
  await (await import("node:fs/promises")).writeFile(path, data);
  const script = "import sys, zipfile\nprint('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))";
  return (await import("node:child_process")).execFileSync("python3", ["-c", script, path], { encoding: "utf8" }).trim().split("\n");
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const goodStatus = async () => expect(await page.locator(".desk .status.good").count(), "no success message: " + await page.locator(".desk .status").innerText());

await check("home lists every pier and toolbox search filters", async () => {
  await page.goto(base);
  expect(await page.locator(".berth").count() >= 20, "too few tools");
  await page.fill("input[type=search]", "redact");
  expect(await page.locator(".berth:visible").count() === 1, "search didn't filter");
});

await check("night mode toggles and is remembered", async () => {
  await page.click("#theme");
  await page.reload();
  expect(await page.getAttribute("html", "data-theme") === "night", "not night after reload");
  await page.click("#theme");
});

await check("the portfolio bar only loads for visitors from the portfolio", async () => {
  const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
  const p1 = await fresh.newPage();
  await p1.goto(base);
  expect(await p1.locator('script[src*="portfolio-bar.js"]').count() === 0, "bar loaded for a direct visit");
  await p1.goto(base, { referer: "https://lekanlawal1.github.io/portfolio-site/index.html#docket" });
  expect(await p1.locator('script[src*="portfolio-bar.js"]').count() === 1, "bar missing for a visitor from the portfolio");
  await p1.reload();
  expect(await p1.locator('script[src*="portfolio-bar.js"]').count() === 1, "bar gone after a reload");
  await fresh.close();
});

await check("merge", async () => {
  await open("merge", [lease, second]);
  const out = await readPdf((await save()).data);
  expect(out.pages === 5, `expected 5 pages, got ${out.pages}`);
});

await check("split into a zip", async () => {
  await open("split", [lease]);
  const { name, data } = await save();
  expect(name.endsWith(".zip") && data[0] === 0x50, "not a zip: " + name);
});

await check("extract", async () => {
  await open("extract", [lease]);
  await page.fill(".desk input[type=text]", "2-3");
  expect((await readPdf((await save()).data)).pages === 2, "wrong page count");
});

await check("organise", async () => {
  await open("organise", [lease]);
  await page.waitForSelector(".page-card");
  expect((await readPdf((await save()).data)).pages === 4, "wrong page count");
});

await check("pdf to jpg", async () => {
  await open("pdf-to-jpg", [lease]);
  await page.fill("[name=pages]", "1");
  const { name, data } = await save();
  expect(name.endsWith(".jpg") && data[0] === 0xff, "not a jpg: " + name);
});

await check("images to pdf", async () => {
  await open("images-to-pdf", [png, png]);
  expect((await readPdf((await save()).data)).pages === 2, "wrong page count");
});

await check("pdf to text", async () => {
  await open("pdf-to-text", [lease]);
  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Harbour Road"));
});

await check("sign (typed, placed on page 1)", async () => {
  await open("sign", [lease]);
  await page.click("[data-tab=type]");
  await page.fill("[name=typed]", "Jordan Example");
  await page.waitForSelector(".stage canvas");
  await page.locator(".stage canvas").click({ position: { x: 150, y: 300 } });
  expect((await readPdf((await save()).data)).pages === 4, "wrong page count");
});

await check("fill form", async () => {
  await open("fill-form", [form]);
  await page.fill("#f0", "Sam Rowe");
  const { data } = await save();
  const { PDFDocument } = await import("../vendor/pdf-lib/pdf-lib.esm.min.js");
  const filled = (await PDFDocument.load(data)).getForm().getTextField("full_name").getText();
  expect(filled === "Sam Rowe", "field holds " + filled);
});

await check("page numbers", async () => {
  await open("page-numbers", [lease]);
  const out = await readPdf((await save()).data);
  expect(out.texts[3].includes("4"), "no number on page 4");
});

await check("watermark", async () => {
  await open("watermark", [lease]);
  const out = await readPdf((await save()).data);
  expect(out.texts.every((t) => t.includes("DRAFT")), "watermark missing on a page");
});

await check("redact by search, and the text is really gone", async () => {
  await open("redact", [lease]);
  await page.fill("[name=find]", "4417-2290, Jordan");
  await page.click(".mark");
  const out = await readPdf((await save()).data);
  await goodStatus();
  const all = out.texts.join(" ");
  expect(!all.includes("4417") && !all.includes("Jordan"), "redacted text still readable");
  expect(out.pages === 4, "page count changed");
});

await check("metadata is shown and removed", async () => {
  await open("metadata", [lease]);
  await page.waitForSelector("text=Jordan Secret-Author");
  const { data } = await save();
  expect(!data.toString("latin1").includes("Secret-Author"), "author still in the file");
  await goodStatus();
});

await check("compress refuses when the result isn't smaller", async () => {
  await open("compress", [lease]);
  await page.locator(".desk .go").click();
  await page.waitForSelector(".desk .status.bad, .desk .status.good", { timeout: 30_000 });
});

await check("compress shrinks the pictures and keeps the text", async () => {
  await open("compress", [photo]);
  const before = (await readFile(photo)).length;
  const { data } = await save();
  await goodStatus();
  expect(data.length < before * 0.5, `only ${before} -> ${data.length} bytes`);
  const out = await readPdf(data);
  expect(out.texts[0].includes("Harbour inspection report"), "text lost");
  const { PDFDocument, PDFName, PDFDict } = await pdfLib();
  const xo = (await PDFDocument.load(data)).getPage(0).node.Resources().lookup(PDFName.of("XObject"), PDFDict);
  expect(xo && xo.keys().length === 1, "picture missing");
});

await check("grayscale", async () => {
  await open("grayscale", [lease]);
  expect((await readPdf((await save()).data)).pages === 4, "wrong page count");
});

await check("summary from a PDF", async () => {
  await open("summary", [lease]);
  await page.waitForSelector("ol.out-text li");
});

await check("find dates, amounts and contacts, then CSV", async () => {
  await open("find", [lease]);
  await page.waitForSelector(".found-group");
  const text = await page.locator(".results").innerText();
  for (const v of ["$1,450", "March 1, 2026", "landlord@example.com", "(705) 555-0142"]) expect(text.includes(v), "missed " + v);
  const { data } = await save();
  expect(data.toString().startsWith("Type,Value"), "bad csv");
});

await check("resize image to a preset", async () => {
  await open("resize-image", [png]);
  await page.check("[name=mode][value=preset]");
  const { name } = await save();
  expect(name.includes("1080x1080"), "name: " + name);
});

await check("compress image under 100 KB", async () => {
  await open("compress-image", [png]);
  await page.selectOption("[name=limit]", "100");
  const { data } = await save();
  expect(data.length <= 100 * 1024, `still ${data.length} bytes`);
});

// iPhone photos: libheif's own sample image, fetched at test time rather than kept in the repo
const heic = join(fx, "example.heic");
const haveHeic = await fetch("https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic")
  .then(async (r) => r.ok && (await (await import("node:fs/promises")).writeFile(heic, Buffer.from(await r.arrayBuffer())), true)).catch(() => false);

await check("iPhone photos (HEIC) open in Chromium, which can't read them itself", async () => {
  if (!haveHeic) { console.log("     (skipped: couldn't download the sample HEIC)"); return; }
  await open("resize-image", [heic]);
  await page.waitForSelector(".main .result", { timeout: 60_000 });
  const size = await page.locator(".main .result small").innerText();
  expect(/\d+ × \d+/.test(size), "no picture size shown: " + size);
  const { name, data } = await save();
  expect(name.endsWith(".jpg") && data[0] === 0xff && data[1] === 0xd8, "not a JPG: " + name);
  await open("images-to-pdf", [heic]);
  await page.waitForSelector(".lineup li", { timeout: 60_000 });
  expect((await readPdf((await save()).data)).pages === 1, "the photo didn't become a page");
});

await check("qr code", async () => {
  await open("qr");
  await page.fill("[name=text]", "https://example.com");
  const { data } = await save(".desk .png");
  expect(data[1] === 0x50, "not a png");
});

await check("paper", async () => {
  await open("paper");
  await page.fill("[name=pages]", "3");
  expect((await readPdf((await save()).data)).pages === 3, "wrong page count");
});

await check("password: lock, refuse a wrong password, unlock", async () => {
  await open("password", [lease]);
  await page.fill("[name=pw]", "harbour light");
  await page.fill("[name=pw2]", "harbour light");
  const locked = await save(".desk .lock");
  await goodStatus();
  const needsPassword = await page.evaluate(async (b64) => {
    const { openForView } = await import(new URL("js/pdf.js", location.href).href);
    try { await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); return false; }
    catch (e) { return e.name === "PasswordException"; }
  }, locked.data.toString("base64"));
  expect(needsPassword, "locked file opened without a password");

  const lockedPath = join(fx, "lease-locked.pdf");
  await (await import("node:fs/promises")).writeFile(lockedPath, locked.data);
  await open("password", [lockedPath]);
  await page.waitForSelector("[data-for=unlock]:not([hidden])");
  await page.fill("[name=current]", "wrong");
  await page.click(".desk .unlock");
  await page.waitForSelector(".desk .status.bad");
  await page.fill("[name=current]", "harbour light");
  const out = await readPdf((await save(".desk .unlock")).data);
  expect(out.texts[0].includes("Harbour Road"), "unlocked text missing");
});

await check("make searchable: a scan becomes searchable text", async () => {
  // turn the lease into a "scan": every page redrawn as a picture, so no text is left
  const scan = await page.evaluate(async (b64) => {
    const { rasterize } = await import(new URL("js/pdf.js", location.href).href);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // page 4 has /Rotate 90, so its scan has the text running sideways
    const out = await rasterize(bytes, { which: new Set([0, 3]), scale: 2 });
    let s = ""; for (const b of out) s += String.fromCharCode(b);
    return btoa(s);
  }, (await readFile(lease)).toString("base64"));
  const scanPath = join(fx, "scan.pdf");
  await (await import("node:fs/promises")).writeFile(scanPath, Buffer.from(scan, "base64"));
  expect(!(await readPdf(Buffer.from(scan, "base64"))).texts[0].trim(), "the scan still has text");

  await open("searchable", [scanPath]);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.locator(".desk .go").click()]);
  const out = await readPdf(await readFile(await dl.path()));
  for (const w of ["Harbour Road", "1,450", "landlord@example.com"]) expect(out.texts[0].includes(w), `"${w}" not found in: ${out.texts[0].slice(0, 200)}`);
  // on a sideways page every word is its own line, so compare with the line breaks taken out
  expect(out.texts[3].replace(/\s+/g, " ").includes("Harbour Road"), "the sideways page wasn't read");
  expect(out.texts[1].includes("Page 2"), "page 2 (already text) lost its text");
});

await check("make searchable reads French, accents and all", async () => {
  const scan = await page.evaluate(async (b64) => {
    const { rasterize } = await import(new URL("js/pdf.js", location.href).href);
    const out = await rasterize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { scale: 2 });
    let s = ""; for (const b of out) s += String.fromCharCode(b);
    return btoa(s);
  }, (await readFile(bail)).toString("base64"));
  const scanPath = join(fx, "bail-scan.pdf");
  await (await import("node:fs/promises")).writeFile(scanPath, Buffer.from(scan, "base64"));
  await open("searchable", [scanPath]);
  await page.selectOption("[name=lang]", "fra");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.locator(".desk .go").click()]);
  const text = (await readPdf(await readFile(await dl.path()))).texts[0].replace(/\s+/g, " ");
  for (const w of ["Bail résidentiel", "réparations nécessaires", "délai raisonnable", "dépôt de garantie"]) expect(text.includes(w), `"${w}" not found in: ${text.slice(0, 160)}`);
});

await check("pdf to word", async () => {
  await open("pdf-to-word", [lease]);
  await page.waitForSelector(".doc-preview p");
  const { name, data } = await save();
  expect(name.endsWith(".docx"), "name: " + name);
  const script = "import sys, zipfile, xml.dom.minidom\nz = zipfile.ZipFile(sys.argv[1])\nfor n in z.namelist(): xml.dom.minidom.parseString(z.read(n))\nprint(z.read('word/document.xml').decode())";
  const path = join(fx, "lease.docx");
  await (await import("node:fs/promises")).writeFile(path, data);
  const xml = (await import("node:child_process")).execFileSync("python3", ["-c", script, path], { encoding: "utf8" });
  for (const w of ["14 Harbour Road", "$1,450", "landlord@example.com"]) expect(xml.includes(w), "missing " + w);
});

await check("pdf to word carries pictures over, in place", async () => {
  await open("pdf-to-word", [photo]);
  await page.waitForSelector(".doc-preview img");
  const names = await zipNames((await save()).data);
  expect(names.some((n) => /^word\/media\/image1\.(jpeg|png)$/.test(n)), "no picture in the .docx: " + names.join(", "));
  const shape = await page.$$eval(".doc-preview > *", (els) => els.map((e) => (e.querySelector("img") ? "img" : e.tagName.toLowerCase())));
  expect(shape.join(" ") === "h2 img" || shape.join(" ") === "p img", "order: " + shape.join(" "));
});

await check("pdf to word on a browser-printed document keeps its structure", async () => {
  // a real-world PDF: printed by Chromium, with a running header, page numbers and drawn bullets
  const para = "The tenant agrees to keep the unit clean and in good repair, to report any damage promptly, and to allow reasonable access for repairs with written notice.";
  const printer = await browser.newPage();
  // a chart-like picture for the body, and a small logo for the running header
  const pic = (w, h, hue) => printer.evaluate(([w, h, hue]) => {
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), x = c.getContext("2d");
    for (let i = 0; i < 12; i++) { x.fillStyle = `hsl(${hue + i * 9}, 60%, ${40 + i * 3}%)`; x.fillRect(i * (w / 12), h - (i + 3) * (h / 16), w / 12 - 4, (i + 3) * (h / 16)); }
    return c.toDataURL("image/png");
  }, [w, h, hue]);
  const chart = await pic(600, 300, 190), logo = await pic(120, 40, 20);
  await printer.setContent(`<body style="font-family: Georgia, serif; font-size: 12pt; margin: 0">
    <h1>Residential Lease</h1><p>Made on <b>March 1, 2026</b> between the <i>landlord</i> and the tenant.</p>
    <h2>1. Rent</h2><p>${para} ${para}</p><img src="${chart}" style="width: 300px; display: block"><table style="border-collapse: collapse; margin: 0 0 12px"><tr><th style="text-align:left; padding: 3px 14px 3px 0">Fee</th><th style="text-align:right; padding: 3px 14px">When</th><th style="text-align:right; padding: 3px 0 3px 14px">Amount</th></tr>
      <tr><td style="padding: 3px 14px 3px 0">Rent</td><td style="text-align:right; padding: 3px 14px">1st of the month</td><td style="text-align:right; padding: 3px 0 3px 14px">$1,450.00</td></tr>
      <tr><td style="padding: 3px 14px 3px 0">Parking</td><td style="text-align:right; padding: 3px 14px">1st of the month</td><td style="text-align:right; padding: 3px 0 3px 14px">$75.00</td></tr>
      <tr><td style="padding: 3px 14px 3px 0">Late fee</td><td style="text-align:right; padding: 3px 14px">after the 5th</td><td style="text-align:right; padding: 3px 0 3px 14px">$50.00</td></tr></table>
    <p>Payments can be made by:</p>
    <ul><li>e-transfer to the landlord</li><li>post-dated cheques</li><li>pre-authorised debit</li></ul>
    <h2>2. Ending the lease</h2>${`<p>${para} ${para} ${para}</p>`.repeat(9)}</body>`);
  const printed = join(fx, "printed.pdf");
  await printer.pdf({ path: printed, format: "Letter", margin: { top: "72px", bottom: "72px", left: "72px", right: "72px" }, displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;width:100%;text-align:center"><img src="${logo}" style="width:60px;height:20px"> Harbour Rentals - Lease</div>`,
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
  await printer.close();

  await open("pdf-to-word", [printed]);
  await page.waitForSelector(".doc-preview p");
  const shape = await page.$$eval(".doc-preview > *", (els) => els.map((e) => (e.querySelector("img") ? "img" : e.tagName === "TABLE" ? `table${e.rows.length}x${e.rows[0].cells.length}` : e.tagName === "P" ? (e.className === "li" ? "li" : "p") : e.tagName.toLowerCase())));
  const text = await page.locator(".doc-preview").innerText();
  expect(shape.join(" ") === "h2 p h3 p img table4x3 p li li li h3 " + "p ".repeat(9).trim(), "structure: " + shape.join(" ") + " | " + text.split("\n").filter(Boolean).map((t) => t.length + ":" + t.slice(-25)).join(" / "));
  expect(!/Harbour Rentals|Page \d of/.test(text), "header or footer kept");
  expect(await page.locator(".doc-preview b", { hasText: "March 1, 2026" }).count() === 1, "bold lost");
});

// ---- the interactive parts: dragging, drawing, reordering, and codes a phone can read


await check("organise: remove, move, turn and drag pages", async () => {
  await open("organise", [lease]);
  await page.waitForSelector(".page-card");
  await page.click('[aria-label="Remove page 2"]');            // 1 3 4
  await page.click('[aria-label="Move page 4 earlier"]');      // 1 4 3
  await page.click('[aria-label="Turn page 1"]');
  const cards = page.locator(".page-card");
  await cards.nth(2).dragTo(cards.nth(0));                      // 3 1 4
  const { data } = await save();
  const out = await readPdf(data);
  const order = out.texts.map((t) => t.match(/Page (\d)/)[1]).join(" ");
  expect(order === "3 1 4", "order " + order);
  const { PDFDocument } = await pdfLib();
  const turns = (await PDFDocument.load(data)).getPages().map((p) => p.getRotation().angle).join(" ");
  // page 1 was turned once; page 4 already had a quarter turn set in the file
  expect(turns === "0 90 90", "rotations " + turns);
});

await check("organise by touch: hold, slide, let go; a quick swipe doesn't move anything", async () => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true, ignoreHTTPSErrors: true });
  const tp = await phone.newPage();
  tp.on("pageerror", (e) => errors.push(e.message));
  await tp.goto(base + "#/organise");
  await tp.locator(".main .dock input").setInputFiles(lease);
  await tp.waitForSelector(".page-card");
  const cdp = await phone.newCDPSession(tp);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const centre = async (i) => { const b = await tp.locator(".page-card").nth(i).locator(".thumb").boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const labels = () => tp.$$eval(".page-card .label > span:first-child", (els) => els.map((e) => e.textContent.replace("Page ", "")).join(" "));

  // a quick upward swipe, the way people scroll: from page 3 toward page 1. A scroll, not a move.
  let [x0, y0] = await centre(2), [x1, y1] = await centre(0);
  await touch("touchStart", x0, y0);
  for (let k = 1; k <= 5; k++) await touch("touchMove", x0 + ((x1 - x0) * k) / 5, y0 + ((y1 - y0) * k) / 5);
  await touch("touchEnd");
  expect(await labels() === "1 2 3 4", "a swipe moved a page: " + await labels());

  // hold page 1, then slide it onto page 2 beside it (once the swipe's scroll has stopped gliding)
  await tp.waitForTimeout(1200);
  await tp.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));        // pages 1 and 3 both on screen
  await tp.waitForFunction(() => scrollY === 0);
  [x0, y0] = await centre(0); [x1, y1] = await centre(1);
  await touch("touchStart", x0, y0);
  await tp.waitForTimeout(500);
  for (let k = 1; k <= 8; k++) await touch("touchMove", x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8);
  await touch("touchEnd");
  expect(await labels() === "2 1 3 4", `hold and slide didn't move page 1 to second: ${await labels()} (from ${x0|0},${y0|0} to ${x1|0},${y1|0}, scrollY ${await tp.evaluate(() => scrollY)})`);
  await phone.close();
});

await check("redact a box drawn by hand, and it's black in the result", async () => {
  await open("redact", [lease]);
  await page.waitForSelector(".stage canvas");
  const r = await page.locator(".stage").boundingBox();
  // a box over the top third of page 1, where all the lease text is
  await page.mouse.move(r.x + r.width * 0.05, r.y + r.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.95, r.y + r.height * 0.32, { steps: 8 });
  await page.mouse.up();
  expect(await page.locator(".stage .box").count() === 1, "no box drawn");
  const { data } = await save();
  await goodStatus();
  const result = await page.evaluate(async (b64) => {
    const { openForView, drawPage, pageTexts } = await import(new URL("js/pdf.js", location.href).href);
    const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const { canvas } = await drawPage(doc, 1, { width: 400 });
    const px = canvas.getContext("2d").getImageData(200, Math.round(canvas.height * 0.15), 1, 1).data;
    return { texts: await pageTexts(doc), px: [...px] };
  }, data.toString("base64"));
  expect(!result.texts[0].includes("Harbour"), "text under the box is still there");
  expect(result.texts[1].includes("Harbour"), "page 2 should be untouched");
  expect(result.px[0] < 30 && result.px[1] < 30 && result.px[2] < 30, "box isn't black: " + result.px);
});

await check("sign with a drawn signature, kept through a tab switch", async () => {
  await open("sign", [lease]);
  await page.waitForSelector(".stage canvas");
  const pad = await page.locator("canvas.pad").boundingBox();
  await page.mouse.move(pad.x + 20, pad.y + pad.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + 20 + i * 15, pad.y + pad.height * (0.6 + 0.25 * Math.sin(i)), { steps: 2 });
  await page.mouse.up();
  await page.click("[data-tab=type]");
  await page.click("[data-tab=draw]");
  await page.locator(".stage canvas").click({ position: { x: 200, y: 400 } });
  expect(await page.locator(".stage .sig").count() === 1, "signature not placed (lost on tab switch?)");
  const { data } = await save();
  const { PDFDocument, PDFName, PDFDict } = await pdfLib();
  const res = (await PDFDocument.load(data)).getPage(0).node.Resources();
  const xobjects = res.lookup(PDFName.of("XObject"), PDFDict);
  expect(xobjects && xobjects.keys().length >= 1, "no signature image on page 1");
});

await check("merge in a new order", async () => {
  await open("merge", [lease, second]);
  await page.click('[aria-label="Move second.pdf up"]');
  const out = await readPdf((await save()).data);
  expect(out.texts[0].includes("A second file") && out.texts[1].includes("Page 1"), "order not applied");
});

await check("split every 2 pages, and one file per page", async () => {
  await open("split", [lease]);
  await page.check("[name=mode][value=every]");
  await page.fill("[name=every]", "2");
  expect((await zipNames((await save()).data)).length === 2, "every 2 pages should make 2 files");
  await page.check("[name=mode][value=each]");
  expect((await zipNames((await save()).data)).length === 4, "one per page should make 4 files");
});

await check("qr codes decode to exactly what was typed", async () => {
  const decode = async () => {
    const { data } = await save(".desk .png");
    await page.addScriptTag({ path: new URL("../node_modules/jsqr/dist/jsQR.js", import.meta.url).pathname });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)?.data ?? null;
    }, data.toString("base64"));
  };
  await open("qr");
  await page.fill("[name=text]", "https://lekanlawal1.github.io/docket/ café ✓");
  expect(await decode() === "https://lekanlawal1.github.io/docket/ café ✓", "link didn't round-trip");
  await page.check("[name=kind][value=wifi]");
  await page.fill("[name=ssid]", "Harbour;Guest");
  await page.fill("[name=pass]", 'sea:salt"1');
  { const got = await decode(); expect(got === String.raw`WIFI:T:WPA;S:Harbour\;Guest;P:sea\:salt\"1;;`, "wi-fi code wrong: " + got); }
  await page.check("[name=kind][value=contact]");
  await page.fill("[name=name]", "Sam Rowe");
  await page.fill("[name=phone]", "705-555-0142");
  expect(await decode() === "BEGIN:VCARD\nVERSION:3.0\nFN:Sam Rowe\nTEL:705-555-0142\nEND:VCARD", "contact card wrong");
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
