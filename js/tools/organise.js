import { onePdf, h, download, renamed, plural, busy, status, thumbnails } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, lib } from "../pdf.js";

export const intro = "Drag pages into a new order, turn them, or take them out. Nothing changes until you save.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Your changes</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    // the working order: each entry is an original page and how far it's turned
    let order = [...Array(view.numPages).keys()].map((i) => ({ src: i, turn: 0 }));
    const canvases = [];

    desk.innerHTML = `<h2>Your changes</h2><p class="summary"></p>
      <button type="button" class="pill ghost reset" style="width: 100%; margin-bottom: 10px">Undo all changes</button>
      <button type="button" class="pill go" disabled>Save PDF</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    desk.querySelector(".reset").onclick = () => { order = [...Array(view.numPages).keys()].map((i) => ({ src: i, turn: 0 })); draw(); };

    const grid = h(`<div class="pages"></div>`);
    main.append(h(`<p style="margin-top: 0; color: var(--muted); font-size: 14px">Drag a page to move it, or use the buttons under each one.</p>`), grid);
    await thumbnails(document.createElement("div"), view, (i, canvas) => { canvases[i] = canvas; return document.createElement("i"); });

    let dragFrom = null;
    function draw() {
      grid.innerHTML = "";
      order.forEach((item, at) => {
        const card = h(`<div class="page-card" draggable="true"><span class="thumb"></span>
          <span class="label"><span>Page ${item.src + 1}</span><span>${at + 1} of ${order.length}</span></span>
          <span class="tools-row">
            <button type="button" class="icon-btn" aria-label="Move page ${item.src + 1} earlier" ${at === 0 ? "disabled" : ""}>${svg("left")}</button>
            <button type="button" class="icon-btn" aria-label="Turn page ${item.src + 1}">${svg("rotate")}</button>
            <button type="button" class="icon-btn" aria-label="Remove page ${item.src + 1}">${svg("close")}</button>
            <button type="button" class="icon-btn" aria-label="Move page ${item.src + 1} later" ${at === order.length - 1 ? "disabled" : ""}>${svg("right")}</button>
          </span></div>`);
        const img = canvases[item.src].cloneNode();
        img.getContext("2d").drawImage(canvases[item.src], 0, 0);
        img.style.transform = `rotate(${item.turn}deg) scale(${item.turn % 180 ? 0.77 : 1})`;
        card.querySelector(".thumb").append(img);
        const [left, turn, remove, right] = card.querySelectorAll("button");
        left.onclick = () => { [order[at - 1], order[at]] = [order[at], order[at - 1]]; draw(); };
        right.onclick = () => { [order[at + 1], order[at]] = [order[at], order[at + 1]]; draw(); };
        turn.onclick = () => { item.turn = (item.turn + 90) % 360; draw(); };
        remove.onclick = () => { order.splice(at, 1); draw(); };
        card.addEventListener("dragstart", () => { dragFrom = at; card.classList.add("dragging"); });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("dragover", (e) => e.preventDefault());
        card.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragFrom === null || dragFrom === at) return;
          const [moved] = order.splice(dragFrom, 1);
          order.splice(at, 0, moved);
          dragFrom = null;
          draw();
        });
        grid.append(card);
      });
      const turned = order.filter((x) => x.turn).length, removed = view.numPages - order.length;
      const moved = order.some((x, i) => x.src !== i) && removed === 0;
      desk.querySelector(".summary").textContent = [
        `${plural(order.length, "page")} kept`, removed && `${removed} removed`, turned && `${turned} turned`, moved && "order changed",
      ].filter(Boolean).join(", ") + ".";
      go.disabled = order.length === 0;
    }
    draw();

    go.addEventListener("click", () => busy(go, out, "Saving...", async () => {
      const { PDFDocument, degrees } = await lib();
      const src = await openForEdit(bytesIn);
      const doc = await PDFDocument.create();
      const copies = await doc.copyPages(src, order.map((x) => x.src));
      copies.forEach((page, i) => {
        page.setRotation(degrees((page.getRotation().angle + order[i].turn) % 360));
        doc.addPage(page);
      });
      download(await doc.save(), renamed(file, "-organised", "pdf"));
      status(out, `Done: ${plural(order.length, "page")} saved.`, "good");
    }));
    go.disabled = false;               // only once the pages are drawn and the button does something
  } });
}
