import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { xlsx, asNumber, csv } from "../js/xlsx.js";

test("money, percentages, negatives and thousands become numbers; codes and dates don't", () => {
  assert.deepEqual(asNumber("$1,450.00"), { value: 1450, style: 2 });
  assert.deepEqual(asNumber("(140.00)"), { value: -140, style: 3 });
  assert.deepEqual(asNumber("-$5"), { value: -5, style: 2 });
  assert.deepEqual(asNumber("12.5%"), { value: 0.125, style: 4 });
  assert.deepEqual(asNumber("1,234"), { value: 1234, style: 5 });
  for (const t of ["00123", "2026-03-01", "Mar 1", "4417-2290", "1.2.3", "(12", "12 34", "$"]) assert.equal(asNumber(t), null, t);
});

test("the workbook opens as a real spreadsheet with numbers stored as numbers", () => {
  const data = xlsx([
    { name: "Page 1 table 1", rows: [["Fee", "Rate", "Amount"], ["Visa interchange", "1.65%", "$412.50"], ["Refund", "", "($20.00)"], ["Café & co <ok>", "", "1,000"]] },
    { name: "Page 1 table 1", rows: [["Only", "two"]] },
  ]);
  const dir = mkdtempSync(join(tmpdir(), "docket-xlsx-"));
  const path = join(dir, "out.xlsx");
  writeFileSync(path, data);
  const script = `
import sys, zipfile, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
for n in z.namelist(): xml.dom.minidom.parseString(z.read(n))
try:
    import openpyxl
    wb = openpyxl.load_workbook(sys.argv[1])
    ws = wb.worksheets[0]
    print(wb.sheetnames, ws["A1"].value, ws["A1"].font.b, ws["B2"].value, ws["C2"].value, ws["C3"].value, ws["A4"].value, ws["C4"].value, ws.freeze_panes)
except ImportError:
    print("no openpyxl")`;
  const out = execFileSync("python3", ["-c", script, path], { encoding: "utf8" }).trim();
  if (out !== "no openpyxl") assert.equal(out, "['Page 1 table 1', 'Page 1 table 1 (2)'] Fee True 0.0165 412.5 -20 Café & co <ok> 1000 A2");
});

test("csv quotes what needs quoting", () => {
  assert.equal(csv([["a", "b,c", 'say "hi"']]), 'a,"b,c","say ""hi"""\n');
});
