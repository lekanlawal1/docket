import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docx } from "../js/docx.js";

test("the .docx has the parts Word needs, all well-formed XML", () => {
  const data = docx([
    { heading: 1, runs: [{ text: "Lease & Terms <draft>" }] },
    { runs: [{ text: "Rent is " }, { text: "$1,450", bold: true }, { text: "\u0007 a month." }] },
    { list: true, runs: [{ text: "•\tphoto ID" }] },
  ], { title: "Lease" });
  const dir = mkdtempSync(join(tmpdir(), "docket-docx-"));
  const path = join(dir, "out.docx");
  writeFileSync(path, data);
  const script = `
import sys, zipfile, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
for n in z.namelist(): xml.dom.minidom.parseString(z.read(n))
doc = z.read("word/document.xml").decode()
print(",".join(sorted(z.namelist())))
print(doc.count("<w:p>"), "Heading1" in doc, "&amp;" in doc, "&lt;draft&gt;" in doc, "<w:b/>" in doc, "<w:tab/>" in doc, "\\x07" in doc)`;
  const [names, checks] = execFileSync("python3", ["-c", script, path], { encoding: "utf8" }).trim().split("\n");
  assert.equal(names, "[Content_Types].xml,_rels/.rels,docProps/core.xml,word/_rels/document.xml.rels,word/document.xml,word/styles.xml");
  assert.equal(checks, "3 True True True True True False");
});
