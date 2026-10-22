// Line icons, drawn on a 24x24 grid as single paths so they share one stroke style.
// Most of them hint at what the tool does: the octopus inks things out, the chest locks.

export const ICONS = {
  knot: "M3 7c4 0 6 2 8 5s4 5 10 5M3 17c4 0 6-2 8-5s4-5 10-5M18 4l3 3-3 3M18 14l3 3-3 3",
  crab: "M7 14a5 3.5 0 1 0 10 0a5 3.5 0 1 0-10 0M7.5 12 4.5 8M4.5 8 3.5 5M4.5 8 7 7M16.5 12l3-4M19.5 8l1-3M19.5 8 17 7M8 17l-2 3M16 17l2 3M10 10.5V9M14 10.5V9",
  wheel: "M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 3v7M12 14v7M3 12h7M14 12h7M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6",
  hook: "M10.5 3.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 5v9a4 4 0 0 1-8 0v-2l-2 2",
  porthole: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M6.5 12a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0M8 13.5c1.3-1 2.7-1 4 0s2.7 1 4 0M12 2.5v1M12 20.5v1M2.5 12h1M20.5 12h1",
  shell: "M12 20 3.5 10.5A8.5 8.5 0 0 1 20.5 10.5ZM12 20 7.5 4.8M12 20V3.5M12 20l4.5-15.2M9 21.5h6",
  sailboat: "M3 17h18l-2.5 3.5h-13zM12 3v14M12.5 4l6.5 11h-6.5M11.5 6l-5 9h5",
  bottle: "M10 3h4M10.5 3v3.5L8 9.5V20a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9.5l-2.5-3V3M10.5 12h3M10.5 15h3M10.5 18h2",
  anchor: "M12 7a2 2 0 1 0 0-4a2 2 0 1 0 0 4M12 7v14M8.5 10h7M5 13c0 4 3 8 7 8s7-4 7-8M3 14l2-2 2 2M17 14l2-2 2 2",
  lifebuoy: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M6.3 6.3l2.9 2.9M14.8 14.8l2.9 2.9M17.7 6.3l-2.9 2.9M9.2 14.8l-2.9 2.9",
  compass: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 6.5l2 5.5-2 5.5-2-5.5zM12 2v1.5M12 20.5V22",
  wave: "M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0",
  octopus: "M6 11a6 6 0 0 1 12 0v2M6 11v2M6 13c-1 3-3 4-3 6M9 13c0 3-1 5-2 7M12 13v7M15 13c0 3 1 5 2 7M18 13c1 3 3 4 3 6M9.5 9.5h.01M14.5 9.5h.01",
  chest: "M3 10h18v10H3zM3 10c0-3.5 4-6 9-6s9 2.5 9 6M10.5 12h3v3h-3zM3 13.5h7.5M13.5 13.5H21",
  jelly: "M5 12a7 7 0 0 1 14 0zM7 12c0 3-1 5 0 8M10 12c0 3 1 5 0 8M14 12c0 3-1 5 0 8M17 12c0 3 1 5 0 8",
  puffer: "M5 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M17 12l4-3v6zM11 4V2.5M7 5.5 6 4.3M15 5.5l1-1.2M11 20v1.5M7 18.5 6 19.7M15 18.5l1 1.2M8.5 10.5h.01",
  spyglass: "M4 16.5l2.5 2.5M8 14l9-7 2 2.5-9 7zM17 7l1.5-1.2 2.5 3-1.5 1.2M6 15.2 8 14M10.5 16.5l-1.5 4.5M10.5 16.5l3 4.5",
  gull: "M2 13c3-3 6-3 10 1 4-4 7-4 10-1M8 7.5c1.5-1.5 3-1.5 4 .5 1-2 2.5-2 4-.5",
  lighthouse: "M9 21l1.5-12h3L15 21zM8 21h8M10 9V6.5h4V9M12 6.5V4.5M10.3 13.5h3.4M9.8 17.5h4.4M15 6l5-2M15 8l5 2M9 6 4 4M9 8l-5 2",
  net: "M4 4h16M4 4c0 9 4 16 8 16s8-7 8-16M8 4c0 9 2 15 4 16M16 4c0 9-2 15-4 16M5 9h14M7 14h10",
  binoculars: "M3 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M10 15.5h4M3.6 13.5 6.5 5h3l.5 8M20.4 13.5 17.5 5h-3l-.5 8M10 9h4",
  quill: "M20 3C13 4 8.5 9 6.5 16L5 21M20 3c.5 6-4.5 11.5-11.5 12.5M10 9.5l4.5 4.5M4 21h7",
  crate: "M3 8h18v12H3zM3 12h18M3 16h18M9 8v12M15 8v12M5.5 8 8 4.5h8L18.5 8",
  swab: "M12 3v10M8 13h8l1 2H7zM7.5 15 6 21M10 15l-.5 6M12 15v6M14 15l.5 6M16.5 15l1.5 6",
  pennants: "M3 3v18M3 4h7l-2 3 2 3H3M13 4h7l-2 3 2 3h-7zM3 13h7l-2 3 2 3H3M13 13h7l-2 3 2 3h-7z",
  cropmarks: "M7 3v14h14M3 7h14v14",
  pearl: "M3 5h18v14H3zM3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M15.5 9.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  marlinspike: "M14.5 3.5l6 6-2 2-6-6zM12.5 7.5 4 16l-1 5 5-1 8.5-8.5M6 15l3 3",
  lantern: "M9 4h6M10 4V2.5h4V4M8 6h8l1 3v9l-1 2H8l-1-2V9zM7 9h10M12 12v5M10.5 14.5h3",
  star: "M12 3l2.4 6 6.4.3-5 4 1.7 6.2L12 16l-5.5 3.5 1.7-6.2-5-4 6.4-.3z",
  fish: "M3 12c3-4 8-5 12-3l4-3v12l-4-3c-4 2-9 1-12-3zM7.5 11h.01",
  flag: "M5 21V3M5 4h13v9H5M5 8.5h13M11.5 4v9",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  // small ones for buttons
  up: "M5 14l7-7 7 7",
  down: "M5 10l7 7 7-7",
  left: "M14 5l-7 7 7 7",
  right: "M10 5l7 7-7 7",
  close: "M6 6l12 12M18 6 6 18",
  rotate: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
  plus: "M12 5v14M5 12h14",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
};

export function svg(name, { cls = "art", size, label } = {}) {
  const d = ICONS[name] || "";
  const dims = size ? ` width="${size}" height="${size}"` : "";
  const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 24 24" stroke-width="1.6"${dims}${a11y}><path d="${d}"/></svg>`;
}
