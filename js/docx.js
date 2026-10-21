// A small .docx writer: just enough WordprocessingML for headings, paragraphs, list items
// and bold or italic text. A .docx is a zip of XML files, and zip.js already writes zips.
// No DOM, so the tests run it in Node.

import { zip } from "./zip.js";

// XML can't hold most control characters, and PDFs sometimes contain them
const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// sizes are in half-points, spacing in twentieths of a point
const heading = (id, name, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${id.slice(-1) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-CA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading("Heading1", "heading 1", 32, 360)}
${heading("Heading2", "heading 2", 26, 280)}
${heading("Heading3", "heading 3", 23, 200)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style>
</w:styles>`;

function core(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title || "")}</dc:title><dc:creator>Docket</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function run({ text, bold, italic }) {
  const props = (bold ? "<w:b/>" : "") + (italic ? "<w:i/>" : "");
  // tabs are their own element in Word; everything else is plain text
  const parts = String(text).split("\t").map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`).join("<w:tab/>");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${parts}</w:r>`;
}

function paragraph(p) {
  const style = p.heading ? `Heading${p.heading}` : p.list ? "ListParagraph" : null;
  const props = (style ? `<w:pStyle w:val="${style}"/>` : "") + (p.pageBreakBefore ? "<w:pageBreakBefore/>" : "");
  // headings take their weight from the style, so drop bold that only came from the PDF's font
  const runs = p.heading ? p.runs.map((r) => ({ ...r, bold: false })) : p.runs;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs.map(run).join("")}</w:p>`;
}

// paragraphs: [{ heading?: 1|2|3, list?: true, runs: [{ text, bold?, italic? }] }]
// page: { width, height } in points, for the document's page size
export function docx(paragraphs, { title = "", page = { width: 612, height: 792 } } = {}) {
  const twips = (pt) => Math.round(pt * 20);
  const body = paragraphs.map(paragraph).join("\n");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${body || "<w:p/>"}
<w:sectPr><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"${page.width > page.height ? ' w:orient="landscape"' : ""}/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const enc = new TextEncoder();
  return zip([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "docProps/core.xml", data: enc.encode(core(title)) },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
  ]);
}
