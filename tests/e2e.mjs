// Drives every tool in a real browser with generated files and checks what comes out.
// Run: node tests/e2e.mjs   (needs Playwright; set PW to its index.mjs if it isn't installed locally)
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { makeFixtures } from "./fixtures.mjs";

const { chromium } = await import(process.env.PW || "playwright");
const root = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const fx = await mkdtemp(join(tmpdir(), "docket-"));
await makeFixtures(fx);
const lease = join(fx, "lease.pdf"), second = join(fx, "second.pdf"), form = join(fx, "form.pdf");

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ acceptDownloads: true, ignoreHTTPSErrors: !!process.env.CHROME, viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// web fonts come from Google; a blocked font isn't the site's fault
page.on("console", (m) => m.type() === "error" && !/fonts\.g|ERR_CERT|ERR_TUNNEL/.test(m.text() + m.location().url) && errors.push(m.text()));

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
  const { openForView, pageTexts } = await import("/js/pdf.js");
  const doc = await openForView(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return { pages: doc.numPages, texts: await pageTexts(doc) };
}, data.toString("base64"));

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

await check("tools that aren't built say so", async () => {
  await open("pdf-to-word");
  expect(await page.locator(".dock").count() === 0, "showed a drop zone for an unbuilt tool");
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
