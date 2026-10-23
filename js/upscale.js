// Making a picture 4× bigger with an AI model (Real-ESRGAN's compact general model, BSD
// licence), run on this device. The model is 34 small layers, each a 3×3 convolution; the
// last one makes 16 sub-pixels per pixel, added to a plain enlargement of the picture.
//
// It runs on the graphics chip through WebGL2, a tile at a time. A plain JavaScript version
// of the same maths is here too: far too slow for real photos, but it checks the GPU version
// and runs the tests in Node.
//
// Pictures here are planar Float32Arrays, channel by channel, values 0..1: [R..., G..., B...].

export const SCALE = 4;
const PAD = 34;      // how far one output pixel "sees": a tile with this margin matches the whole picture exactly

// ---- the model's numbers

// The weights file: half-precision floats, layer after layer: weights [out][in][3][3], biases,
// then the activation's slopes (all but the last layer).
export function parseWeights(buffer) {
  const half = new Uint16Array(buffer);
  const all = new Float32Array(half.length);
  for (let i = 0; i < half.length; i++) all[i] = fromHalf(half[i]);
  const layers = [];
  let at = 0;
  const take = (n) => all.subarray(at, (at += n));
  for (let i = 0; i < 34; i++) {
    const inC = i === 0 ? 3 : 64, outC = i === 33 ? 48 : 64;
    layers.push({ inC, outC, w: take(outC * inC * 9), b: take(outC), a: i === 33 ? null : take(outC) });
  }
  if (at !== all.length) throw new Error("the model file isn't the expected size");
  return layers;
}

function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

let weightsPromise = null;
export function loadWeights() {
  weightsPromise ??= fetch(new URL("../vendor/esrgan/realesr-general-x4v3.bin", import.meta.url))
    .then((r) => { if (!r.ok) throw new Error("couldn't download the upscaling model. Check your connection and try again."); return r.arrayBuffer(); })
    .then(parseWeights)
    .catch((err) => { weightsPromise = null; throw err; });
  return weightsPromise;
}

// The 48 channels of the last layer, rearranged into a picture 4× the size, plus the plain
// (nearest-pixel) enlargement of the input the model learned to correct.
function shuffle(last, input, w, hgt) {
  const W = w * SCALE, H = hgt * SCALE, out = new Float32Array(3 * W * H);
  for (let c = 0; c < 3; c++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sy = y >> 2, sx = x >> 2, ch = c * 16 + (y & 3) * 4 + (x & 3);
    out[c * W * H + y * W + x] = last(ch, sx, sy) + input[c * w * hgt + sy * w + sx];
  }
  return out;
}

// ---- plain JavaScript

export function upscaleCPU(layers, input, w, hgt) {
  let x = input;
  for (const L of layers) {
    const out = new Float32Array(L.outC * w * hgt);
    for (let o = 0; o < L.outC; o++) {
      const plane = out.subarray(o * w * hgt, (o + 1) * w * hgt);
      plane.fill(L.b[o]);
      for (let c = 0; c < L.inC; c++) {
        const src = x.subarray(c * w * hgt, (c + 1) * w * hgt);
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
          const k = L.w[((o * L.inC + c) * 3 + dy) * 3 + dx];
          if (!k) continue;
          const y0 = Math.max(0, 1 - dy), y1 = Math.min(hgt, hgt + 1 - dy), x0 = Math.max(0, 1 - dx), x1 = Math.min(w, w + 1 - dx);
          for (let yy = y0; yy < y1; yy++) {
            const row = yy * w, srow = (yy + dy - 1) * w + dx - 1;
            for (let xx = x0; xx < x1; xx++) plane[row + xx] += k * src[srow + xx];
          }
        }
      }
      if (L.a) { const a = L.a[o]; for (let i = 0; i < plane.length; i++) if (plane[i] < 0) plane[i] *= a; }
    }
    x = out;
  }
  return shuffle((ch, sx, sy) => x[ch * w * hgt + sy * w + sx], input, w, hgt);
}

// ---- the graphics chip

const VS = `#version 300 es
in vec2 pos; void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

// One output group of four channels: for every input group and each of the 9 neighbours, a
// 4×4 block of weights. The weights for this group come in a uniform block (fast to read).
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray feat;
uniform int inGroups;
uniform ivec2 size;
uniform bool act;
layout(std140) uniform Weights { vec4 w[578]; };   // 16 groups × 9 taps × 4 rows, then bias, slope
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = w[576];
  for (int k = 0; k < inGroups; k++) {
    for (int t = 0; t < 9; t++) {
      ivec2 q = p + ivec2(t % 3 - 1, t / 3 - 1);
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      vec4 v = texelFetch(feat, ivec3(q, k), 0);
      int i = (k * 9 + t) * 4;
      s += vec4(dot(w[i], v), dot(w[i + 1], v), dot(w[i + 2], v), dot(w[i + 3], v));
    }
  }
  if (act) s = mix(w[577] * s, s, step(0.0, s));
  o = s;
}`;

export class GPUUpscaler {
  // Null when this browser or device can't do it (no WebGL2, or no float textures to draw into).
  static create(layers) {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { antialias: false, depth: false, powerPreference: "high-performance" });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
    try { return new GPUUpscaler(gl, layers); } catch (err) { console.warn(err); return null; }
  }

  constructor(gl, layers) {
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = (this.prog = gl.createProgram());
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, "Weights"), 0);
    this.loc = { feat: gl.getUniformLocation(prog, "feat"), inGroups: gl.getUniformLocation(prog, "inGroups"), size: gl.getUniformLocation(prog, "size"), act: gl.getUniformLocation(prog, "act") };
    gl.uniform1i(this.loc.feat, 0);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    // each layer's weights, one block per output group, spaced as the device requires
    const align = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
    this.stride = Math.ceil((578 * 16) / align) * align;
    this.layers = layers.map((L) => {
      const groupsOut = L.outC / 4, groupsIn = Math.ceil(L.inC / 4);
      const data = new Float32Array((this.stride / 4) * groupsOut);
      for (let g = 0; g < groupsOut; g++) {
        const base = (g * this.stride) / 4;
        for (let k = 0; k < groupsIn; k++) for (let t = 0; t < 9; t++) for (let r = 0; r < 4; r++) for (let j = 0; j < 4; j++) {
          const oc = g * 4 + r, ic = k * 4 + j;
          if (ic < L.inC) data[base + ((k * 9 + t) * 4 + r) * 4 + j] = L.w[((oc * L.inC + ic) * 3 + Math.floor(t / 3)) * 3 + (t % 3)];
        }
        for (let r = 0; r < 4; r++) {
          data[base + 576 * 4 + r] = L.b[g * 4 + r];
          if (L.a) data[base + 577 * 4 + r] = L.a[g * 4 + r];
        }
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
      gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STATIC_DRAW);
      return { buf, groupsIn, groupsOut, act: !!L.a };
    });
    this.fb = gl.createFramebuffer();
    this.size = [0, 0];
  }

  // two stacks of 16 four-channel layers, drawn into in turn
  textures(w, hgt) {
    const gl = this.gl;
    if (this.size[0] === w && this.size[1] === hgt) return;
    this.tex?.forEach((t) => gl.deleteTexture(t));
    this.tex = [0, 1].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, w, hgt, 16);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST);
      return t;
    });
    this.size = [w, hgt];
  }

  // One tile (planar, w×h), through every layer. Returns the 4× tile, planar.
  run(input, w, hgt) {
    const gl = this.gl;
    this.textures(w, hgt);
    // the picture goes in as the first layer of the first stack: r, g, b, nothing
    const rgba = new Float32Array(w * hgt * 4);
    for (let i = 0; i < w * hgt; i++) { rgba[i * 4] = input[i]; rgba[i * 4 + 1] = input[w * hgt + i]; rgba[i * 4 + 2] = input[2 * w * hgt + i]; }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex[0]);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, w, hgt, 1, gl.RGBA, gl.FLOAT, rgba);

    gl.useProgram(this.prog);
    gl.viewport(0, 0, w, hgt);
    gl.uniform2i(this.loc.size, w, hgt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    let from = 0;
    for (const L of this.layers) {
      const to = 1 - from;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex[from]);
      gl.uniform1i(this.loc.inGroups, L.groupsIn);
      gl.uniform1i(this.loc.act, L.act ? 1 : 0);
      for (let g = 0; g < L.groupsOut; g++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.tex[to], 0, g);
        gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, L.buf, g * this.stride, this.stride);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      from = to;
    }
    // the last layer's 12 groups (48 channels) back from the graphics chip
    const last = new Float32Array(48 * w * hgt), px = new Float32Array(w * hgt * 4);
    for (let g = 0; g < 12; g++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.tex[from], 0, g);
      gl.readPixels(0, 0, w, hgt, gl.RGBA, gl.FLOAT, px);
      for (let i = 0; i < w * hgt; i++) for (let r = 0; r < 4; r++) last[(g * 4 + r) * w * hgt + i] = px[i * 4 + r];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return shuffle((ch, sx, sy) => last[ch * w * hgt + sy * w + sx], input, w, hgt);
  }
}

// ---- whole pictures

// The picture's pixels as planar 0..1 floats.
export function toPlanar({ data, width: w, height: hgt }) {
  const n = w * hgt, out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { out[i] = data[i * 4] / 255; out[n + i] = data[i * 4 + 1] / 255; out[2 * n + i] = data[i * 4 + 2] / 255; }
  return out;
}

// Upscales an ImageData 4×, tile by tile with a margin, so any size fits in the graphics
// chip's memory and the seams can't show. `run(planar, w, h)` does one tile; `onTile(done, of)`
// reports progress and can be awaited (to let the page redraw).
export async function upscaleImage(img, run, { tile = 192, onTile } = {}) {
  const { width: w, height: hgt } = img;
  const src = toPlanar(img);
  const W = w * SCALE, H = hgt * SCALE;
  const out = new Uint8ClampedArray(W * H * 4);
  const cols = Math.ceil(w / tile), rows = Math.ceil(hgt / tile);
  let done = 0;
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(w, x0 + tile), y1 = Math.min(hgt, y0 + tile);
    const px0 = Math.max(0, x0 - PAD), py0 = Math.max(0, y0 - PAD), px1 = Math.min(w, x1 + PAD), py1 = Math.min(hgt, y1 + PAD);
    const tw = px1 - px0, th = py1 - py0, n = tw * th;
    const part = new Float32Array(3 * n);
    for (let c = 0; c < 3; c++) for (let y = 0; y < th; y++) part.set(src.subarray(c * w * hgt + (py0 + y) * w + px0, c * w * hgt + (py0 + y) * w + px1), c * n + y * tw);
    const big = run(part, tw, th);
    const TW = tw * SCALE, TH = th * SCALE;
    // keep only the tile's own area, not its margin
    for (let y = (y0 - py0) * SCALE; y < (y1 - py0) * SCALE; y++) for (let x = (x0 - px0) * SCALE; x < (x1 - px0) * SCALE; x++) {
      const o = ((py0 * SCALE + y) * W + px0 * SCALE + x) * 4, i = y * TW + x;
      out[o] = big[i] * 255 + 0.5; out[o + 1] = big[TH * TW + i] * 255 + 0.5; out[o + 2] = big[2 * TH * TW + i] * 255 + 0.5; out[o + 3] = 255;
    }
    await onTile?.(++done, cols * rows);
  }
  return { data: out, width: W, height: H };
}
