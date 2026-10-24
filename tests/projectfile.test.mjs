import { test } from "node:test";
import assert from "node:assert/strict";
import { zip, unzip } from "../js/zip.js";
import { toProjectFile, fromProjectFile } from "../js/projectfile.js";

const pdf = (text) => new File([new TextEncoder().encode(`%PDF-1.7\n${text}\n%%EOF`)], "x.pdf", { type: "application/pdf" });

test("unzip reads back what zip wrote", async () => {
  const files = [{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "dir/b.bin", data: new Uint8Array([0, 1, 2, 255]) }];
  const back = await unzip(zip(files));
  assert.deepEqual(back.map((f) => f.name), ["a.txt", "dir/b.bin"]);
  assert.deepEqual([...back[1].data], [0, 1, 2, 255]);
});

test("unzip catches a damaged file instead of half-reading it", async () => {
  const z = zip([{ name: "a.txt", data: new TextEncoder().encode("hello world") }]);
  z[30 + 5 + 2] ^= 0xff;   // flip a byte inside the stored data (after the 30-byte header and the name)
  await assert.rejects(unzip(z), /checksum/);
  await assert.rejects(unzip(new Uint8Array(100)), /isn't a ZIP/);
});

test("a project round-trips: name, every step and which one was showing", async () => {
  const steps = [{ label: "Opened", file: pdf("one") }, { label: "Page numbers", file: pdf("two") }, { label: "Watermark", file: pdf("three") }];
  const back = await fromProjectFile(await toProjectFile({ name: "lease.pdf", steps, at: 1 }));
  assert.equal(back.name, "lease.pdf");
  assert.equal(back.at, 1);
  assert.deepEqual(back.steps.map((s) => s.label), ["Opened", "Page numbers", "Watermark"]);
  assert.match(await back.steps[2].file.text(), /three/);
});

test("project files from elsewhere are checked before use", async () => {
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  const make = (manifest, extra = []) => zip([{ name: "manifest.json", data: enc(manifest) }, ...extra]);
  await assert.rejects(fromProjectFile(zip([{ name: "x.txt", data: new Uint8Array(3) }])), /no readable project details/);
  await assert.rejects(fromProjectFile(make({ format: "other" })), /isn't a Docket project/);
  await assert.rejects(fromProjectFile(make({ format: "docket-project", version: 9, steps: [] })), /newer Docket/);
  await assert.rejects(fromProjectFile(make({ format: "docket-project", version: 1, steps: [{ label: "a", file: "steps/1.pdf" }] })), /missing/);
  await assert.rejects(fromProjectFile(make({ format: "docket-project", version: 1, steps: [{ label: "a", file: "s.pdf" }] }, [{ name: "s.pdf", data: new TextEncoder().encode("<script>") }])), /isn't a PDF/);
  // an unsafe name is made safe, and an out-of-range step falls back to the last one
  const ok = await fromProjectFile(make({ format: "docket-project", version: 1, name: "../../evil", at: 99, steps: [{ label: "a", file: "s.pdf" }] }, [{ name: "s.pdf", data: new TextEncoder().encode("%PDF-1.4") }]));
  assert.equal(ok.name, "..-..-evil.pdf");
  assert.equal(ok.at, 0);
});
