// Reading a PDF page as positioned, styled pieces of text (and its pictures), in the shape
// layout.js works with. Shared by PDF to Word and PDF to Excel.

import { pagePictures } from "./pictures.js";

// Every piece of text on a page with its position, size and style, for layout.js.
export async function readPage(view, n, pdfjs, { pictures: withPictures = true } = {}) {
  const { Util } = pdfjs;
  const page = await view.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  // drawing instructions load the fonts, and the fonts' real names say which are bold or italic
  const opList = await page.getOperatorList();
  const { items } = await page.getTextContent();
  const styleOf = (id) => {
    try {
      const f = page.commonObjs.get(id);
      const name = f?.name || "";
      return { bold: !!f?.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!f?.italic || /italic|oblique/i.test(name) };
    } catch { return { bold: false, italic: false }; }
  };

  const shown = [], own = [];
  let upright = 0;
  for (const it of items) {
    if (!it.str) continue;
    const style = styleOf(it.fontName);
    // as shown on screen, which is what matters for pages with /Rotate set
    const m = Util.transform(vp.transform, it.transform);
    if (Math.abs(m[1]) < Math.abs(m[0]) * 0.05 && m[0] > 0) upright++;
    shown.push({ str: it.str, x: m[4], y: m[5], size: Math.hypot(m[2], m[3]), width: it.width, ...style });
    // as drawn on the page itself, for pages whose text only runs straight before rotating
    const t = it.transform;
    own.push({ str: it.str, x: t[4], y: vp.viewBox[3] - t[5], size: Math.hypot(t[2], t[3]), width: it.width, ...style });
  }
  const useView = upright >= items.length / 2;
  const [, , w, hgt] = vp.viewBox;
  const pictures = withPictures ? await pagePictures(page, opList, pdfjs, useView ? vp.transform : [1, 0, 0, -1, 0, hgt]) : [];
  return { width: useView ? vp.width : w, height: useView ? vp.height : hgt, items: useView ? shown : own, pictures: pictures.map((p) => ({ ...p, page: n - 1 })) };
}
