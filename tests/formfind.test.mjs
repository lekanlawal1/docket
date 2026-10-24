import { test } from "node:test";
import assert from "node:assert/strict";
import { findBlanks } from "../js/formfind.js";

// A drawn form page, 1000 px across (so 1% of the width is 10 px), white with black ink.
function page(w = 1000, h = 1300) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  };
  // a "word": letter-shaped blocks with gaps between them, standing on baseline y
  const word = (x, y, letters) => { for (let k = 0; k < letters; k++) fill(x + k * 9, y - 12, x + k * 9 + 6, y); };
  const box = (x, y, s) => { fill(x, y, x + s, y + 2); fill(x, y + s - 2, x + s, y + s); fill(x, y, x + 2, y + s); fill(x + s - 2, y, x + s, y + s); };
  return { img: { data, width: w, height: h }, fill, word, box };
}

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

test("a line after a label is a blank, starting where the label ends", () => {
  const { img, fill, word } = page();
  word(50, 200, 6);           // "Name" ends near x = 100
  fill(110, 200, 600, 202);   // the line to write on
  const found = findBlanks(img);
  assert.equal(found.length, 1);
  const [f] = found;
  assert.equal(f.kind, "text");
  assert.ok(near(f.x, 0.11) && near(f.x + f.w, 0.6), `spans ${f.x}..${f.x + f.w}`);
  assert.ok(near(f.y + f.h, 200 / 1300, 0.003), "it should sit on the line");
  assert.ok(f.h * 1300 >= 10, "tall enough to write in");
});

test("a label above part of a line splits it, and the part under the label isn't a blank", () => {
  const { img, fill, word } = page();
  fill(50, 400, 700, 402);
  word(300, 392, 8);          // a label sitting just above the middle of the line
  const blanks = findBlanks(img).filter((f) => f.kind === "text");
  assert.equal(blanks.length, 2);
  assert.ok(blanks[0].x + blanks[0].w <= 0.3 && blanks[1].x >= 0.37, JSON.stringify(blanks));
});

test("small empty squares are tick boxes; letters, filled squares and big frames aren't", () => {
  const { img, fill, word, box } = page();
  box(100, 300, 16);           // a tick box
  box(200, 300, 20);           // another
  fill(300, 300, 316, 316);   // a filled square
  box(400, 250, 120);          // a big frame
  word(600, 316, 3);           // letters
  const boxes = findBlanks(img).filter((f) => f.kind === "check");
  assert.equal(boxes.length, 2);
  assert.ok(near(boxes[0].x, 0.1) && near(boxes[1].x, 0.2));
});

test("page-wide rules, heavy bars and table rows aren't blanks", () => {
  const { img, fill } = page();
  fill(20, 100, 980, 102);     // a rule across the page
  fill(100, 200, 600, 210);    // a heavy bar
  // a table: rows with sides
  for (const y of [500, 540, 580]) fill(100, y, 700, y + 2);
  for (const x of [100, 698]) fill(x, 500, x + 2, 582);
  assert.deepEqual(findBlanks(img), []);
});
