import { h, esc, download, plural } from "../ui.js";
import { textSource } from "../textsource.js";
import { findItems } from "../text.js";

export const intro = "Every date, amount, percentage, email, link and phone number in a document, pulled into one list.";

const csvCell = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

export function mount({ main, desk, files, privateNote }) {
  let found = null, name = "";
  desk.innerHTML = `<h2>Found</h2><p class="summary-line">Nothing read yet.</p>
    <button type="button" class="pill go" disabled>Save as CSV</button>
    <p class="honest" style="margin-top: 14px">Matched by pattern, so an unusual date format can be missed, and a reference number can look like a phone number. Check anything you rely on.</p>${privateNote()}`;
  const line = desk.querySelector(".summary-line"), go = desk.querySelector(".go");
  const results = h(`<div class="results" hidden></div>`);

  function show(text, n) {
    found = findItems(text);
    name = n;
    const groups = Object.entries(found).filter(([, list]) => list.length);
    const total = groups.reduce((sum, [, list]) => sum + list.length, 0);
    line.textContent = total ? `${plural(total, "item")} in ${plural(groups.length, "group")}.` : "Nothing found.";
    go.disabled = !total;
    results.hidden = false;
    results.innerHTML = groups.length
      ? groups.map(([kind, list]) => `<section class="found-group"><h3>${esc(kind)} <small>${list.length}</small></h3>
          <ul>${list.map(({ value, count }) => `<li>${esc(value)}${count > 1 ? ` <small>×${count}</small>` : ""}</li>`).join("")}</ul></section>`).join("")
      : `<p>No dates, amounts, emails, links or phone numbers found.</p>`;
  }

  go.onclick = () => {
    const rows = [["Type", "Value", "Times found"]];
    for (const [kind, list] of Object.entries(found)) for (const { value, count } of list) rows.push([kind, value, String(count)]);
    download(rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n", `${name.replace(/\.[^.]+$/, "") || "text"}-found.csv`, "text/csv");
  };

  textSource(main, { files, onText: show });
  main.append(results);
}
