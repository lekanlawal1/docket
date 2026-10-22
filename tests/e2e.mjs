// Drives every tool in a real browser with generated files and checks what comes out.
// Run: node tests/e2e.mjs   (needs Playwright; set PW to its index.mjs if it isn't installed locally)
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { makeFixtures } from "./fixtures.mjs";

const { chromium } = await import(process.env.PW || "playwright");
const root = new URL("..", import.meta.url).pathname;
const TYPES = { ".png": "image/png", ".webmanifest": "application/manifest+json", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".gz": "application/gzip" };
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
const lease = join(fx, "lease.pdf"), second = join(fx, "second.pdf"), form = join(fx, "form.pdf"), photo = join(fx, "photo.pdf"), bail = join(fx, "bail.pdf"), leaseV2 = join(fx, "lease-v2.pdf"), blanksPdf = join(fx, "blanks.pdf"), damaged = join(fx, "damaged.pdf");

const browser = await chromium.launch({
  ...(process.env.CHROME && { executablePath: process.env.CHROME }),
  // behind a proxy, a deployed copy can only be reached through it
  ...(process.env.BASE && process.env.HTTPS_PROXY && { proxy: { server: process.env.HTTPS_PROXY } }),
});
// service workers are tested on their own at the end; elsewhere they would get between the tests and the files
const page = await browser.newPage({ serviceWorkers: "block", acceptDownloads: true, ignoreHTTPSErrors: !!process.env.CHROME, viewport: { width: 1280, height: 900 } });
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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;   // ONLY=scan runs just those
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

await check("remove blank pages: empty, page-number-only and speckled scans go; content stays", async () => {
  await open("blank-pages", [blanksPdf]);
  await page.waitForFunction(() => /ticked to remove/.test(document.querySelector(".summary-line")?.textContent || ""));
  const ticked = await page.$$eval(".page-card input", (els) => els.map((e) => e.checked));
  expect(JSON.stringify(ticked) === "[false,true,true,false,true,false]", "ticked: " + ticked);
  // change of mind: keep page 3 (the page-number one)
  await page.locator(".page-card").nth(2).locator("input").uncheck();
  const out = await readPdf((await save()).data);
  expect(out.pages === 4, "expected 4 pages left, got " + out.pages);
  expect(out.texts[0].includes("page one") && out.texts[1].trim() === "3" && out.texts[2].includes("page four") && out.texts[3].includes("page six"), "wrong pages kept: " + out.texts.map((t) => t.slice(0, 20)).join(" | "));
});

await check("pages per sheet: 4 on one sheet, all upright (one was rotated); 2 per sheet goes sideways", async () => {
  await open("n-up", [lease]);
  let { data } = await save();
  const sheetInfo = (b64) => page.evaluate(async (b64) => {
    const { openForView } = await import(new URL("js/pdf.js", location.href).href);
    const { Util } = await import(new URL("vendor/pdfjs/pdf.min.mjs", location.href).href);
    const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 });
      const items = (await pg.getTextContent()).items.filter((i) => i.str.startsWith("Page "));
      out.push({ w: vp.width, h: vp.height, heads: items.map((i) => { const m = Util.transform(vp.transform, i.transform); return { s: i.str, dir: [Math.sign(Math.round(m[0])), Math.sign(Math.round(m[1]))].join(","), x: m[4], y: m[5] }; }) });
    }
    return out;
  }, b64);
  let sheets = await sheetInfo(data.toString("base64"));
  expect(sheets.length === 1 && sheets[0].heads.length === 4, "4-up should make 1 sheet with 4 pages: " + JSON.stringify(sheets.map((s) => s.heads.length)));
  // every page should face the way it does in a viewer: pages 1-3 read across, page 4 (turned
  // a quarter) reads downwards, exactly as in the original
  const original = (await sheetInfo((await readFile(lease)).toString("base64"))).map((p) => p.heads[0].dir);
  const now = Object.fromEntries(sheets[0].heads.map((h) => [h.s, h.dir]));
  expect(["Page 1", "Page 2", "Page 3", "Page 4"].every((k, i) => now[k] === original[i]), `directions ${JSON.stringify(now)} vs original ${original}`);
  const at = Object.fromEntries(sheets[0].heads.map((h) => [h.s, h]));
  expect(at["Page 1"].x < at["Page 2"].x && at["Page 1"].y < at["Page 3"].y, "pages aren't in reading order");
  await page.selectOption("[name=per]", "2");
  ({ data } = await save());
  sheets = await sheetInfo(data.toString("base64"));
  expect(sheets.length === 2 && sheets.every((s) => s.w > s.h), "2-up should make 2 landscape sheets");
});

await check("crop: trimmed margins hug the content; a drawn area becomes the page", async () => {
  const sizes = (b64) => page.evaluate(async (b64) => {
    const { openForView, pageTexts } = await import(new URL("js/pdf.js", location.href).href);
    const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) { const vp = (await doc.getPage(n)).getViewport({ scale: 1 }); out.push([Math.round(vp.width), Math.round(vp.height)]); }
    return { sizes: out, texts: await pageTexts(doc) };
  }, b64);
  await open("crop", [lease]);
  await page.waitForFunction(() => /Margins trimmed on 4 pages/.test(document.querySelector(".crop-line")?.textContent || ""));
  let res = await sizes((await save()).data.toString("base64"));
  // the lease's content spans roughly x 50-480, y 52-490 of a 612x792 page
  const [w1, h1] = res.sizes[0];
  expect(w1 > 420 && w1 < 520 && h1 > 420 && h1 < 520, "trimmed page 1 is " + res.sizes[0]);
  expect(res.texts[0].includes("Harbour Road"), "text lost when trimming");
  // draw the top half of page 1 as the area to keep, on every page
  await page.check("[name=mode][value=draw]");
  const r = await page.locator(".stage canvas").boundingBox();
  await page.mouse.move(r.x + 2, r.y + 2); await page.mouse.down();
  await page.mouse.move(r.x + r.width - 2, r.y + r.height / 2, { steps: 6 }); await page.mouse.up();
  res = await sizes((await save()).data.toString("base64"));
  expect(Math.abs(res.sizes[0][0] - 612) < 6 && Math.abs(res.sizes[0][1] - 396) < 6, "drawn crop of page 1 is " + res.sizes[0]);
  // page 4 is turned a quarter, so its top half as shown is 792 wide by 306 tall
  expect(Math.abs(res.sizes[3][0] - 792) < 6 && Math.abs(res.sizes[3][1] - 306) < 6, "drawn crop of rotated page 4 is " + res.sizes[3]);
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

await check("add text and marks: in the right place, upright on a rotated page", async () => {
  // a window tall enough to show a whole page, so every click lands on it without scrolling
  await page.setViewportSize({ width: 1280, height: 1500 });
  await open("annotate", [lease]);
  await page.waitForSelector(".stage canvas");
  const box = async () => page.locator(".stage canvas").boundingBox();
  let r = await box();
  // text near the bottom-left of page 1, two lines
  await page.mouse.click(r.x + r.width * 0.2, r.y + r.height * 0.8);
  await page.keyboard.type("Approved by Sam Rowe");
  await page.keyboard.press("Enter");
  await page.keyboard.type("October 22");
  const typedAt = await page.locator(".mark.text .words").boundingBox();
  // a highlight over the first lease line, and a tick
  await page.click("[data-tool=highlight]");
  await page.mouse.move(r.x + r.width * 0.07, r.y + r.height * 0.105);
  await page.mouse.down(); await page.mouse.move(r.x + r.width * 0.92, r.y + r.height * 0.125, { steps: 5 }); await page.mouse.up();
  await page.click("[data-tool=check]");
  await page.mouse.click(r.x + r.width * 0.7, r.y + r.height * 0.8);
  // page 4 is turned a quarter: text typed there must still read upright
  for (let i = 0; i < 3; i++) await page.click('[aria-label="Next page"]');
  await page.waitForFunction(() => document.querySelector(".pager span").textContent.startsWith("Page 4"));
  await page.click("[data-tool=text]");
  r = await box();
  await page.mouse.click(r.x + r.width * 0.3, r.y + r.height * 0.5);
  await page.keyboard.type("Sideways page note");
  expect(await page.locator(".mark").count() === 1, "page 4 should show only its own mark");

  const { data } = await save();
  await goodStatus();
  const result = await page.evaluate(async ([b64, at, stageW]) => {
    const { openForView, drawPage } = await import(new URL("js/pdf.js", location.href).href);
    const { Util } = await import(new URL("vendor/pdfjs/pdf.min.mjs", location.href).href);
    const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const items = async (n) => { const pg = await doc.getPage(n); const vp = pg.getViewport({ scale: 1 });
      return (await pg.getTextContent()).items.map((it) => ({ str: it.str, m: Util.transform(vp.transform, it.transform), vw: vp.width })); };
    const p1 = await items(1), p4 = await items(4);
    const { canvas } = await drawPage(doc, 1, { width: 612 });
    const px = (fx, fy) => [...canvas.getContext("2d").getImageData(Math.round(fx * canvas.width), Math.round(fy * canvas.height), 1, 1).data];
    return { p1, p4, highlight: px(0.86, 0.115), plain: px(0.86, 0.2), tick: px(0.7, 0.8) };
  }, [data.toString("base64")]);
  const approved = result.p1.find((i) => i.str.includes("Approved by Sam Rowe"));
  expect(approved, "typed text missing from page 1");
  expect(result.p1.some((i) => i.str.includes("October 22")), "second line missing");
  // where it was typed, in page points: the box's left edge and first baseline
  const stage = await box();
  const scale = approved.vw / stage.width;
  const wantX = (typedAt.x - stage.x) * scale, wantY = (typedAt.y - stage.y) * scale + 12 * 0.95;
  expect(Math.abs(approved.m[4] - wantX) < 3 && Math.abs(approved.m[5] - wantY) < 3, `text landed at ${approved.m[4].toFixed(1)},${approved.m[5].toFixed(1)}, typed at ${wantX.toFixed(1)},${wantY.toFixed(1)}`);
  const side = result.p4.find((i) => i.str.includes("Sideways page note"));
  expect(side && side.m[0] > 0 && Math.abs(side.m[1]) < 0.01, "text on the rotated page doesn't read upright");
  const [hr, hg, hb] = result.highlight;
  expect(hr > 200 && hg > 180 && hb < 200, "no yellow highlight: " + result.highlight);
  expect(result.plain.slice(0, 3).every((c) => c > 245), "page should be white outside the highlight");
  await page.setViewportSize({ width: 1280, height: 900 });
});

await check("fill form", async () => {
  await open("fill-form", [form]);
  await page.fill("#f0", "Sam Rowe");
  const { data } = await save();
  const { PDFDocument } = await import("../vendor/pdf-lib/pdf-lib.esm.min.js");
  const filled = (await PDFDocument.load(data)).getForm().getTextField("full_name").getText();
  expect(filled === "Sam Rowe", "field holds " + filled);
});

const marked = join(fx, "marked.pdf"), bareHighlight = join(fx, "bare-highlight.pdf");
// colour at (x, y) in page points from the bottom left, on page `n` of a PDF, drawn by pdf.js
const colourAt = (data, n, spots) => page.evaluate(async ({ b64, n, spots }) => {
  const { openForView, drawPage } = await import(new URL("js/pdf.js", location.href).href);
  const { canvas, viewport } = await drawPage(await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), n, { scale: 1 });
  const ctx = canvas.getContext("2d");
  return spots.map(([x, y]) => { const [u, v] = viewport.convertToViewportPoint(x, y); return [...ctx.getImageData(Math.round(u), Math.round(v), 1, 1).data.slice(0, 3)]; });
}, { b64: data.toString("base64"), n, spots });

await check("flatten: answers and marks become part of the page, hidden ones stay hidden, links still work", async () => {
  await open("flatten", [marked]);
  await page.waitForSelector(".desk .go:not([disabled])");
  const listed = await page.locator(".main .desk").innerText();
  expect(/1 form field/.test(listed) && /1 stamp/.test(listed) && /1 typed comment/.test(listed), "listed: " + listed);
  expect(!(await page.isChecked("[name=pictures]")), "pictures switched on for marks that all have their own look");
  const { name, data } = await save();
  expect(name === "marked-flat.pdf", "named " + name);
  const { PDFDocument, PDFName } = await pdfLib();
  const doc = await PDFDocument.load(data);
  expect(!doc.getForm().getFields().length, "form fields left");
  const left = doc.getPages().flatMap((p) => { const a = p.node.Annots(); return a ? a.asArray().map((r) => doc.context.lookup(r).get(PDFName.of("Subtype")).asString()) : []; });
  expect(left.join() === "/Link,/Link", "annotations left: " + left.join());
  const { texts } = await readPdf(data);
  expect(texts[0].includes("Ada Moss") && texts[0].includes("APPROVED BY REVIEW"), "answer or comment text not on the page: " + texts[0]);
  const [red, green, hidden] = await colourAt(data, 1, [[110, 530], [400, 440], [425, 625]]);
  expect(red[0] > 200 && red[1] < 60, "the box isn't red: " + red);
  expect(green[1] > 120 && green[0] < 60, "the stamp isn't where its matrix puts it: " + green);
  expect(hidden[2] < 200 || hidden[0] > 200, "the hidden mark showed up: " + hidden);
  const [purple] = await colourAt(data, 2, [[150, 150]]);
  expect(purple[0] > 90 && purple[2] > 90 && purple[1] < 60, "the mark on the turned page is missing: " + purple);
});

// where each link sits on the page as it's shown, in fractions of the page
const linkSpots = (data) => page.evaluate(async (b64) => {
  const { openForView } = await import(new URL("js/pdf.js", location.href).href);
  const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const spots = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 });
    for (const a of await pg.getAnnotations()) if (a.subtype === "Link") {
      const [x0, y0, x1, y1] = vp.convertToViewportRectangle(a.rect);
      spots.push({ n, url: a.url, box: [Math.min(x0, x1) / vp.width, Math.min(y0, y1) / vp.height, Math.max(x0, x1) / vp.width, Math.max(y0, y1) / vp.height] });
    }
  }
  return spots;
}, data.toString("base64"));

await check("flatten into pictures keeps links clickable, in the same place, on a turned page too", async () => {
  await open("flatten", [marked]);
  await page.waitForSelector(".desk .go:not([disabled])");
  await page.check("[name=pictures]");
  const { data } = await save();
  const was = await linkSpots(await readFile(marked)), now = await linkSpots(data);
  expect(was.length === 2 && now.length === 2, `links: ${was.length} before, ${now.length} after`);
  now.forEach((l, i) => {
    expect(l.url === was[i].url && l.n === was[i].n, `link ${i} is ${l.url} on page ${l.n}`);
    expect(l.box.every((v, k) => Math.abs(v - was[i].box[k]) < 0.002), `link ${i} moved: ${was[i].box} → ${l.box}`);
  });
});

await check("flatten: a highlight saved without its look is kept by drawing the page", async () => {
  await open("flatten", [bareHighlight]);
  await page.waitForSelector(".desk .go:not([disabled])");
  expect(await page.isChecked("[name=pictures]"), "pictures not switched on");
  const { data } = await save();
  const [yellow] = await colourAt(data, 1, [[210, 702]]);
  expect(yellow[0] > 200 && yellow[1] > 180 && yellow[2] < 120, "the highlight was lost: " + yellow);
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

await check("clean for sharing: the author is shown and removed", async () => {
  await open("metadata", [lease]);
  await page.waitForSelector("text=Jordan Secret-Author");
  const { data } = await save();
  expect(!data.toString("latin1").includes("Secret-Author"), "author still in the file");
  await goodStatus();
});

// every object in a PDF as text, streams decompressed, so a check can't miss something tucked away
const everything = async (data) => {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await pdfLib();
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  return doc.context.enumerateIndirectObjects().map(([, o]) => {
    let s = o.toString();
    if (o instanceof PDFRawStream) { try { s += Buffer.from(decodePDFRawStream(o).decode()).toString("latin1"); } catch { /* images */ } }
    return s;
  }).join("\n").replace(/<([0-9A-Fa-f\s]+)>/g, (m, hex) => {
    // text stored as hex (pdf-lib writes titles and authors that way): read it as well
    const b = Buffer.from(hex.replace(/\s/g, ""), "hex");
    return m + (b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString("utf16le") : b.toString("latin1"));
  }) + data.toString("latin1");
};

await check("clean for sharing: comments, attachments, scripts, hidden layers and old versions are found, then really gone", async () => {
  const messy = join(fx, "messy.pdf");
  const before = await everything(await readFile(messy));
  for (const w of ["Hidden-Author", "offer them less", "salary", "app.alert", "Old draft title", "SALARY BAND"]) expect(before.includes(w), `the fixture lacks "${w}"`);
  await open("metadata", [messy]);
  await page.waitForSelector(".clean-found");
  const listed = await page.locator(".clean-found").innerText();
  for (const w of ["Final offer", "Reviewer note: offer them less", "salary-sheet.csv", "3 scripts", "1 hidden layer", "Internal notes", "1 earlier saved version", "1 link to a website"]) expect(listed.includes(w), `"${w}" not listed in: ${listed}`);
  expect(await page.isChecked("[name=pictures]") && !(await page.isChecked("[name=links]")), "wrong switches on by default");
  const { name, data } = await save();
  expect(name === "messy-clean.pdf", "named " + name);
  const after = await everything(data);
  for (const w of ["Hidden-Author", "Final offer", "offer them less", "salary", "app.alert", "Old draft title", "SALARY BAND", "Internal notes", "pdf-lib"]) expect(!after.includes(w), `"${w}" is still in the file`);
  expect(after.includes("example.com/offer"), "the web link was removed though it was left switched on");
  const { texts } = await readPdf(data);
  expect(texts[0] === "", "pages weren't turned into pictures");
  await goodStatus();
});

await check("clean for sharing without the pictures: text stays selectable, links can go too", async () => {
  await open("metadata", [join(fx, "messy.pdf")]);
  await page.waitForSelector(".clean-found");
  await page.uncheck("[name=pictures]");
  await page.check("[name=links]");
  const { data } = await save();
  const after = await everything(data);
  for (const w of ["Hidden-Author", "offer them less", "salary", "app.alert", "Old draft title", "example.com/offer"]) expect(!after.includes(w), `"${w}" is still in the file`);
  expect((await readPdf(data)).texts[0].includes("Offer letter"), "the page text was lost");
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

await check("repair a damaged PDF: rebuilt, every page readable, text intact", async () => {
  await open("repair", [damaged]);
  await page.waitForSelector(".desk .go:not([disabled])");
  const { data } = await save();
  await goodStatus();
  const msg = await page.locator(".desk .status").innerText();
  expect(/rebuilt, and 4 pages of 4 can be read/.test(msg), "status: " + msg);
  const out = await readPdf(data);
  expect(out.pages === 4 && out.texts[1].includes("Harbour Road"), "repaired file is wrong");
  // and it's now a well-formed file: its index points where it should
  const tail = data.toString("latin1").slice(-60);
  expect(!/999999/.test(tail), "the broken index pointer is still there");
});

await check("repair a file cut short (an interrupted download): what survived comes back, and it says what didn't", async () => {
  await open("repair", [join(fx, "cut-short.pdf")]);
  await page.waitForSelector(".desk .go:not([disabled])");
  const { data } = await save();
  const msg = await page.locator(".desk .status").innerText();
  expect(/rebuilt, and 4 pages of 4 can be read/.test(msg), "status: " + msg);
  const out = await readPdf(data);
  // page 4's contents were in the part that was cut off, so it comes back blank, and it says so
  expect(out.pages === 4 && out.texts.slice(0, 3).every((t) => t.includes("Harbour Road")), "pages 1-3 should be intact");
  expect(/1 page came back empty/.test(msg), "should say page 4 came back empty: " + msg);
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

await check("convert images: a HEIC and a PNG become JPGs in a zip; one picture downloads by itself", async () => {
  await open("convert-images", haveHeic ? [heic, png] : [png, png]);
  await page.waitForFunction(() => /2 pictures ready/.test(document.querySelector(".summary-line")?.textContent || ""), null, { timeout: 60_000 });
  const { name, data } = await save();
  const names = await zipNames(data);
  expect(name.endsWith(".zip") && names.length === 2 && names.every((n) => n.endsWith(".jpg")), "zip: " + names);
  await page.click('.lineup [aria-label^="Remove"]');
  await page.selectOption("[name=type]", "image/webp");
  const one = await save();
  expect(one.name.endsWith(".webp") && one.data.slice(8, 12).toString() === "WEBP", "single file should be a WebP: " + one.name);
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

const { cameraCorners } = await import("./camera.mjs");
// a phone photo of page 1 of the lease: on a dark desk, at an angle, with a shadow across it
const photographed = async (corners, name) => {
  const b64 = await page.evaluate(async ({ b64, corners }) => {
    const { openForView, drawPage } = await import(new URL("js/pdf.js", location.href).href);
    const { homography, project } = await import(new URL("js/scanmath.js", location.href).href);
    const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const sheet = (await drawPage(doc, 1, { width: 1400 })).canvas;
    const sd = sheet.getContext("2d").getImageData(0, 0, sheet.width, sheet.height).data;
    const W = 1500, H = 2000, photo = new ImageData(W, H);
    const back = corners ? homography(corners.map(([x, y]) => [x * W, y * H]), [[0, 0], [sheet.width, 0], [sheet.width, sheet.height], [0, sheet.height]]) : null;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 14;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r = 92 + 18 * Math.sin(x / 23 + y / 140) + rnd(), g = r * 0.72, b = r * 0.5;   // wood
      const [u, v] = back ? project(back, x + 0.5, y + 0.5) : [-1, -1];
      if (u >= 0 && v >= 0 && u < sheet.width && v < sheet.height) {
        const i = (Math.floor(v) * sheet.width + Math.floor(u)) * 4, shade = 0.97 - 0.22 * (x / W) * (y / H) + rnd() / 255;
        r = sd[i] * shade; g = sd[i + 1] * shade * 0.98; b = sd[i + 2] * shade * 0.93;   // warm indoor light
      }
      photo.data[o] = r; photo.data[o + 1] = g; photo.data[o + 2] = b; photo.data[o + 3] = 255;
    }
    const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
    c.getContext("2d").putImageData(photo, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    let s = ""; for (const x of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(x);
    return btoa(s);
  }, { b64: (await readFile(lease)).toString("base64"), corners });
  const path = join(fx, name);
  await (await import("node:fs/promises")).writeFile(path, Buffer.from(b64, "base64"));
  return path;
};

await check("scan: an angled phone photo is found, straightened and cleaned, and OCR reads it", async () => {
  // taken by a phone held at an angle, so the far edge of the page looks shorter
  const corners = cameraCorners({ tiltX: 24, tiltY: -14, spin: 6, distance: 1.5, focal: 1500, W: 1500, H: 2000 });
  await open("scan", [await photographed(corners, "page-photo.jpg")]);
  await page.waitForSelector(".scan-stage .corner");
  expect(!(await page.locator(".scan-tip.warn").count()), "it didn't find the page");
  // the handles sit on the real corners
  const found = await page.$$eval(".scan-stage .corner", (els) => els.map((e) => [parseFloat(e.style.left) / 100, parseFloat(e.style.top) / 100]));
  found.forEach(([x, y], i) => expect(Math.abs(x - corners[i][0]) < 0.015 && Math.abs(y - corners[i][1]) < 0.015, `corner ${i} at ${x.toFixed(3)},${y.toFixed(3)}, not ${corners[i]}`));

  const { name, data } = await save();
  expect(name === "page-photo-scan.pdf", "named " + name);
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.load(data);
  const { width, height } = doc.getPage(0).getSize();
  expect(Math.abs(width / height - 612 / 792) < 0.02, `page shape ${width} × ${height}, not Letter's`);
  // the flattened page: white all round its edges (no desk left), and the shadow cleaned away
  const edges = await page.evaluate(async (b64) => {
    const { openForView, drawPage } = await import(new URL("js/pdf.js", location.href).href);
    const c = (await drawPage(await openForView(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))), 1, { width: 400 })).canvas;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, at = (x, y) => d[(y * c.width + x) * 4];
    const vals = [];
    for (let x = 4; x < c.width - 4; x += 3) vals.push(at(x, 3), at(x, c.height - 4));
    for (let y = 4; y < c.height - 4; y += 3) vals.push(at(3, y), at(c.width - 4, y));
    return { dark: vals.filter((v) => v < 200).length / vals.length, corner: at(c.width - 30, c.height - 30) };
  }, data.toString("base64"));
  expect(edges.dark < 0.02, `${Math.round(edges.dark * 100)}% of the edge is dark: the desk is still showing`);
  expect(edges.corner > 235, `the shadowed corner is ${edges.corner}, not white`);

  // straight on to Make searchable, with the scan already loaded
  await page.click(".desk .ocr");
  await page.waitForURL(/#\/searchable/);
  await page.waitForSelector(".desk .go");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.locator(".desk .go").click()]);
  const text = (await readPdf(await readFile(await dl.path()))).texts[0];
  for (const w of ["Harbour Road", "1,450", "landlord@example.com"]) expect(text.includes(w), `"${w}" not read from the scan: ${text.slice(0, 200)}`);
});

await check("scan: no page in the photo says so, and dragging the corners sets them", async () => {
  await open("scan", [await photographed(null, "desk.jpg")]);
  await page.waitForSelector(".scan-tip.warn");
  const handle = page.locator(".scan-stage .corner").first();
  const box = await handle.boundingBox(), stage = await page.locator(".scan-stage").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.25, { steps: 5 });
  await page.mouse.up();
  const left = parseFloat(await handle.evaluate((e) => e.style.left));
  expect(Math.abs(left - 30) < 1.5, `corner left at ${left}%`);
  expect(!(await page.locator(".scan-tip.warn").count()), "still says the edges aren't set");
  await page.click(".scan-result .rot");
  const c = await page.$eval(".scan-result canvas", (e) => [e.width, e.height]);
  const { data } = await save();
  const { PDFDocument } = await pdfLib();
  const size = (await PDFDocument.load(data)).getPage(0).getSize();
  expect((c[0] > c[1]) === (size.width > size.height), "the turned page didn't keep its turn");
});

await check("photo to text: an angled photo of a page is straightened and read; a screenshot is read as it is", async () => {
  const corners = cameraCorners({ tiltX: -18, tiltY: 16, spin: -5, distance: 1.35, focal: 1500, W: 1500, H: 2000 });
  await open("photo-to-text", [await photographed(corners, "handout.jpg"), png]);
  await page.click(".desk .go");
  await page.waitForSelector(".ocr-result:not([hidden])", { timeout: 180_000 });
  const text = await page.inputValue(".ocr-result textarea");
  for (const w of ["Harbour Road", "1,450", "landlord@example.com", "[handout.jpg]", "[harbour.png]", "Docket"]) expect(text.includes(w), `"${w}" missing from: ${text.slice(0, 300)}`);
  const notes = await page.$$eval(".lineup small", (els) => els.map((e) => e.textContent));
  expect(/page straightened/.test(notes[0]), "the photo wasn't straightened: " + notes[0]);
  expect(!/straightened/.test(notes[1]), "the screenshot was 'straightened': " + notes[1]);
  // what's typed in the box is what gets saved
  await page.fill(".ocr-result textarea", text + "\nchecked by hand");
  const { name, data } = await save(".ocr-result .save");
  expect(name === "text-from-photos.txt" && data.toString("utf8").endsWith("checked by hand"), "saved " + name);
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

await check("compare two versions: the right changes, on the right pages", async () => {
  await open("compare");
  await page.locator(".compare-slot").nth(0).locator("input[type=file]").setInputFiles(lease);
  await page.locator(".compare-slot").nth(1).locator("input[type=file]").setInputFiles(leaseV2);
  await page.waitForSelector(".change");
  const cards = await page.$$eval(".change", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  expect(cards.length === 3, "expected 3 changes (rent, late fee gone, insurance added), got " + cards.length + ": " + cards.join(" | "));
  expect(cards.some((c) => /page 2 → page 2/.test(c) && /\$1,450/.test(c) && /\$1,550/.test(c) && /Numbers/.test(c)), "rent change missing");
  expect(cards.some((c) => /Late rent will be charged/.test(c)), "removed late-fee sentence missing");
  expect(cards.some((c) => /contents insurance/.test(c)), "added insurance sentence missing");
  const where = await page.$$eval(".change .where", (els) => els.map((e) => e.innerText));
  expect(where.every((w) => /page 2 → page 2/.test(w)), "every change is on page 2 of both; page 3 is only re-wrapped: " + where.join(" | "));
  await page.check("[name=numbers]");
  expect(await page.locator(".change").count() === 2, "numbers filter: rent and the late fee ($50) only");
  const { data } = await save();
  expect(/3 changes/.test(data.toString()) && /Added:\s+\$1,550/.test(data.toString()), "report text wrong");
});

await check("compare: the same file twice says so", async () => {
  await open("compare");
  await page.locator(".compare-slot").nth(0).locator("input[type=file]").setInputFiles(lease);
  await page.locator(".compare-slot").nth(1).locator("input[type=file]").setInputFiles(lease);
  await page.waitForSelector("text=No differences in the words");
});

await check("pdf to excel: a printed statement's table, with real numbers", async () => {
  const printer = await browser.newPage();
  const row = (d, desc, amt) => `<tr><td style="padding:4px 18px 4px 0">${d}</td><td style="padding:4px 18px">${desc}</td><td style="padding:4px 0 4px 18px; text-align:right">${amt}</td></tr>`;
  await printer.setContent(`<body style="font-family: Georgia, serif; font-size: 12pt; margin: 0">
    <h1>Harbour Bank statement</h1><p>Account 4417-2290, October 2026. Thank you for banking with us; your statement is below.</p>
    <table style="border-collapse: collapse"><tr><th style="text-align:left; padding:4px 18px 4px 0">Date</th><th style="text-align:left; padding:4px 18px">Description</th><th style="text-align:right; padding:4px 0 4px 18px">Amount</th></tr>
    ${row("Oct 1", "Rent payment", "($1,450.00)")}${row("Oct 3", "Payroll deposit", "$2,310.55")}${row("Oct 9", "Grocery store", "($86.12)")}${row("Oct 15", "Interest", "$0.42")}${row("Oct 28", "Card fee", "($4.00)")}</table>
    <p>Questions? Call us any time.</p></body>`);
  const printed = join(fx, "statement.pdf");
  await printer.pdf({ path: printed, format: "Letter", margin: { top: "72px", bottom: "72px", left: "72px", right: "72px" } });
  await printer.close();

  await open("pdf-to-excel", [printed]);
  await page.waitForSelector(".sheet-preview table");
  expect(/Found 1 table/.test(await page.locator(".summary-line").innerText()), "should find exactly one table");
  const { data } = await save();
  const path = join(fx, "statement.xlsx");
  await (await import("node:fs/promises")).writeFile(path, data);
  const xml = (await import("node:child_process")).execFileSync("python3", ["-c", "import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).read('xl/worksheets/sheet1.xml').decode())", path], { encoding: "utf8" });
  const sheet = [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map(([, cells]) =>
    [...cells.matchAll(/<c [^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)].map(([, v, t]) => v ?? t).join("|"));
  expect(sheet[0] === "Date|Description|Amount", "header row: " + sheet[0]);
  expect(sheet[1] === "Oct 1|Rent payment|-1450", "row 1: " + sheet[1]);
  expect(sheet[2] === "Oct 3|Payroll deposit|2310.55", "row 2: " + sheet[2]);
  expect(sheet.length === 6, "rows: " + sheet.length);
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
await check("extract images: the chart once, the header logo once (it's on both pages)", async () => {
  await open("extract-images", [join(fx, "printed.pdf")]);
  await page.waitForSelector(".image-grid figure");
  const captions = await page.$$eval(".image-grid figcaption", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  expect(captions.length === 2, "expected 2 distinct images: " + captions.join(" | "));
  expect(captions.some((c) => /page 1, 2/.test(c)), "the logo should be listed once for pages 1 and 2: " + captions.join(" | "));
  const { name, data } = await save();
  expect(name.endsWith(".zip") && (await zipNames(data)).length === 2, "zip should hold 2 images");
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

await check("offline: installable, then merges PDFs and reads a photo with no connection", async () => {
  if (process.env.BASE) return;   // a deployed copy is reached through the test's proxy, which a service worker bypasses
  const ctx = await browser.newContext({ acceptDownloads: true, serviceWorkers: "allow", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => /saved on this device/.test(document.querySelector(".off-line")?.textContent || ""), null, { timeout: 30_000 });
  const manifest = await p.evaluate(async () => {
    const m = await (await fetch(document.querySelector("link[rel=manifest]").href)).json();
    const icons = await Promise.all(m.icons.map(async (i) => (await fetch(new URL(i.src, location.href))).headers.get("content-type")));
    return { name: m.short_name, display: m.display, icons };
  });
  expect(manifest.name === "Docket" && manifest.display === "standalone" && manifest.icons.every((t) => /png/.test(t)), "manifest: " + JSON.stringify(manifest));

  await p.click(".save-all");
  await p.waitForFunction(() => /Every tool is saved/.test(document.querySelector(".extra-line").textContent), null, { timeout: 120_000 });

  await ctx.setOffline(true);
  expect(await p.evaluate(() => fetch("https://example.com").then(() => "online", () => "offline")) === "offline", "the browser isn't offline");
  // a fresh tab, straight to a tool, with no connection
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await q.goto(base + "#/merge");
  await q.waitForSelector(".workbench");
  await q.locator(".main .dock input").first().setInputFiles([lease, second]);
  const [dl] = await Promise.all([q.waitForEvent("download"), q.click(".desk .go")]);
  const { PDFDocument } = await pdfLib();
  const merged = await PDFDocument.load(await readFile(await dl.path()));
  const parts = (await PDFDocument.load(await readFile(lease))).getPageCount() + (await PDFDocument.load(await readFile(second))).getPageCount();
  expect(merged.getPageCount() === parts, `merged ${merged.getPageCount()} pages, not ${parts}`);

  // reading text needs the big reader, saved above
  await q.goto(base + "#/photo-to-text");
  await q.reload();
  await q.waitForSelector(".workbench");
  await q.locator(".main .dock input").first().setInputFiles([png]);
  await q.click(".desk .go");
  await q.waitForSelector(".ocr-result:not([hidden])", { timeout: 120_000 });
  expect((await q.inputValue(".ocr-result textarea")).includes("Docket"), "nothing read offline");
  await ctx.close();
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
