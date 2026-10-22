// A small .xlsx writer: sheets of rows, with numbers stored as real numbers (so they sum and
// sort) and a bold first row. Like docx.js, it's a zip of XML parts. No DOM, so the tests run
// it in Node.

import { zip } from "./zip.js";

const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Styles, by position in cellXfs below
const STYLE = { text: 0, bold: 1, money: 2, decimal: 3, percent: 4, whole: 5 };

// Text that's really a number: "$1,450.00", "(140.00)", "-12.5%", "1,234". Returns { value, style }
// or null. Anything with letters, dates or several numbers stays text.
export function asNumber(raw) {
  const t = String(raw).trim();
  const m = t.match(/^(\(?)(-|−)?\s*([$€£])?\s*(-|−)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%)?(\)?)$/);
  if (!m) return null;
  const [, open, minus1, currency, minus2, whole, fraction = "", percent, close] = m;
  if (Boolean(open) !== Boolean(close)) return null;
  if (!currency && !percent && !fraction && /^0\d/.test(whole)) return null;    // codes like 00123 keep their zeros
  let value = Number(whole.replace(/,/g, "") + fraction);
  if (open || minus1 || minus2) value = -value;
  if (percent) return { value: value / 100, style: STYLE.percent };
  if (currency) return { value, style: STYLE.money };
  return { value, style: fraction ? STYLE.decimal : STYLE.whole };
}

const colName = (k) => { let s = ""; for (k++; k; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };

function sheetXml(rows) {
  const widths = [];
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const text = cell == null ? "" : String(cell);
    widths[c] = Math.max(widths[c] || 8, Math.min(60, text.length + 2));
    if (!text) return "";
    const ref = colName(c) + (r + 1);
    const num = r === 0 ? null : asNumber(text);
    if (num) return `<c r="${ref}" s="${num.style}"><v>${num.value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ` s="${STYLE.bold}"` : ""}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const cols = widths.length ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]\\(&quot;$&quot;#,##0.00\\)"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Sheet names: at most 31 characters, none of []:*?/\ , and no two the same.
function sheetNames(names) {
  const seen = new Set();
  return names.map((n) => {
    let base = String(n).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet", name = base, k = 2;
    while (seen.has(name.toLowerCase())) name = `${base.slice(0, 27)} (${k++})`;
    seen.add(name.toLowerCase());
    return name;
  });
}

// sheets: [{ name, rows: [[cell text]] }]
export function xlsx(sheets) {
  const names = sheetNames(sheets.map((s) => s.name));
  const enc = new TextEncoder();
  const part = (name, text) => ({ name, data: enc.encode(text) });
  return zip([
    part("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    part("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    part("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    part("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    part("xl/styles.xml", STYLES),
    ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows))),
  ]);
}

// The same rows as CSV, for anything that isn't Excel.
export const csv = (rows) => rows.map((r) => r.map((c) => {
  const t = c == null ? "" : String(c);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}).join(",")).join("\n") + "\n";
