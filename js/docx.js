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
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const docRels = (media) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.${m.ext}"/>`).join("\n")}
</Relationships>`;

// A picture in its own paragraph, sized in EMUs (12,700 to a point).
function picture(n, widthPt, heightPt) {
  const cx = Math.round(widthPt * 12700), cy = Math.round(heightPt * 12700);
  return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

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

// A table: light borders, column widths in proportion to the PDF's, number columns aligned
// right, and a first row that's all bold repeated at the top of each page as a header.
function table({ rows, widths, numeric }, room) {
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const tw = widths.map((w) => Math.max(400, Math.round((w / total) * room)));
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const header = rows[0].length && rows[0].every((cell) => !cell.length || cell.every((r) => r.bold || !r.text.trim()));
  const tr = (cells, i) => `<w:tr>${i === 0 && header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((runs, k) =>
    `<w:tc><w:tcPr><w:tcW w:w="${tw[k]}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${numeric[k] && !(i === 0 && header) ? '<w:jc w:val="right"/>' : ""}</w:pPr>${runs.map(run).join("")}</w:p></w:tc>`).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>
<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblGrid>${tw.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.map(tr).join("")}</w:tbl>`;
}

// paragraphs: [{ heading?: 1|2|3, list?: true, runs: [{ text, bold?, italic? }] }], or
// [{ table: { rows: [[runs per cell]], widths, numeric } }], or
// [{ picture: { data: Uint8Array, ext: "png" | "jpeg", width, height } }] with the size in points
// page: { width, height } in points, for the document's page size
export function docx(paragraphs, { title = "", page = { width: 612, height: 792 } } = {}) {
  const twips = (pt) => Math.round(pt * 20);
  // pictures are shrunk to fit between the margins (an inch each side), never enlarged
  const media = [], room = page.width - 144;
  const body = paragraphs.map((p, i) => {
    // Word expects a paragraph after a table, so one that ends the document gets an empty one
    if (p.table) return table(p.table, room * 20) + (i === paragraphs.length - 1 ? "<w:p/>" : "");
    if (!p.picture) return paragraph(p);
    media.push(p.picture);
    const k = Math.min(1, room / p.picture.width);
    return picture(media.length, p.picture.width * k, p.picture.height * k);
  }).join("\n");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>
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
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRels(media)) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
    ...media.map((m, i) => ({ name: `word/media/image${i + 1}.${m.ext}`, data: m.data })),
  ]);
}
