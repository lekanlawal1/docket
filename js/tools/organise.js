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
    main.append(h(`<p style="margin-top: 0; color: var(--muted); font-size: 14px">Drag a page to move it (on a phone, hold it first), or use the buttons under each one.</p>`), grid);
    await thumbnails(document.createElement("div"), view, (i, canvas) => { canvases[i] = canvas; return document.createElement("i"); });

    let dragFrom = null;
    function moveTo(from, to) {
      if (from === to) return;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      draw();
    }

    // Touch screens don't do drag and drop, and a finger drag means scroll. So: hold a page for
    // a moment to pick it up, then slide it onto another. A quick swipe still scrolls.
    let held = null;
    const clearMarks = () => grid.querySelectorAll(".drop-here").forEach((c) => c.classList.remove("drop-here"));
    grid.addEventListener("touchstart", (e) => {
      const card = e.target.closest(".page-card");
      if (!card || e.target.closest("button") || e.touches.length > 1) return;
      const t = e.touches[0];
      held = { card, from: Number(card.dataset.at), x: t.clientX, y: t.clientY, active: false };
      held.timer = setTimeout(() => {
        held.active = true;
        card.classList.add("dragging", "lifted");
        navigator.vibrate?.(15);
      }, 350);
    }, { passive: true });
    grid.addEventListener("touchmove", (e) => {
      if (!held) return;
      const t = e.touches[0], dx = t.clientX - held.x, dy = t.clientY - held.y;
      if (!held.active) {
        if (Math.hypot(dx, dy) > 10) { clearTimeout(held.timer); held = null; }   // it's a scroll
        return;
      }
      e.preventDefault();
      held.card.style.transform = `translate(${dx}px, ${dy}px)`;
      clearMarks();
      const under = document.elementFromPoint(t.clientX, t.clientY)?.closest(".page-card");
      if (under && under !== held.card) under.classList.add("drop-here");
    }, { passive: false });
    const letGo = (e) => {
      if (!held) return;
      clearTimeout(held.timer);
      if (held.active) {
        const t = e.changedTouches[0];
        const under = e.type === "touchend" && document.elementFromPoint(t.clientX, t.clientY)?.closest(".page-card");
        clearMarks();
        if (under && under !== held.card) moveTo(held.from, Number(under.dataset.at));
        else { held.card.style.transform = ""; held.card.classList.remove("dragging", "lifted"); }
      }
      held = null;
    };
    grid.addEventListener("touchend", letGo);
    grid.addEventListener("touchcancel", letGo);
    // a long press would otherwise open the browser's own menu
    grid.addEventListener("contextmenu", (e) => { if (held?.active) e.preventDefault(); });
    function draw() {
      grid.innerHTML = "";
      order.forEach((item, at) => {
        const card = h(`<div class="page-card" draggable="true" data-at="${at}"><span class="thumb"></span>
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
          if (dragFrom !== null) moveTo(dragFrom, at);
          dragFrom = null;
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
