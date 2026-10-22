// Docket's front door: the home page, the tool pages, night mode and the little boat.
// Routes are hashes so the whole thing works as plain static files: "#/merge" opens a tool.

import { PIERS, findTool } from "./tools.js";
import { svg } from "./icons.js";
import { h, esc, dock, privateNote } from "./ui.js";

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

function suggestions(files) {
  const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)).length;
  const images = files.filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name)).length;
  if (pdfs === 2) return ["compare", "merge", "compress"];
  if (pdfs > 2) return ["merge", "compress", "pdf-to-jpg"];
  if (pdfs === 1) return ["organise", "split", "sign", "redact", "compress", "summary"];
  if (images) return ["images-to-pdf", "convert-images", "resize-image", "compress-image"];
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
      <span>${svg("wave", { size: 16 })}Works offline once loaded</span>
    </div>
  </section>`);
  const suggest = hero.querySelector(".suggest");
  hero.querySelector(".dock-spot").append(dock({
    multiple: true, accept: ".pdf,image/*,.heic,.heif",
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
  app.append(hero, piers, harbour);
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

// ---------------------------------------------------------------- a tool page
async function toolPage(id) {
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
    mod.mount({ main, desk, files: takeWaiting(), privateNote });
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
