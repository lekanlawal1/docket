# Docket

PDF and document tools that run entirely in your browser. Merge, split, sign, redact, compress, convert and more, without uploading anything.

**Live:** https://lekanlawal1.github.io/docket/

## Why

Most free PDF sites upload your file to their server to do something your own computer could do in a second. That's fine for a menu. It's not fine for a lease, a bank statement or a signed contract. Docket does the work on your device, so there's nothing to upload, no account, and no file-size limit beyond what your browser can hold.

## What's in it

| Pier | Tools |
| --- | --- |
| Organise | Merge, Split, Organise pages, Extract pages |
| Convert | PDF to JPG, Images to PDF, PDF to text, PDF to Word *(soon)* |
| Edit & sign | Sign, Fill a form, Page numbers, Watermark |
| Protect | Redact, Remove metadata, Password |
| Shrink | Compress PDF, Grayscale |
| Read | Quick summary, Find dates & amounts, Make searchable *(soon)* |
| Images & extras | Resize image, Compress image, QR code, Printable paper |

## Things worth knowing

- **Redaction is real.** Pages with boxes are redrawn as images with the boxes burned in, so the text underneath is gone, not hidden under a rectangle. The result is then read back, and if any redacted text can still be found, nothing is saved.
- **Some tools turn pages into images.** Redact (only the pages you mark), Grayscale and the stronger Compress levels do this. Text on those pages can't be selected afterwards, and each tool says so before you run it.
- **Compress won't hand you a bigger file.** If the result isn't smaller, it tells you instead of downloading it.
- **The summary doesn't use AI.** It picks the sentences that best represent the document from the document itself, so it can't invent anything. It's a quick way in, not a replacement for reading.
- **Passwords use AES-256,** and the locked file is opened twice before you get it: once without the password (it must refuse) and once with it (it must open). Print and copy restrictions are honoured by most PDF apps but aren't real locks, and the page says so.
- **Signatures are pictures of a signature,** like signing a printout. They aren't certificate-based digital signatures.

## Running it locally

There's no build step. Serve the folder with any static server:

```sh
npx serve .
# or
python3 -m http.server
```

It has to be served over HTTP (not opened as a file) because it uses ES modules.

## Tests

```sh
npm install
npm test            # unit tests: page ranges, zip writer, summary, item finder, QR payloads
npm run test:e2e    # drives every tool in Chromium with generated PDFs and checks the output
```

The end-to-end test builds its own test PDFs (`tests/fixtures.mjs`), so there are no binary fixtures in the repo.

## How it's built

Plain HTML, CSS and JavaScript modules. No framework.

- [pdf-lib](https://pdf-lib.js.org/) edits and creates PDFs.
- [PDF.js](https://mozilla.github.io/pdf.js/) draws pages and reads their text.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) makes QR codes.
- [qpdf](https://github.com/qpdf/qpdf), compiled to WebAssembly by [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm), adds and removes passwords. It's only downloaded when the Password tool is used.

All of them are vendored in `vendor/`, with their licences, so the site works offline once loaded and doesn't depend on a CDN.

```
index.html
css/docket.css       the whole theme, day and night
js/main.js           routing, the home page, the water and the boat
js/tools.js          the list of piers and tools
js/tools/*.js        one module per tool: exports `intro` and `mount()`
js/pdf.js            loading, drawing and rasterising PDFs
js/ui.js             small DOM helpers shared by the tools
js/ranges.js, zip.js, text.js   pure logic, unit tested in Node
```

## Credits

Built by [Lekan Lawal](https://lekanlawal1.github.io/portfolio-site/) with help from Claude (Anthropic) as a coding assistant.

## Licence

MIT. See [LICENSE](LICENSE).
