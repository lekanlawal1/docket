import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWeights, upscaleCPU, upscaleImage, SCALE } from "../js/upscale.js";

const weights = () => { const b = readFileSync(new URL("../vendor/esrgan/realesr-general-x4v3.bin", import.meta.url)); return parseWeights(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const f32 = (b64) => { const b = Buffer.from(b64, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

test("the model file has every layer, at the right size", () => {
  const layers = weights();
  assert.equal(layers.length, 34);
  assert.equal(layers[0].inC, 3);
  assert.equal(layers[33].outC, 48);
  assert.equal(layers[33].a, null);
});

// output of the published architecture, computed separately in Python with NumPy
test("matches the reference model output", () => {
  const ref = JSON.parse(readFileSync(new URL("./esrgan-reference.json", import.meta.url)));
  const out = upscaleCPU(weights(), f32(ref.input), ref.w, ref.h);
  const want = f32(ref.output);
  assert.equal(out.length, want.length);
  let worst = 0;
  for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - want[i]));
  assert.ok(worst < 1e-4, `differs by up to ${worst}`);
});

test("tiles with margins give exactly the same picture as doing it whole", async () => {
  const layers = weights();
  // wider than a tile plus both margins, so the middle tiles are really cut out of the picture
  const w = 84, h = 5, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = (i * 37) % 256; data[i * 4 + 1] = (i * 11) % 256; data[i * 4 + 2] = (i * 5) % 256; data[i * 4 + 3] = 255; }
  const run = (p, tw, th) => upscaleCPU(layers, p, tw, th);
  const whole = await upscaleImage({ data, width: w, height: h }, run, { tile: 64 });
  const tiled = await upscaleImage({ data, width: w, height: h }, run, { tile: 12 });
  assert.equal(whole.width, w * SCALE);
  let diff = 0;
  for (let i = 0; i < whole.data.length; i++) diff = Math.max(diff, Math.abs(whole.data[i] - tiled.data[i]));
  assert.ok(diff <= 1, `tiles differ by up to ${diff}`);
});
