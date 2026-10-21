import { test } from "node:test";
import assert from "node:assert/strict";
import { paragraphs, withPictures } from "../js/layout.js";

// Lays out text the way a PDF would: one item per line, 6 points per character.
function page(lines, { width = 612, height = 792 } = {}) {
  const items = [];
  for (const l of lines) {
    const size = l.size || 11;
    items.push({ str: l.text, x: l.x ?? 72, y: l.y, size, width: l.text.length * size * 0.5, bold: !!l.bold, italic: !!l.italic });
  }
  return { width, height, items };
}

const text = (p) => p.runs.map((r) => r.text).join("");
const long = "and the rest of this line keeps going until it reaches the margin";

test("lines close together become one paragraph; a gap starts another", () => {
  const out = paragraphs([page([
    { text: "The tenant agrees to pay rent each month " + long, y: 100 },
    { text: "starting in March, by bank transfer.", y: 114 },
    { text: "Late rent is charged a fee after the fifth day " + long, y: 142 },
    { text: "of the month.", y: 156 },
  ])]);
  assert.equal(out.length, 2);
  assert.match(text(out[0]), /each month and the rest.*starting in March/);
  assert.equal(text(out[1]).endsWith("of the month."), true);
});

test("bigger text becomes a heading, and bold short lines a smaller one", () => {
  const out = paragraphs([page([
    { text: "Lease Agreement", y: 80, size: 20 },
    { text: "This lease is between the landlord and the tenant " + long, y: 120 },
    { text: "named below.", y: 134 },
    { text: "Payment", y: 170, bold: true },
    { text: "Rent is due on the first day of every month " + long, y: 190 },
  ])]);
  assert.deepEqual(out.map((p) => p.heading), [1, undefined, 3, undefined]);
  assert.equal(text(out[2]), "Payment");
});

test("words split across lines with a hyphen are joined", () => {
  const out = paragraphs([page([
    { text: "Please send the signed copy and all of the infor-", y: 100 },
    { text: "mation we asked for.", y: 114 },
  ])]);
  assert.equal(text(out[0]), "Please send the signed copy and all of the information we asked for.");
});

test("bullets and numbered items become list paragraphs", () => {
  const out = paragraphs([page([
    { text: "You will need:", y: 100 },
    { text: "• photo ID", y: 120 },
    { text: "• proof of address", y: 134 },
    { text: "2) a void cheque", y: 148 },
  ])]);
  assert.deepEqual(out.map((p) => !!p.list), [false, true, true, true]);
  assert.equal(text(out[1]), "•\tphoto ID");
  assert.equal(text(out[3]), "2.\ta void cheque");
});

test("headers, footers and page numbers that repeat are dropped", () => {
  const pages = [1, 2, 3].map((n) => page([
    { text: "ACME Corp. Confidential", y: 30 },
    { text: `Body text on page ${n} that says something useful here.`, y: 300 },
    { text: `Page ${n} of 3`, y: 770 },
  ]));
  const all = paragraphs(pages).map(text).join("\n");
  assert.doesNotMatch(all, /ACME|Page \d of/);
  assert.match(all, /page 1.*\n.*page 2.*\n.*page 3/s);
});

test("two-column pages are read down the left column, then the right", () => {
  const lines = [{ text: "A Title Across The Page", y: 60, size: 18, x: 72 }];
  for (let i = 0; i < 6; i++) {
    lines.push({ text: `left ${i} text text text text`, y: 120 + i * 14, x: 72 });
    lines.push({ text: `right ${i} text text text text`, y: 120 + i * 14, x: 330 });
  }
  const all = paragraphs([page(lines)]).map(text).join(" ");
  assert.ok(all.indexOf("left 5") < all.indexOf("right 0"), all);
  assert.ok(all.indexOf("A Title") < all.indexOf("left 0"));
});

test("a label and its value far apart on one line stay on one line", () => {
  const out = paragraphs([page([
    { text: "Account number:", y: 100, x: 72 },
    { text: "4417-2290", y: 100, x: 400 },
  ])]);
  assert.equal(out.length, 1);
  assert.equal(text(out[0]), "Account number:\t4417-2290");
});

test("bold and italic survive as runs", () => {
  const out = paragraphs([{ width: 612, height: 792, items: [
    { str: "This is ", x: 72, y: 100, size: 11, width: 40 },
    { str: "important", x: 112, y: 100, size: 11, width: 45, bold: true },
    { str: " and ", x: 157, y: 100, size: 11, width: 20 },
    { str: "emphasised.", x: 177, y: 100, size: 11, width: 55, italic: true },
  ] }]);
  assert.deepEqual(out[0].runs, [
    { text: "This is ", bold: false, italic: false },
    { text: "important", bold: true, italic: false },
    { text: " and ", bold: false, italic: false },
    { text: "emphasised.", bold: false, italic: true },
  ]);
});

test("pictures go between the right paragraphs; scans and repeated logos don't", () => {
  const pages = [1, 2].map(() => ({ width: 612, height: 792 }));
  const paras = [
    { page: 0, top: 100, runs: [{ text: "Intro" }] },
    { page: 0, top: 500, runs: [{ text: "After the chart" }] },
    { page: 1, top: 100, runs: [{ text: "Page two" }] },
  ];
  const pics = [
    { page: 0, y: 250, x: 72, width: 300, height: 200, key: "chart" },
    { page: 0, y: 20, x: 72, width: 80, height: 30, key: "logo" },    // in the header of both pages
    { page: 1, y: 20, x: 72, width: 80, height: 30, key: "logo" },
    { page: 1, y: 0, x: 0, width: 612, height: 792, key: "scan" },    // a whole-page picture behind text
  ];
  const order = withPictures(paras, pics, pages).map((p) => (p.picture ? `[${p.picture.key}]` : p.runs[0].text));
  assert.deepEqual(order, ["Intro", "[chart]", "After the chart", "Page two"]);
});
