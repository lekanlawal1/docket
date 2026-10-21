import { h, esc, download, plural, status } from "../ui.js";
import { textSource } from "../textsource.js";
import { summarize } from "../text.js";

export const intro = "The few sentences that carry most of a document, picked from its own words. Nothing is rewritten, so nothing can be made up.";

export function mount({ main, desk, files, privateNote }) {
  let text = "", name = "";
  desk.innerHTML = `<h2>Summary</h2>
    <label class="field">How many sentences<select name="count"><option>3</option><option selected>5</option><option>8</option><option>12</option></select></label>
    <p class="stats" style="font-size: 14px"></p>
    <p class="honest">This picks the sentences that use the document's most common words. It's a fast way in, not a substitute for reading the parts that matter to you.</p>
    <p class="status" role="status"></p>${privateNote()}`;
  const stats = desk.querySelector(".stats"), out = desk.querySelector(".status");
  const results = h(`<div class="results" hidden></div>`);

  function run() {
    if (!text.trim()) return;
    const count = +desk.querySelector("[name=count]").value;
    const { picked, total } = summarize(text, count);
    const wordCount = (text.match(/\S+/g) || []).length;
    stats.textContent = `${wordCount.toLocaleString()} words, about ${Math.max(1, Math.round(wordCount / 230))} min to read. ${plural(total, "sentence")}.`;
    results.hidden = false;
    if (!picked.length) {
      results.innerHTML = `<p>There aren't enough full sentences here to summarise. Lists and tables don't summarise well.</p>`;
      return;
    }
    results.innerHTML = `<h2 style="font-size: 20px">${total <= count ? "The whole thing is short, so here it is" : `The ${plural(picked.length, "key sentence")}`}</h2>
      <ol class="out-text">${picked.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="row" style="display: flex; gap: 10px; flex-wrap: wrap">
        <button type="button" class="pill copy">Copy</button>
        <button type="button" class="pill ghost save">Save as .txt</button>
      </div>`;
    const plain = picked.map((s) => "- " + s).join("\n");
    results.querySelector(".copy").onclick = async () => {
      try { await navigator.clipboard.writeText(plain); status(out, "Copied.", "good"); }
      catch { status(out, "Your browser blocked copying. Select the text instead.", "bad"); }
    };
    results.querySelector(".save").onclick = () =>
      download(plain + "\n", `${name.replace(/\.[^.]+$/, "") || "text"}-summary.txt`, "text/plain");
  }

  textSource(main, { files, onText: (t, n) => { text = t; name = n; run(); } });
  main.append(results);
  desk.querySelector("[name=count]").addEventListener("change", run);
}
