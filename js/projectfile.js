// A Workspace project as one file you can keep, move or email: "lease.docket". Inside it's a
// plain ZIP: manifest.json (the name, the steps' labels, which one was showing) and each step's
// PDF. Opening one on any device brings back the document with its whole history. A project
// file can come from anywhere, so everything in it is checked before it's used.

import { zip, unzip } from "./zip.js";

export const EXT = ".docket";
const FORMAT = "docket-project", VERSION = 1, MAX_STEPS = 200;

export function toProjectFile({ name, steps, at }) {
  return Promise.all(steps.map((s) => s.file.arrayBuffer())).then((buffers) => {
    const paths = steps.map((_, i) => `steps/${String(i + 1).padStart(3, "0")}.pdf`);
    const manifest = { format: FORMAT, version: VERSION, name, at, saved: new Date().toISOString(),
      steps: steps.map((s, i) => ({ label: s.label, file: paths[i] })) };
    return zip([
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      ...buffers.map((b, i) => ({ name: paths[i], data: new Uint8Array(b) })),
    ]);
  });
}

const looksLikePdf = (data) => new TextDecoder("latin1").decode(data.subarray(0, 1024)).includes("%PDF-");

// The project inside a .docket file, or a plain-words error saying what's wrong with it.
export async function fromProjectFile(bytes) {
  let entries;
  try { entries = await unzip(bytes); }
  catch (err) { throw new Error(`This isn't a Docket project file, or it's damaged (${err.message}).`); }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  let m;
  try { m = JSON.parse(new TextDecoder().decode(byName.get("manifest.json"))); }
  catch { throw new Error("This file has no readable project details, so it isn't a Docket project file."); }
  if (m?.format !== FORMAT) throw new Error("This isn't a Docket project file.");
  if (!(m.version <= VERSION)) throw new Error("This project was saved by a newer Docket. Refresh the page to update, then try again.");
  if (!Array.isArray(m.steps) || !m.steps.length || m.steps.length > MAX_STEPS) throw new Error("This project file's list of steps is damaged.");
  const name = String(m.name || "document.pdf").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120).replace(/(\.pdf)?$/i, ".pdf");
  const steps = m.steps.map((s, i) => {
    const data = byName.get(String(s?.file));
    if (!data) throw new Error(`Step ${i + 1} is missing from the project file.`);
    if (!looksLikePdf(data)) throw new Error(`Step ${i + 1} in the project file isn't a PDF.`);
    return { label: String(s.label || `Step ${i + 1}`).slice(0, 80), file: new File([data], name, { type: "application/pdf" }) };
  });
  const at = Number.isInteger(m.at) && m.at >= 0 && m.at < steps.length ? m.at : steps.length - 1;
  return { name, steps, at };
}
