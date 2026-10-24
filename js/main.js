// Docket's front door: the home page, the tool pages, night mode and the little boat.
// Routes are hashes so the whole thing works as plain static files: "#/merge" opens a tool.

import { PIERS, findTool } from "./tools.js";
import { svg } from "./icons.js";
import { h, esc, dock, privateNote, onResult, captureDownloads } from "./ui.js";
import { ws, begin, push } from "./workspace.js";

const app = document.getElementById("app");

// ---------------------------------------------------------------- night mode
const toggle = document.getElementById("theme");
toggle.addEventListener("click", () => {
  const night = document.documentElement.getAttribute("data-theme") !== "night";
  if (night) document.documentElement.setAttribute("data-theme", "night");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("docket-theme", night ? "night" : "day"); } catch {}
  document.querySelector('meta[name="theme-color"]').content = night ? "#111A1F" : "#EEF1EC";
});

// ---------------------------------------------------------------- files dropped on the home page
// Dropped files wait here until the person picks a tool, which then starts with them loaded.
let waiting = [];
export const takeWaiting = () => { const f = waiting; waiting = []; return f; };
// a tool passing its result on to the next one
export const handOff = (files) => { waiting = files; };

function suggestions(files) {
  if (files.some((f) => /\.docket$/i.test(f.name))) return ["workspace"];
  const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)).length;
  const images = files.filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name)).length;
  if (pdfs === 2) return ["compare", "merge", "compress"];
  if (pdfs > 2) return ["merge", "compress", "pdf-to-jpg"];
  if (pdfs === 1) return ["organise", "split", "sign", "redact", "compress", "summary"];
  if (images) return ["scan", "photo-to-text", "images-to-pdf", "convert-images", "resize-image", "compress-image"];
  return [];
}

// ---------------------------------------------------------------- the water, with a boat on it
const water = () => `
  <div style="position: relative">
    <svg class="water" viewBox="0 0 1180 64" preserveAspectRatio="none" aria-hidden="true">
      <g class="drift"><path class="w1" d="M0 20 C 80 10, 160 30, 240 20 S 400 10, 480 20 S 640 30, 720 20 S 880 10, 960 20 S 1120 30, 1200 20 S 1280 14, 1240 20"/></g>
      <g class="drift slow"><path class="w2" d="M-40 42 C 50 32, 140 52, 230 42 S 410 32, 500 42 S 680 52, 770 42 S 950 32, 1040 42 S 1180 48, 1240 42"/></g>
    </svg>
    <div class="boat-sail" style="position: absolute; right: 12%; top: -14px">
      <svg class="art boat" width="40" height="34" viewBox="0 0 40 34" stroke-width="1.5" aria-hidden="true">
        <path d="M2 23h36l-5 7H7z"/><path d="M20 2v21"/><path d="M21 4l13 16H21z"/><path d="M19 7 9 20h10"/>
      </svg>
    </div>
  </div>`;

// ---------------------------------------------------------------- home
function home() {
  document.title = "Docket: every PDF tool, on your device";
  app.innerHTML = "";
  const hero = h(`<section class="hero" style="padding-top: 36px">
    <p class="eyebrow">Every PDF tool, moored on your device</p>
    <h1>Bring your documents in. They never leave the dock.</h1>
    <p class="lead">Merge, split, sign, redact, compress and convert, all in your browser. Nothing is uploaded, there's no account, and no file limits.</p>
    <div class="dock-spot" style="margin-top: 36px"></div>
    ${water()}
    <div class="suggest" hidden></div>
    <div class="promises">
      <span>${svg("lock", { size: 16 })}Processed on your device</span>
      <span>${svg("anchor", { size: 16 })}No account, no watermark</span>
      <a href="#offline">${svg("wave", { size: 16 })}Works offline, and installs as an app</a>
    </div>
  </section>`);
  const suggest = hero.querySelector(".suggest");
  hero.querySelector(".dock-spot").append(dock({
    multiple: true, accept: ".pdf,image/*,.heic,.heif,.docket",
    hint: "PDFs or images. Docket suggests what you can do with them.",
    onFiles(files) {
      waiting = files;
      const ids = suggestions(files);
      suggest.hidden = false;
      suggest.innerHTML = ids.length
        ? `<p style="margin: 16px 0 10px; font-weight: 600">${files.length === 1 ? esc(files[0].name) : files.length + " files"} on the dock. What would you like to do?</p>
           <div class="berths">${ids.map((id) => berth(findTool(id))).join("")}</div>`
        : `<p class="status bad">Docket works with PDFs and images. That file looks like neither.</p>`;
    },
  }));

  const piers = h(`<section id="tools" style="padding-top: 72px">
    <div class="piers-head">
      <h2>The piers</h2>
      <label class="search">${svg("spyglass", { size: 18 })}<span class="sr-only">Find a tool</span>
        <input type="search" placeholder="Find a tool, e.g. sign" autocomplete="off"></label>
    </div>
    <div class="list">${PIERS.map(pier).join("")}</div>
    <p class="no-match" hidden>No tool by that name yet.</p>
  </section>`);
  const input = piers.querySelector("input");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    piers.querySelectorAll(".pier").forEach((p) => {
      let any = false;
      p.querySelectorAll(".berth").forEach((b) => {
        const hit = !q || b.textContent.toLowerCase().includes(q);
        b.hidden = !hit;
        any ||= hit;
        shown += hit;
      });
      p.hidden = !any;
    });
    piers.querySelector(".no-match").hidden = shown > 0;
  });

  const harbour = h(`<section id="harbour" style="padding: 64px 0 40px">
    <div class="harbour">
      <div><h2>Nothing leaves the harbour</h2>
        <p>Each tool runs in your browser. Your files are read into memory, changed, and handed back to you. Close the tab and they're gone.</p></div>
      <div><h3>Redaction you can trust</h3>
        <p>Black boxes alone hide nothing. Docket burns the boxes into the page, so the text underneath is gone, then reads the result back to check.</p></div>
      <div><h3>Honest limits</h3>
        <p>When a tool has to change your file in a way you might not expect, like turning pages into images, it says so before you start.</p></div>
    </div>
  </section>`);
  app.append(hero, piers, harbour, offlinePanel());
  if (location.hash.length > 1 && !location.hash.startsWith("#/")) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

const pier = (p) => `<div class="pier">
  <div class="pier-head"><span class="dot" style="background: var(${p.tint})"></span><span class="no">Pier ${p.no}</span>
    <h3>${esc(p.name)}</h3><span class="blurb">${esc(p.blurb)}</span></div>
  <div class="berths">${p.tools.map(berth).join("")}</div>
</div>`;

const berth = (t) => {
  const inner = `<span class="chip" style="background: var(${t.pier.tint})">${svg(t.icon)}</span>
    <span style="flex: 1; min-width: 0"><span class="name"><span>${esc(t.name)}</span><span class="tag">${t.soon ? "Soon" : t.berth}</span></span>
    <span class="what">${esc(t.what)}</span></span>`;
  return t.soon ? `<div class="berth soon" aria-disabled="true">${inner}</div>` : `<a class="berth" href="#/${t.id}">${inner}</a>`;
};

// ---------------------------------------------------------------- offline, and as an app
// The service worker keeps the site on this device. Chrome and Edge offer to install it;
// Safari does it from the Share menu.
let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; document.querySelector(".install-btn")?.removeAttribute("hidden"); });
const swReady = "serviceWorker" in navigator && location.protocol !== "file:"
  ? navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).catch((err) => { console.warn(err); return null; })
  : Promise.resolve(null);
// the home page is rebuilt on each visit, so one listener passes messages to whichever panel is up
let showOffline = null;
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => showOffline?.(e.data));

function offlinePanel() {
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ua = navigator.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Safari on a Mac installs from its File menu (Safari 17, macOS Sonoma, onwards)
  const macSafari = !apple && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
  const el = h(`<section id="offline" style="padding: 8px 0 56px">
    <div class="offline card">
      <div class="offline-text"><h2>Take it with you</h2>
        <p class="off-line">Checking whether Docket is saved on this device...</p>
        <p class="extra-line" hidden></p>
        <p class="note">${installed ? "You're using Docket as an installed app." : apple
          ? "On an iPhone or iPad: tap Share, then <b>Add to Home Screen</b>, and Docket opens like an app."
          : macSafari ? "To install it in Safari: choose <b>File → Add to Dock</b> (macOS Sonoma or later). On older macOS, Safari can't install sites; use Chrome or Edge, or keep Docket in a tab."
          : "To install it with its own icon and window: in Chrome or Edge, use the install button here or in the address bar; on Android, choose <b>Add to Home screen</b> from the browser menu."}</p></div>
      <div class="offline-actions">
        <button type="button" class="pill install-btn" ${installPrompt ? "" : "hidden"}>Install Docket</button>
        <button type="button" class="pill ghost save-all" hidden>Save every tool for offline</button>
      </div>
    </div></section>`);
  const line = el.querySelector(".off-line"), extra = el.querySelector(".extra-line"), saveAll = el.querySelector(".save-all");
  el.querySelector(".install-btn").onclick = async (e) => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { e.target.hidden = true; installPrompt = null; }
  };
  const mb = (n) => `${Math.round(n / 1e6)} MB`;
  swReady.then((reg) => {
    if (!reg?.active) { line.textContent = "This browser can't keep Docket for offline use. Everything still works while you're online."; return; }
    line.textContent = "Docket is saved on this device, so it opens and works without an internet connection.";
    const show = (m) => {
      if (m.type === "progress") { extra.hidden = false; extra.textContent = `Saving: ${m.done} of ${m.of} parts...`; return; }
      if (m.type === "error") { extra.textContent = "Saving stopped: " + m.message + ". Check your connection and try again."; saveAll.disabled = false; return; }
      if (m.type !== "status") return;
      extra.hidden = false;
      const all = m.saved === m.of;
      extra.textContent = all ? "Every tool is saved, including reading scans, Repair and iPhone photos."
        : `Reading scans, Repair and iPhone photos need about ${mb(m.bytes)} more. They're saved the first time you use them, or all at once here.`;
      saveAll.hidden = all;
      saveAll.disabled = false;
      saveAll.textContent = `Save every tool for offline (${mb(m.bytes)})`;
    };
    showOffline = show;
    saveAll.onclick = () => { saveAll.disabled = true; saveAll.textContent = "Saving..."; reg.active.postMessage("save-extras"); };
    reg.active.postMessage("offline-status");
  });
  return el;
}

// ---------------------------------------------------------------- keep working on the result
// After a tool hands back a PDF or a picture, the next tools are one tap away, with the result
// already loaded: merge, then compress, then sign, without saving and dropping it in again.
const NEXT = {
  pdf: ["compress", "sign", "annotate", "organise", "page-numbers", "password", "merge", "watermark", "redact", "split", "flatten", "pdf-to-word", "metadata", "searchable"],
  image: ["images-to-pdf", "enhance", "compress-image", "resize-image", "convert-images", "photo-to-text", "scan"],
};
const SHOWN = 6;
let stopResults = null;

function keepWorking(desk, currentId, file) {
  desk.querySelector(".next-steps")?.remove();
  if (currentId === "workspace") return;
  const kind = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name) ? "pdf" : /^image\//.test(file.type) ? "image" : null;
  if (!kind) return;
  const tools = NEXT[kind].filter((id) => id !== currentId).map(findTool).filter((t) => t && !t.soon);
  const chip = (t, hidden) => `<button type="button" class="next-chip" data-id="${t.id}" ${hidden ? "hidden" : ""}>${svg(t.icon, { size: 18 })}<span>${esc(t.name)}</span></button>`;
  const el = h(`<div class="next-steps" role="region" aria-label="Keep working on this file">
    <p class="next-title">Keep working on <b>${esc(file.name)}</b></p>
    <div class="next-chips">${kind === "pdf" ? `<button type="button" class="next-chip ws-chip" data-ws>${svg("ledger", { size: 18 })}<span>Open in Workspace</span></button>` : ""}${tools.map((t, i) => chip(t, i >= SHOWN)).join("")}
      ${tools.length > SHOWN ? `<button type="button" class="next-chip more">More tools</button>` : ""}</div>
  </div>`);
  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".next-chip");
    if (!btn) return;
    if (btn.classList.contains("more")) { el.querySelectorAll(".next-chip[hidden]").forEach((b) => (b.hidden = false)); btn.remove(); return; }
    if (btn.hasAttribute("data-ws")) { begin(file, `From ${findTool(currentId)?.name || "a tool"}`); location.hash = "#/workspace"; return; }
    waiting = [file];
    location.hash = "#/" + btn.dataset.id;
  });
  const note = desk.querySelector(".private-note");
  note ? note.before(el) : desk.append(el);
}

// ---------------------------------------------------------------- a tool page
async function toolPage(id) {
  stopResults?.();
  stopResults = null;
  captureDownloads(null);
  // a tool opened from the Workspace and left without saving: nothing comes back
  const fromWorkspace = ws.pending === id;
  if (!fromWorkspace) ws.pending = null;
  const tool = findTool(id);
  if (!tool) return home();
  document.title = `${tool.name} | Docket`;
  app.innerHTML = "";
  const page = h(`<section style="padding: 20px 0 60px">
    <p class="eyebrow" style="color: var(--wood)">Pier ${tool.pier.no} · Berth ${tool.berth}</p>
    <div class="tool-head"><span class="chip big" style="background: var(${tool.pier.tint})">${svg(tool.icon)}</span><h1>${esc(tool.name)}</h1></div>
    <p class="tool-intro">${esc(tool.what)}</p>
    <div class="workbench"><div class="main"></div><aside class="desk" aria-label="Settings"></aside></div>
  </section>`);
  app.append(page);
  const main = page.querySelector(".main"), desk = page.querySelector(".desk");

  if (tool.soon) {
    main.innerHTML = `<p>This one isn't built yet. It's on the list, and it'll appear here when it works properly.</p>
      <p><a class="pill" href="#tools">Back to all tools</a></p>`;
    desk.remove();
    return;
  }
  try {
    const mod = await import(`./tools/${id}.js`);
    if (mod.intro) page.querySelector(".tool-intro").textContent = mod.intro;
    if (fromWorkspace) {
      page.querySelector(".workbench").before(h(`<div class="ws-banner" role="note">${svg("ledger", { size: 18 })}
        <span>Editing <b>${esc(ws.name)}</b> in your Workspace. When you save, the result goes back to the Workspace, not your downloads.</span>
        <a href="#/workspace">Back without changes</a></div>`));
      captureDownloads((file) => {
        push(tool.name, file);
        ws.pending = null;
        location.hash = "#/workspace";
      });
    }
    mod.mount({ main, desk, files: takeWaiting(), privateNote });
    stopResults = onResult((file) => keepWorking(desk, id, file));
  } catch (err) {
    console.error(err);
    main.innerHTML = `<p class="status bad">This tool couldn't load. Check your connection and refresh the page.</p>`;
  }
  app.focus({ preventScroll: true });
  scrollTo(0, 0);
}

function route() {
  const m = location.hash.match(/^#\/([\w-]+)/);
  if (m) toolPage(m[1]);
  else if (!app.querySelector("#tools")) home();
  else if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
}
addEventListener("hashchange", route);
route();
