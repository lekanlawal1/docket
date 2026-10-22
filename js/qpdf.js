// qpdf, compiled to WebAssembly, for the one job pdf-lib can't do: encryption.
// It's 1.3 MB, so it's only fetched when the Password tool runs.

let loading;

function script() {
  loading ??= new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement("script"), { src: new URL("../vendor/qpdf/qpdf.js", import.meta.url).href });
    // the build is a classic script that defines a global `Module` factory
    el.onload = () => resolve(window.Module);
    el.onerror = () => { loading = null; reject(new Error("couldn't load the encryption engine. Check your connection and try again.")); };
    document.head.append(el);
  });
  return loading;
}

// Runs qpdf once on `bytes` with `args` (input and output paths are added) and returns the
// output bytes. A fresh instance each time keeps one failed run from affecting the next.
export async function qpdf(bytes, args) {
  return (await qpdfRun(bytes, args)).data;
}

// The same, also returning what qpdf said and its exit code (3 means it had to fix things).
export async function qpdfRun(bytes, args) {
  const create = await script();
  const messages = [];
  // this build ignores the usual print hooks and binds console.log/error when it's created,
  // so swap them for a moment to catch qpdf's messages for this run only
  const { log, error } = console;
  console.log = console.error = (t) => messages.push(String(t));
  let q;
  try {
    q = await create({ noInitialRun: true, locateFile: () => new URL("../vendor/qpdf/qpdf.wasm", import.meta.url).href });
  } finally {
    Object.assign(console, { log, error });
  }
  q.FS.writeFile("/in.pdf", bytes);
  const code = q.callMain([...args, "/in.pdf", "/out.pdf"]);
  // 0 is success and 3 is success with warnings (common with slightly damaged files)
  if (code !== 0 && code !== 3) {
    const text = messages.join(" ");
    const err = new Error(/invalid password/i.test(text) ? "wrong password" : text || `qpdf stopped (code ${code})`);
    err.badPassword = /invalid password/i.test(text);
    throw err;
  }
  return { data: q.FS.readFile("/out.pdf"), messages, code };
}

// Whether a file is encrypted, from its trailer. Cheap, and good enough to pick a starting tab.
export function looksEncrypted(bytes) {
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  if (/\/Encrypt\s/.test(tail)) return true;
  // cross-reference streams can put the trailer anywhere, so check the start too
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536))));
}
