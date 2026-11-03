// Every tool has its own address, like /docket/merge, so visit counts can tell the tools apart
// (analytics only sees the path, never the part after #). Older links like /docket/#/merge
// still work: they're turned into the new address as the page loads. Reloading a tool's address
// works too: GitHub Pages answers with 404.html, which hands it back to the app, and the offline
// worker serves the app for these addresses directly.

export const BASE = new URL("../", import.meta.url).pathname;     // "/docket/"
const ROUTE = /^[\w-]+$/;

// the tool in the address, if any, moving an old "#/tool" link onto the path first
export function current() {
  const old = location.hash.match(/^#\/([\w-]+)/);
  if (old) { history.replaceState(history.state, "", BASE + old[1] + location.search); return old[1]; }
  const rest = location.pathname.slice(BASE.length);
  return ROUTE.test(rest) ? rest : null;
}

let onRoute = () => {};
export const listen = (fn) => { onRoute = fn; };

// open a tool (or the home page with null), adding a step to the back button
export function go(id, anchor = "") {
  const to = BASE + (id || "") + location.search + anchor;
  if (to !== location.pathname + location.search + location.hash) history.pushState(null, "", to);
  dispatchEvent(new Event("docket:navigate"));
  onRoute();
}
addEventListener("popstate", () => { dispatchEvent(new Event("docket:navigate")); onRoute(); });

// links still written as "#/tool", "#tools" or "#" go through go() so the address stays a path
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[href^='#']");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute("href");
  const tool = href.match(/^#\/([\w-]+)/);
  if (tool) { e.preventDefault(); go(tool[1]); return; }
  if (current()) { e.preventDefault(); go(null, href.length > 1 ? href : ""); }   // "#tools" from a tool page: home, then scroll
});

// a modified click (new tab) on "#/tool" opens /docket/#/tool, which current() handles on load
