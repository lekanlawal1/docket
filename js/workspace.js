// The Workspace: one document, changed step by step. Each step keeps the whole file it
// produced, so undo is just stepping back, and nothing is ever re-done or re-read.
// With "keep my work on this device" on (the default), every step is also saved in this
// browser (js/projects.js), so the document is still here after a refresh or tomorrow.

import * as store from "./projects.js";

export const ws = {
  id: null,
  name: "",
  steps: [],      // { label, file }
  first: 0,       // the saved number of steps[0] (older steps get trimmed)
  at: -1,         // the step being shown
  pending: null,  // a tool opened from the Workspace, whose result comes back here
  saved: false,   // whether it's being kept on this device
  saveError: "",
};

export const current = () => ws.steps[ws.at]?.file || null;
export const active = () => ws.at >= 0;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// Saving never gets in the way: if it fails, the Workspace carries on in memory and says so.
async function save(job) {
  if (!ws.saved) return;
  try { await job(); ws.saveError = ""; }
  catch (err) { console.warn(err); ws.saveError = "Couldn't save this step on the device (it may be full). Your work is still here until you close the tab."; }
}

export async function begin(file, label = "Opened") {
  ws.id = newId();
  ws.name = file.name;
  ws.steps = [{ label, file }];
  ws.first = 0;
  ws.at = 0;
  ws.pending = null;
  ws.saved = store.keeping() && (await store.available());
  await save(async () => {
    await store.create({ id: ws.id, name: ws.name, label, file });
    store.askToPersist();
  });
}

// A new step after the one shown; anything that had been undone is dropped, as in any editor.
export async function push(label, file) {
  // keep the document's own name, whatever the tool called its output
  const step = { label, file: new File([file], ws.name, { type: "application/pdf" }) };
  ws.steps = ws.steps.slice(0, ws.at + 1);
  ws.steps.push(step);
  ws.at = ws.steps.length - 1;
  // the oldest go beyond the limit, here and on the device alike
  while (ws.steps.length > store.KEEP_STEPS) { ws.steps.shift(); ws.first++; ws.at--; }
  await save(() => store.addStep(ws.id, ws.first + ws.at, label, step.file));
}

const remember = () => save(() => store.update(ws.id, { at: ws.first + ws.at }));
export const canUndo = () => ws.at > 0;
export const canRedo = () => ws.at < ws.steps.length - 1;
export const undo = () => { if (canUndo()) { ws.at--; remember(); } };
export const redo = () => { if (canRedo()) { ws.at++; remember(); } };
export const jump = (i) => { if (i >= 0 && i < ws.steps.length) { ws.at = i; remember(); } };

export async function rename(name) {
  ws.name = name;
  ws.steps = ws.steps.map((s) => ({ ...s, file: new File([s.file], name, { type: "application/pdf" }) }));
  await save(() => store.update(ws.id, { name }));
}

// Opens a saved project into the Workspace.
export async function resume(id) {
  const p = await store.load(id);
  if (!p || !p.steps.length) return false;
  ws.id = p.id;
  ws.name = p.name;
  ws.steps = p.steps;
  ws.first = p.first;
  ws.at = Math.min(Math.max(0, p.at - p.first), p.steps.length - 1);
  ws.pending = null;
  ws.saved = true;
  ws.saveError = "";
  return true;
}

// Stops keeping this document on the device (the open copy stays until the tab closes).
export async function forgetThis() {
  if (ws.id) await store.forget(ws.id).catch(() => {});
  ws.saved = false;
}

// Starts keeping a document that wasn't being kept: every step is saved now.
export async function keepThis() {
  if (!(await store.available())) return false;
  ws.saved = true;
  await save(async () => {
    await store.create({ id: ws.id, name: ws.name, label: ws.steps[0].label, file: ws.steps[0].file });
    for (let k = 1; k < ws.steps.length; k++) await store.addStep(ws.id, k, ws.steps[k].label, ws.steps[k].file);
    await store.update(ws.id, { at: ws.at });
  });
  ws.first = 0;
  return true;
}

export function clear() {
  ws.id = null;
  ws.name = "";
  ws.steps = [];
  ws.first = 0;
  ws.at = -1;
  ws.pending = null;
  ws.saved = false;
  ws.saveError = "";
}
