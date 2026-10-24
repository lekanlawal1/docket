// Workspace projects kept on this device, in the browser's own database (IndexedDB), so a
// document and its steps are still there tomorrow. Nothing here is ever sent anywhere.
//
// Two stores: "projects" holds one small record per document (name, dates, which step is
// shown), "steps" holds each step's file once, keyed by project and position. Adding a step
// writes only that step; earlier ones are never rewritten.

const DB = "docket-workspace", VERSION = 1;
export const KEEP_STEPS = 20;          // older steps are dropped beyond this, to save space
export const FORGET_AFTER_DAYS = 30;   // unpinned projects untouched this long are deleted

let opening = null;
function db() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("steps")) d.createObjectStore("steps", { keyPath: ["project", "n"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

// One transaction; `work(stores)` queues the requests, and this resolves when they're done.
async function tx(mode, work) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["projects", "steps"], mode);
    let result;
    const stores = { projects: t.objectStore("projects"), steps: t.objectStore("steps") };
    Promise.resolve(work(stores, (v) => (result = v))).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("saving was stopped"));
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

// ---- the on/off switch (per browser; on unless turned off)

export function keeping() {
  try { return localStorage.getItem("docket-keep-work") !== "off"; } catch { return true; }
}
export function setKeeping(on) {
  try { localStorage.setItem("docket-keep-work", on ? "on" : "off"); } catch { /* storage blocked: stays on for this visit */ }
}

// Whether this browser can keep anything at all (private windows in some browsers can't).
export async function available() {
  try { await db(); return true; } catch { return false; }
}

// Ask the browser not to clear Docket's storage when space runs low. Best effort.
export async function askToPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* not offered */ }
}

export async function usage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return null; }
}

// ---- projects

export async function list() {
  const all = await tx("readonly", async (s, done) => done(await req(s.projects.getAll())));
  return (all || []).sort((a, b) => b.updated - a.updated);
}

// Deletes unpinned projects untouched for FORGET_AFTER_DAYS. Returns how many went.
export async function tidy(now = Date.now()) {
  const old = (await list()).filter((p) => !p.pinned && now - p.updated > FORGET_AFTER_DAYS * 86_400_000);
  for (const p of old) await forget(p.id);
  return old.length;
}

export async function create({ id, name, label, file }) {
  const now = Date.now();
  await tx("readwrite", (s) => {
    s.projects.put({ id, name, created: now, updated: now, at: 0, count: 1, first: 0, labels: [label], sizes: [file.size], pinned: false });
    s.steps.put({ project: id, n: 0, blob: file });
  });
}

// Adds step `n` (after dropping any undone steps from `n` on), and trims the oldest beyond KEEP_STEPS.
// Returns the new first step number, so the caller can trim its own list the same way.
export async function addStep(id, n, label, file) {
  return tx("readwrite", async (s, done) => {
    const p = await req(s.projects.get(id));
    if (!p) return done(null);
    for (let k = n; k < p.first + p.count; k++) s.steps.delete([id, k]);
    s.steps.put({ project: id, n, blob: file });
    const labels = p.labels.slice(0, n - p.first).concat(label);
    const sizes = p.sizes.slice(0, n - p.first).concat(file.size);
    let first = p.first, count = n - p.first + 1;
    while (count > KEEP_STEPS) { s.steps.delete([id, first]); labels.shift(); sizes.shift(); first++; count--; }
    s.projects.put({ ...p, first, count, labels, sizes, at: n, updated: Date.now() });
    done(first);
  });
}

export async function update(id, changes) {
  await tx("readwrite", async (s) => {
    const p = await req(s.projects.get(id));
    if (p) s.projects.put({ ...p, ...changes, updated: changes.touch === false ? p.updated : Date.now(), touch: undefined });
  });
}

// The project and all its steps' files, in order.
export async function load(id) {
  return tx("readonly", async (s, done) => {
    const p = await req(s.projects.get(id));
    if (!p) return done(null);
    const steps = [];
    for (let k = 0; k < p.count; k++) {
      const row = await req(s.steps.get([id, p.first + k]));
      if (!row) break;
      steps.push({ label: p.labels[k], file: new File([row.blob], p.name, { type: "application/pdf" }) });
    }
    done({ ...p, steps });
  });
}

export async function forget(id) {
  await tx("readwrite", async (s) => {
    const p = await req(s.projects.get(id));
    if (p) for (let k = p.first; k < p.first + p.count; k++) s.steps.delete([id, k]);
    s.projects.delete(id);
  });
}

export async function forgetAll() {
  await tx("readwrite", (s) => { s.projects.clear(); s.steps.clear(); });
}
