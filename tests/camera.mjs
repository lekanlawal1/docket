// Where the corners of a sheet of paper land in a photo taken by a real (pinhole) camera:
// the sheet tilted by `tiltX`/`tiltY`/`spin` degrees, `distance` sheet-heights away, photo W×H
// with the lens's focal length `focal` pixels. Fractions of the photo, TL TR BR BL.
export function cameraCorners({ aspect = 8.5 / 11, tiltX = 0, tiltY = 0, spin = 0, distance = 1.6, focal = 1500, W = 1500, H = 2000, shift = [0, 0] }) {
  const r = (d) => (d * Math.PI) / 180;
  const [a, b, c] = [r(tiltX), r(tiltY), r(spin)];
  const rot = ([x, y, z]) => {
    [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
    [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
    return [x, y, z];
  };
  return [[-aspect / 2, -0.5], [aspect / 2, -0.5], [aspect / 2, 0.5], [-aspect / 2, 0.5]].map(([x, y]) => {
    const [px, py, pz] = rot([x, y, 0]);
    const z = pz + distance;
    return [(W / 2 + (focal * (px + shift[0])) / z) / W, (H / 2 + (focal * (py + shift[1])) / z) / H];
  });
}
