import { onePdf, h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, rasterize } from "../pdf.js";
import { inspect, clean, carryLinks } from "../clean.js";

export const intro = "A PDF can carry much more than its pages: the author's name, comments, attached files, scripts, hidden layers and earlier versions of itself. See what's in yours, and take it out before you send it.";

const LABELS = { Title: "Title", Author: "Author", Subject: "Subject", Keywords: "Keywords", Creator: "Made with", Producer: "Saved by", CreationDate: "Created", ModDate: "Last changed" };

// "D:20240312093000-05'00'" -> a date people can read
function readable(d) {
  const m = String(d).match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return d;
  const date = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0));
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Clean it</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    let found;
    try { found = await inspect(await openForEdit(bytesIn), bytesIn); }
    catch (err) { main.append(h(`<p class="status bad">${esc(err.message)}</p>`)); return; }
    const { details, xmp, comments, attachments, scripts, links, hiddenLayers, versions, appData } = found;
    const rows = Object.entries(details);

    // one section per kind of thing found, each with its own switch on the desk
    const shown = [];
    const section = (title, body) => shown.push(`<section class="found"><h3>${title}</h3>${body}</section>`);
    if (rows.length || xmp || appData) section("Details about the file", `${rows.length
      ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(LABELS[k] || k)}</dt><dd>${esc(/Date$/.test(k) ? readable(v) : v)}</dd>`).join("")}</dl>` : ""}
      ${xmp ? "<p>An XMP block, which can repeat these and add editing history.</p>" : ""}${appData ? "<p>Private data left by the app that made it.</p>" : ""}`);
    if (comments.length) section(plural(comments.length, "comment or mark", "comments and marks"), `<ul>${comments.slice(0, 8).map((c) => `<li>${c.text ? `“${esc(c.text.slice(0, 120))}”` : esc(c.type.toLowerCase())}</li>`).join("")}${comments.length > 8 ? `<li>and ${comments.length - 8} more</li>` : ""}</ul>`);
    if (attachments.length) section(plural(attachments.length, "attached file"), `<ul>${attachments.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`);
    if (scripts) section(plural(scripts, "script or automatic action", "scripts and automatic actions"), "<p>Code or actions that run when the file is opened or clicked, or that send things elsewhere.</p>");
    if (hiddenLayers.length) section(plural(hiddenLayers.length, "hidden layer"), `<p>${esc(hiddenLayers.join(", "))}: switched off, so they don't show, but everything on them is still in the file.</p>`);
    if (versions) section(plural(versions, "earlier saved version"), "<p>Saving by adding to a file keeps the old version inside it. Someone with the right tool can bring back what was there before.</p>");
    if (links) section(plural(links, "link to a website", "links to websites"), "<p>Kept unless you choose to remove them.</p>");
    main.append(h(`<div class="desk clean-found" style="background: var(--card); border: 1px solid var(--card-line)">
      <h2 style="font-size: 20px">What this file carries</h2>
      ${shown.length ? shown.join("") : "<p>Nothing beyond its pages. You can still save a fresh copy.</p>"}</div>`));

    const box = (key, label, on, show = true) => show ? `<label class="check"><input type="checkbox" name="${key}" ${on ? "checked" : ""}> ${label}</label>` : "";
    desk.innerHTML = `<h2>Clean it</h2>
      ${box("details", "Details about the file", true)}
      ${box("comments", "Comments and marks", true, comments.length)}
      ${box("attachments", "Attached files", true, attachments.length)}
      ${box("scripts", "Scripts and automatic actions", true, scripts)}
      ${box("pictures", "Hidden layers (turns pages into pictures)", true, hiddenLayers.length)}
      ${box("links", "Links to websites", false, links)}
      <p class="note">Earlier saved versions${versions ? "" : " (if any)"} and anything left unused are always removed: the file is written again from scratch.</p>
      <button type="button" class="pill go">Clean PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">Words on the pages themselves stay. To remove a name or number you can see, use <a href="#/redact">Redact</a>. To keep comments' look but stop them being edited, use <a href="#/flatten">Flatten</a>.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const on = (k) => !!desk.querySelector(`[name=${k}]`)?.checked;

    go.addEventListener("click", () => busy(go, out, "Cleaning...", async () => {
      const what = { details: on("details"), comments: on("comments"), attachments: on("attachments"), scripts: on("scripts"), links: on("links") };
      let doc = await openForEdit(bytesIn);
      await clean(doc, what);
      let data = await doc.save();
      if (on("pictures")) {
        // only what's showing gets drawn, so the hidden layers' contents are left behind
        const drawn = await rasterize(data, { scale: 2, quality: 0.88, onPage: (n, of) => status(out, `Drawing page ${n} of ${of}...`) });
        const kept = doc;
        doc = await openForEdit(drawn);
        await carryLinks(kept, doc);                  // pictures aren't clickable, so links are put back
        await clean(doc, what);                       // the rebuilt file gets its own details stamped in
        data = await doc.save();
      }
      // read it back the way it'll be opened, and check each thing asked for is gone
      const after = await inspect(await openForEdit(data), data);
      const left = [
        what.details && (Object.keys(after.details).length || after.xmp) && "file details",
        what.comments && after.comments.length && "comments",
        what.attachments && after.attachments.length && "attached files",
        what.scripts && after.scripts && "scripts",
        what.links && after.links && "links",
        on("pictures") && after.hiddenLayers.length && "hidden layers",
        after.versions && "earlier versions",
      ].filter(Boolean);
      if (left.length) throw new Error(`${left.join(", ")} survived cleaning, so nothing was downloaded.`);
      download(data, renamed(file, "-clean", "pdf"));
      status(out, "Done and checked: everything you chose is gone.", "good");
    }));
  } });
}
