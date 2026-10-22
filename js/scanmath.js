// The maths behind Scan: finding a sheet of paper in a photo, straightening it, and making it
// look scanned. Images here are plain { data, width, height } objects (RGBA, like ImageData), so
// the tests run it in Node.

// ---- finding the page

// Grey levels, averaged over a small square, so print and texture don't break up the page.
function smoothGrey({ data, width: w, height: h }, radius = 2) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // box blur, rows then columns
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -radius; k <= radius; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += g[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -radius; k <= radius; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    g[y * w + x] = s / n;
  }
  return g;
}

// The grey level that best splits the picture into two groups (Otsu's method).
export function otsu(grey) {
  const hist = new Float64Array(256);
  for (const v of grey) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = grey.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

// Corners of the sheet of paper, as [topLeft, topRight, bottomRight, bottomLeft] in fractions of
// the picture, or null when there's no clear sheet (the photo is all page, or all background).
// Paper is usually the largest bright area; its corners are the points furthest out diagonally.
export function findPage(img) {
  const { width: w, height: h } = img;
  const grey = smoothGrey(img);
  const t = otsu(grey);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bright[i] = grey[i] > t ? 1 : 0;

  // largest connected bright area
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let best = { size: 0, id: 0 }, id = 0;
  for (let start = 0; start < w * h; start++) {
    if (!bright[start] || label[start]) continue;
    id++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = start; label[start] = id;
    while (head < tail) {
      const p = queue[head++]; size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && bright[p - 1] && !label[p - 1]) { label[p - 1] = id; queue[tail++] = p - 1; }
      if (x < w - 1 && bright[p + 1] && !label[p + 1]) { label[p + 1] = id; queue[tail++] = p + 1; }
      if (y > 0 && bright[p - w] && !label[p - w]) { label[p - w] = id; queue[tail++] = p - w; }
      if (y < h - 1 && bright[p + w] && !label[p + w]) { label[p + w] = id; queue[tail++] = p + w; }
    }
    if (size > best.size) best = { size, id };
  }
  const share = best.size / (w * h);
  if (share < 0.12 || share > 0.97) return null;
  // Paper stands out from what's around it. A bright area that runs along much of the photo's
  // edge is the page filling the frame, and one barely brighter than the rest is wood grain or
  // lighting, not paper.
  let border = 0, inSum = 0, outSum = 0;
  for (let x = 0; x < w; x++) border += (label[x] === best.id) + (label[(h - 1) * w + x] === best.id);
  for (let y = 1; y < h - 1; y++) border += (label[y * w] === best.id) + (label[y * w + w - 1] === best.id);
  if (border / (2 * (w + h) - 4) > 0.35) return null;
  for (let i = 0; i < w * h; i++) if (label[i] === best.id) inSum += grey[i]; else outSum += grey[i];
  if (inSum / best.size - outSum / (w * h - best.size) < 50) return null;

  // the four extreme points along the diagonals
  let tl = [0, 0], tr = [0, 0], br = [0, 0], bl = [0, 0];
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (let p = 0; p < w * h; p++) {
    if (label[p] !== best.id) continue;
    const x = p % w, y = (p - x) / w, s = x + y, d = x - y;
    if (s < minS) { minS = s; tl = [x, y]; }
    if (s > maxS) { maxS = s; br = [x, y]; }
    if (d > maxD) { maxD = d; tr = [x, y]; }
    if (d < minD) { minD = d; bl = [x, y]; }
  }
  const quad = [tl, tr, br, bl].map(([x, y]) => [(x + 0.5) / w, (y + 0.5) / h]);
  // a sliver or a bow-tie isn't a page
  if (polygonArea(quad) < 0.1 || !convex(quad)) return null;
  return quad;
}

export function polygonArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

export function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross === 0) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

// ---- straightening

// The 3×3 projective transform taking four points `from` onto four points `to`.
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(8);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return [...x, 1];
}

export const project = (H, x, y) => {
  const z = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
};

const dist = ([ax, ay], [bx, by]) => Math.hypot(ax - bx, ay - by);

// The real width ÷ height of a rectangle photographed as `quadPx`, in a photo `w`×`h` taken
// with an ordinary camera (centred lens, square pixels). Seen at an angle the far edge looks
// shorter, so comparing edge lengths gets it wrong; this works back through the camera instead
// (Zhang and He, "Whiteboard scanning and image enhancement", 2007). Null when it can't tell.
export function trueAspect(quadPx, w, h) {
  const [tl, tr, br, bl] = quadPx.map(([x, y]) => [x, y, 1]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m14 = cross(tl, br);
  const k2 = dot(m14, bl) / dot(cross(tr, br), bl), k3 = dot(m14, tr) / dot(cross(bl, br), tr);
  const n2 = tr.map((v, i) => k2 * v - tl[i]), n3 = bl.map((v, i) => k3 * v - tl[i]);
  const u0 = w / 2, v0 = h / 2, long = Math.max(w, h);
  // The focal length, from where the page's edges meet. When a pair of edges is (nearly)
  // parallel in the photo there's nothing to measure it from, so a typical phone's is used:
  // its main camera sees about as far as 0.75 of the photo's longer side.
  const flat = (n) => Math.abs(n[2]) * long / Math.hypot(n[0], n[1]) < 0.05;
  let f = 0.75 * long;
  if (!flat(n2) && !flat(n3)) {
    const f2 = -((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0)
      + (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)) / (n2[2] * n3[2]);
    // a focal length no camera has means the corners are off, so don't trust the answer
    if (!(f2 > (0.3 * long) ** 2 && f2 < (6 * long) ** 2)) return null;
    f = Math.sqrt(f2);
  }
  const len = (n) => Math.hypot((n[0] - u0 * n[2]) / f, (n[1] - v0 * n[2]) / f, n[2]);
  return len(n2) / len(n3);
}

// How big the straightened page should be, from the corners in pixels: as many pixels as the
// photo has across the page, in the page's true shape when the photo's size is known, kept
// under `maxSide`.
export function outputSize(quadPx, maxSide = 2400, photo = null) {
  const [tl, tr, br, bl] = quadPx;
  let w = Math.max(dist(tl, tr), dist(bl, br)), h = Math.max(dist(tl, bl), dist(tr, br));
  const aspect = photo && trueAspect(quadPx, photo[0], photo[1]);
  // keep the bigger side, and set the other from the true shape (within reason)
  if (aspect && aspect > 0.2 && aspect < 5) {
    // close to a usual paper size (Letter, A4, Legal, either way up) is taken to be that size
    const paper = [8.5 / 11, 210 / 297, 8.5 / 14].flatMap((r) => [r, 1 / r]).find((r) => Math.abs(aspect / r - 1) < 0.03);
    const r = paper || aspect;
    if (w / h > r) h = w / r; else w = h * r;
  }
  const k = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// The sheet inside `quadPx` (corners in pixels of `src`), flattened onto a w×h rectangle.
export function warp(src, quadPx, w, h) {
  const H = homography([[0, 0], [w, 0], [w, h], [0, h]], quadPx);
  const out = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  const { data: s, width: sw, height: sh } = src, d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let [u, v] = project(H, x + 0.5, y + 0.5);
      u -= 0.5; v -= 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(u))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(v)));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = s[(y0 * sw + x0) * 4 + c], b = s[(y0 * sw + x1) * 4 + c], e = s[(y1 * sw + x0) * 4 + c], f = s[(y1 * sw + x1) * 4 + c];
        d[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy;
      }
      d[o + 3] = 255;
    }
  }
  return out;
}

// ---- making it look scanned

// Grey, with the paper pushed to white and the ink to black.
export function clean(img) {
  const { data, width: w, height: h } = img, n = w * h;
  const grey = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; grey[i] = g; hist[grey[i]]++; }
  const at = (share) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * share) return v; } return 255; };
  // the darkest 1% is ink; a little below the middle of the paper tone is where white starts
  const lo = at(0.01), hi = Math.max(lo + 30, at(0.5) - 12);
  const out = { data: new Uint8ClampedArray(n * 4), width: w, height: h };
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, ((grey[i] - lo) / (hi - lo)) * 255));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
  }
  return out;
}

// Pure black and white, judging each pixel against its own neighbourhood, so shadows across
// the page don't swallow the text.
export function blackAndWhite(img) {
  const { data, width: w, height: h } = img;
  const grey = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // summed-area table, so each neighbourhood average is four lookups
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += grey[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 40));
  const out = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const mean = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const v = grey[y * w + x] < mean - 12 ? 0 : 255;
    const o = (y * w + x) * 4;
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
  }
  return out;
}

// Colour kept, but each channel stretched so the paper reads white rather than yellow or blue.
export function colour(img) {
  const { data, width: w, height: h } = img, n = w * h;
  const out = { data: new Uint8ClampedArray(n * 4), width: w, height: h };
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[data[i * 4 + c]]++;
    const at = (share) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * share) return v; } return 255; };
    const lo = at(0.01), hi = Math.max(lo + 30, at(0.6));
    for (let i = 0; i < n; i++) out.data[i * 4 + c] = ((data[i * 4 + c] - lo) / (hi - lo)) * 255;
  }
  for (let i = 0; i < n; i++) out.data[i * 4 + 3] = 255;
  return out;
}
