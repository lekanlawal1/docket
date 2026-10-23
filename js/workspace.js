// The Workspace: one document, changed step by step. Each step keeps the whole file it
// produced, so undo is just stepping back, and nothing is ever re-done or re-read.
// It lives for the visit (in memory, on this device) and is gone when the tab closes.

export const ws = {
  name: "",
  steps: [],      // { label, file }
  at: -1,         // the step being shown
  pending: null,  // a tool opened from the Workspace, whose result comes back here
};

export const current = () => ws.steps[ws.at]?.file || null;
export const active = () => ws.at >= 0;

export function begin(file, label = "Opened") {
  ws.name = file.name;
  ws.steps = [{ label, file }];
  ws.at = 0;
  ws.pending = null;
}

// A new step after the one shown; anything that had been undone is dropped, as in any editor.
export function push(label, file) {
  ws.steps = ws.steps.slice(0, ws.at + 1);
  // keep the document's own name, whatever the tool called its output
  ws.steps.push({ label, file: new File([file], ws.name, { type: "application/pdf" }) });
  ws.at = ws.steps.length - 1;
}

export const canUndo = () => ws.at > 0;
export const canRedo = () => ws.at < ws.steps.length - 1;
export const undo = () => { if (canUndo()) ws.at--; };
export const redo = () => { if (canRedo()) ws.at++; };
export const jump = (i) => { if (i >= 0 && i < ws.steps.length) ws.at = i; };

export function clear() {
  ws.name = "";
  ws.steps = [];
  ws.at = -1;
  ws.pending = null;
}
