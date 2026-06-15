import fs from "node:fs";
import zlib from "node:zlib";

/** Count pages in a Tectonic PDF (handles FlateDecode object streams). */
export function pdfPageCount(pdfPath) {
  try {
    const data = fs.readFileSync(pdfPath);
    let pages = 0;
    const latin = data.toString("latin1");
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(latin)) !== null) {
      const start = m.index + m[0].length;
      const end = latin.indexOf("endstream", start);
      if (end === -1) continue;
      const chunk = data.subarray(start, end);
      try {
        const dec = zlib.inflateSync(chunk).toString("latin1");
        pages += (dec.match(/\/Type\s*\/Page(?![s])/g) || []).length;
      } catch { /* not a flate stream */ }
    }
    pages += (latin.match(/\/Type\s*\/Page(?![s])/g) || []).length;
    return pages > 0 ? pages : null;
  } catch {
    return null;
  }
}

export function assertPdfMagic(pdfPath) {
  const head = fs.readFileSync(pdfPath).subarray(0, 5).toString("ascii");
  if (!head.startsWith("%PDF-")) throw new Error("Output is not a valid PDF");
}
