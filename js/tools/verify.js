import { onePdf, h, esc, status } from "../ui.js";
import { readBytes, openForView, pageTexts } from "../pdf.js";
import { sha256, grouped, cleanHex, readCertificate } from "../fingerprint.js";

export const intro = "Check a PDF is exactly the file you expect. Docket works out the file's fingerprint, a code that changes if anything in the file changes, and compares it with one you have. Files signed in Docket also carry a certificate, which this reads back.";

const verdict = (el, want, have, whatMatches) => {
  if (!want) return status(el, "");
  if (want.length !== 64) return status(el, `A SHA-256 fingerprint has 64 characters; this one has ${want.length}. Check it was copied whole.`, "bad");
  return want === have
    ? status(el, `Match: ${whatMatches}`, "good")
    : status(el, "Different: this isn't the file that fingerprint came from. A single changed character gives a completely different fingerprint.", "bad");
};

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Check a file</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytes = await readBytes(file);
    const fp = await sha256(bytes);
    let cert = null;
    try {
      const doc = await openForView(bytes.slice ? bytes.slice(0) : bytes);
      const texts = await pageTexts(doc);
      cert = readCertificate(texts.at(-1));
    } catch { /* not readable as a PDF: the fingerprint still stands */ }

    main.append(h(`<section class="verify-fp" style="background: var(--card); border: 1px solid var(--card-line); border-radius: 18px; padding: 18px 20px; margin-top: 14px">
      <p style="margin: 0 0 6px; font-weight: 600">Fingerprint of ${esc(file.name)} (SHA-256)</p>
      <code class="fp-code" style="font-size: 14px">${grouped(fp)}</code>
    </section>`));

    desk.innerHTML = `<h2>Check a file</h2>
      <label class="field">Fingerprint to compare with<textarea name="want" rows="3" spellcheck="false" placeholder="Paste a fingerprint, or load the text file Sign saved"></textarea></label>
      <label class="field">Or load a fingerprint file<input type="file" name="want-file" accept=".txt,text/plain"></label>
      <p class="status" role="status" data-out="file"></p>
      ${cert ? `<h3 style="margin: 22px 0 6px; font-size: 16px">Signing certificate found</h3>
        <dl class="facts">
          ${[["Document", cert.document], ["Signed by", cert.signer], ["Signed on", cert.signedOn], ["Placed", cert.placed]]
            .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}
        </dl>
        <p style="font-size: 14px">It records the original document's fingerprint. Load the original to check it's the one that was signed.</p>
        <label class="field">The original document<input type="file" name="original" accept=".pdf,application/pdf"></label>
        <p class="status" role="status" data-out="original"></p>` : ""}
      <p class="honest" style="margin-top: 14px">A matching fingerprint shows the file is unchanged. It doesn't show who made it: a Docket certificate is a record made in the signer's browser, not a certificate-based digital signature.</p>${privateNote()}`;

    const want = desk.querySelector("[name=want]"), out = desk.querySelector("[data-out=file]");
    const check = () => verify(cleanHex(want.value));
    // a pasted line may carry a label ("Fingerprint (SHA-256): ..."); the "256" in it isn't part of the code
    const verify = (hex) => verdict(out, hex.length > 64 ? hex.slice(-64) : hex, fp, `${file.name} is exactly the file that fingerprint came from.`);
    want.addEventListener("input", check);
    desk.querySelector("[name=want-file]").addEventListener("change", async (e) => {
      const text = await e.target.files[0]?.text();
      if (!text) return;
      const line = text.split("\n").find((l) => /fingerprint/i.test(l)) || text;
      want.value = grouped(cleanHex(line.slice(line.indexOf(":") + 1)).slice(0, 64));
      check();
    });
    desk.querySelector("[name=original]")?.addEventListener("change", async (e) => {
      const orig = e.target.files[0];
      if (!orig) return;
      verdict(desk.querySelector("[data-out=original]"), cert.original, await sha256(await readBytes(orig)),
        `${orig.name} is exactly the document that was signed.`);
    });
  } });
}
