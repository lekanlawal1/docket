import { onePdf, download, renamed, busy, status } from "../ui.js";
import { readBytes, openForView } from "../pdf.js";
import { qpdf, looksEncrypted } from "../qpdf.js";

export const intro = "Put a password on a PDF so only people you tell can open it. Or take the password off one you can already open.";

// a long random owner password, used when someone restricts printing or copying but doesn't
// set one themselves. Without it, the open password would also lift the restrictions.
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Password</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const locked = looksEncrypted(bytesIn);

    desk.innerHTML = `<h2>Password</h2>
      <div role="tablist" style="display: flex; gap: 8px; margin-bottom: 16px">
        <button type="button" class="pill" data-tab="lock" role="tab">Lock</button>
        <button type="button" class="pill ghost" data-tab="unlock" role="tab">Unlock</button>
      </div>
      <div data-for="lock">
        <label class="field">Password to open it<input type="password" name="pw" autocomplete="new-password"></label>
        <label class="field">Type it again<input type="password" name="pw2" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="show"> Show passwords</label>
        <label class="check"><input type="checkbox" name="noprint"> Don't allow printing</label>
        <label class="check"><input type="checkbox" name="nocopy"> Don't allow copying text</label>
        <label class="check"><input type="checkbox" name="noedit"> Don't allow changes</label>
        <p class="honest">Uses AES-256, the strongest PDF encryption. There's no way to recover a forgotten password, so keep it somewhere safe.
        The print, copy and change settings are requests that most PDF apps respect, not locks; anyone who can open the file could get around them.</p>
        <button type="button" class="pill go lock">Lock PDF</button>
      </div>
      <div data-for="unlock" hidden>
        <p class="unlock-note"></p>
        <label class="field">Its password<input type="password" name="current" autocomplete="current-password"></label>
        <button type="button" class="pill go unlock">Unlock PDF</button>
      </div>
      <p class="status" role="status"></p>${privateNote()}`;
    const out = desk.querySelector(".status");
    const q = (n) => desk.querySelector(`[name=${n}]`);

    const tabs = desk.querySelectorAll("[data-tab]");
    const pick = (tab) => {
      tabs.forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("ghost", !on); b.setAttribute("aria-selected", on); });
      desk.querySelectorAll("[data-for]").forEach((d) => (d.hidden = d.dataset.for !== tab));
      status(out, "");
    };
    tabs.forEach((b) => (b.onclick = () => pick(b.dataset.tab)));
    desk.querySelector(".unlock-note").textContent = locked
      ? "This file is locked. Enter its password to save a copy without one. If it opens without a password and only blocks printing or copying, leave this blank."
      : "This file doesn't seem to have a password. If it has print or copy restrictions, unlocking removes those.";
    pick(locked ? "unlock" : "lock");

    q("show").onchange = () => ["pw", "pw2"].forEach((n) => (q(n).type = q("show").checked ? "text" : "password"));

    const lockBtn = desk.querySelector(".lock"), unlockBtn = desk.querySelector(".unlock");

    lockBtn.addEventListener("click", () => busy(lockBtn, out, "Locking...", async () => {
      const pw = q("pw").value;
      if (!pw) return status(out, "Choose a password.", "bad");
      if (pw !== q("pw2").value) return status(out, "The two passwords don't match.", "bad");
      if (locked) return status(out, "This file already has a password. Unlock it first, then lock it with the new one.", "bad");
      const restrict = q("noprint").checked || q("nocopy").checked || q("noedit").checked;
      const args = ["--encrypt", `--user-password=${pw}`, `--owner-password=${restrict ? randomPassword() : pw}`, "--bits=256"];
      if (q("noprint").checked) args.push("--print=none");
      if (q("nocopy").checked) args.push("--extract=n");
      if (q("noedit").checked) args.push("--modify=none", "--annotate=n", "--form=n", "--assemble=n");
      args.push("--");
      const data = await qpdf(bytesIn, args);

      // make sure it really needs the password, and that the password really opens it
      await expectLocked(data);
      const check = await openForView(data, pw);
      await check.destroy();
      download(data, renamed(file, "-locked", "pdf"));
      status(out, "Done and checked: it won't open without the password, and the password opens it.", "good");
    }));

    unlockBtn.addEventListener("click", () => busy(unlockBtn, out, "Unlocking...", async () => {
      let data;
      try {
        data = await qpdf(bytesIn, [`--password=${q("current").value}`, "--decrypt"]);
      } catch (err) {
        if (err.badPassword) return status(out, q("current").value ? "That password didn't work." : "This file needs its password.", "bad");
        throw err;
      }
      const check = await openForView(data);
      await check.destroy();
      download(data, renamed(file, "-unlocked", "pdf"));
      status(out, "Done: saved a copy with no password.", "good");
    }));
  } });
}

async function expectLocked(data) {
  try {
    const doc = await openForView(data);
    await doc.destroy();
  } catch (err) {
    if (err.name === "PasswordException") return;
    throw err;
  }
  throw new Error("the locked file opened without a password, so it wasn't saved.");
}
