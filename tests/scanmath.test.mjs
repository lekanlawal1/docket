import { test } from "node:test";
import assert from "node:assert/strict";
import { findPage, homography, project, warp, outputSize, clean, blackAndWhite, convex, polygonArea } from "../js/scanmath.js";

// A "photo": dark wooden desk, a sheet of paper seen at an angle, lines of dark print on it.
function photo(w, h, corners, { desk = 70, paper = 225, noise = 12 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], corners.map(([x, y]) => [x * w, y * h]));
  const back = homography(corners.map(([x, y]) => [x * w, y * h]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noise;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [u, v] = project(back, x + 0.5, y + 0.5);
    let g = desk + 20 * Math.sin(x / 9) + rnd();
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      g = paper + rnd() - 25 * v;                           // a shadow creeping down the page
      if (u > 0.1 && u < 0.9 && ((v * 20) % 1) < 0.25 && v > 0.1 && v < 0.85) g = 40;  // lines of print
    }
    const o = (y * w + x) * 4;
    data[o] = g + 6; data[o + 1] = g; data[o + 2] = g - 8; data[o + 3] = 255;
  }
  void H;
  return { data, width: w, height: h };
}

const near = (a, b, tol) => a.every(([x, y], i) => Math.abs(x - b[i][0]) < tol && Math.abs(y - b[i][1]) < tol);

test("a homography maps the four corners exactly", () => {
  const from = [[0, 0], [100, 0], [100, 140], [0, 140]], to = [[12, 30], [180, 8], [200, 260], [5, 230]];
  const H = homography(from, to);
  from.forEach((p, i) => { const [u, v] = project(H, ...p); assert.ok(Math.hypot(u - to[i][0], v - to[i][1]) < 1e-6); });
});

test("finds a page photographed straight on", () => {
  const corners = [[0.15, 0.1], [0.85, 0.1], [0.85, 0.92], [0.15, 0.92]];
  assert.ok(near(findPage(photo(300, 400, corners)), corners, 0.02));
});

test("finds a page shot at an angle, tilted and in perspective", () => {
  const corners = [[0.22, 0.12], [0.8, 0.18], [0.88, 0.9], [0.1, 0.84]];
  assert.ok(near(findPage(photo(300, 400, corners)), corners, 0.025));
});

test("says there's no page when the photo is all page or all desk", () => {
  assert.equal(findPage(photo(200, 260, [[-0.1, -0.1], [1.1, -0.1], [1.1, 1.1], [-0.1, 1.1]])), null);
  assert.equal(findPage(photo(200, 260, [[0.45, 0.45], [0.5, 0.45], [0.5, 0.5], [0.45, 0.5]])), null);
});

test("straightening turns the angled sheet back into a rectangle of paper", () => {
  const corners = [[0.22, 0.12], [0.8, 0.18], [0.88, 0.9], [0.1, 0.84]];
  const img = photo(300, 400, corners);
  const px = findPage(img).map(([x, y]) => [x * img.width, y * img.height]);
  const [w, h] = outputSize(px);
  const flat = warp(img, px, w, h);
  // every edge of the result is paper (bright), with no desk showing
  const lum = (x, y) => flat.data[(y * w + x) * 4 + 1];
  const edge = [];
  for (let k = 4; k < w - 4; k += 4) edge.push(lum(k, 3), lum(k, h - 4));
  for (let k = 4; k < h - 4; k += 4) edge.push(lum(3, k), lum(w - 4, k));
  assert.ok(edge.filter((v) => v < 120).length / edge.length < 0.03, "desk visible at the edges");
  // the lines of print run straight across: a row through one is dark all along its middle
  let darkRow = -1;
  for (let y = Math.round(h * 0.3); y < h * 0.5 && darkRow < 0; y++) {
    const row = Array.from({ length: Math.round(w * 0.6) }, (_, i) => lum(Math.round(w * 0.2) + i, y));
    if (row.every((v) => v < 110)) darkRow = y;
  }
  assert.ok(darkRow > 0, "no straight line of print found");
});

test("clean and black-and-white make the paper white and keep the print dark", () => {
  const img = photo(240, 320, [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
  for (const look of [clean, blackAndWhite]) {
    const out = look(img);
    const at = (fx, fy) => out.data[(Math.round(fy * 320) * 240 + Math.round(fx * 240)) * 4];
    assert.ok(at(0.5, 0.88) > 230, `${look.name}: paper in the shadow should be white, got ${at(0.5, 0.88)}`);
    // a line of print sits at v = 0.3 on the page, which is y = 0.1 + 0.3 * 0.8
    assert.ok(at(0.5, 0.1 + 0.3 * 0.8 + 0.004) < 80, `${look.name}: print should be dark`);
  }
});

test("shape checks", () => {
  assert.equal(convex([[0, 0], [1, 0], [1, 1], [0, 1]]), true);
  assert.equal(convex([[0, 0], [1, 1], [1, 0], [0, 1]]), false);
  assert.equal(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]), 1);
});

import { trueAspect, outputSize as size } from "../js/scanmath.js";
import { cameraCorners } from "./camera.mjs";

test("the page's true shape comes back from a photo taken at an angle", () => {
  for (const view of [{ tiltX: 25, tiltY: 10, spin: 4 }, { tiltX: -15, tiltY: -20, spin: -8 }, { tiltX: 35, tiltY: 0, spin: 0, shift: [0.1, -0.05] }]) {
    for (const aspect of [8.5 / 11, 210 / 297, 11 / 8.5]) {
      const px = cameraCorners({ ...view, aspect }).map(([x, y]) => [x * 1500, y * 2000]);
      assert.ok(Math.abs(trueAspect(px, 1500, 2000) / aspect - 1) < 0.01, `${JSON.stringify(view)} ${aspect}: ${trueAspect(px, 1500, 2000)}`);
      const [w, h] = size(px, 2000, [1500, 2000]);
      assert.ok(Math.abs(w / h / aspect - 1) < 0.01);
    }
  }
  // straight on: no perspective to undo, and it still knows the shape
  const flat = [[300, 400], [1200, 400], [1200, 1600], [300, 1600]];
  assert.ok(Math.abs(trueAspect(flat, 1500, 2000) - 0.75) < 1e-6);
});
