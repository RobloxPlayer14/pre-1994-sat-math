// The student's own copies of released SAT booklets (scanned PDFs).
// Files are stored in this browser's IndexedDB and never leave the device.
// Questions are displayed by rendering the booklet page with PDF.js and
// cropping the regions listed in data/tests/<form>.json.

const DB_NAME = "sat94";
const DB_VERSION = 1;
const RENDER_SCALE = 2.1; // ≈ native resolution of 150-dpi scans of a 594-pt page
const PAGE_CACHE = 6;

let dbPromise = null;
let loaded = new Map(); // sha256 -> meta
let pdfjs = null;
const docs = new Map(); // sha256 -> Promise<PDFDocumentProxy>
const pages = new Map(); // `${sha}:${page}` -> Promise<HTMLCanvasElement>  (LRU)

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "sha256" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** Load the list of stored booklets (metadata only). Safe to call repeatedly. */
export async function initBooklets() {
  try {
    const all = await tx("meta", "readonly", (s) => s.getAll());
    loaded = new Map((all || []).map((m) => [m.sha256, m]));
  } catch (err) {
    console.warn("IndexedDB unavailable; booklets cannot be stored in this browser.", err);
    loaded = new Map();
  }
  return loaded;
}

export const hasBooklet = (sha) => loaded.has(sha);
export const listBooklets = () => [...loaded.values()];

export async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Store one PDF if it matches a known booklet.
 * @returns {{status:'added'|'duplicate'|'unknown'|'error', name, sha256?, test?}}
 */
export async function addBookletFile(file, catalog) {
  try {
    const buf = await file.arrayBuffer();
    const sha = await sha256Hex(buf);
    const test = catalog.tests.find((t) => t.sha256 === sha);
    if (!test) return { status: "unknown", name: file.name, sha256: sha };
    if (loaded.has(sha)) return { status: "duplicate", name: file.name, sha256: sha, test };
    const meta = { sha256: sha, testId: test.id, name: file.name, size: file.size, addedAt: Date.now() };
    await tx("files", "readwrite", (s) => s.put(buf, sha));
    await tx("meta", "readwrite", (s) => s.put(meta));
    loaded.set(sha, meta);
    try { await navigator.storage?.persist?.(); } catch {}
    return { status: "added", name: file.name, sha256: sha, test };
  } catch (err) {
    console.error(err);
    return { status: "error", name: file.name, error: String(err.message || err) };
  }
}

export async function removeBooklet(sha) {
  await tx("files", "readwrite", (s) => s.delete(sha));
  await tx("meta", "readwrite", (s) => s.delete(sha));
  loaded.delete(sha);
  docs.delete(sha);
  for (const k of [...pages.keys()]) if (k.startsWith(sha)) pages.delete(k);
}

async function lib() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

function getDoc(sha) {
  if (!docs.has(sha)) {
    const p = (async () => {
      const buf = await tx("files", "readonly", (s) => s.get(sha));
      if (!buf) throw new Error("Booklet not found in this browser.");
      const L = await lib();
      return L.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    })();
    p.catch(() => docs.delete(sha));
    docs.set(sha, p);
  }
  return docs.get(sha);
}

function getPage(sha, pageNo) {
  const key = `${sha}:${pageNo}`;
  if (pages.has(key)) {
    const p = pages.get(key);
    pages.delete(key);
    pages.set(key, p); // refresh LRU position
    return p;
  }
  const p = (async () => {
    const doc = await getDoc(sha);
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return canvas;
  })();
  p.catch(() => pages.delete(key));
  pages.set(key, p);
  while (pages.size > PAGE_CACHE) pages.delete(pages.keys().next().value);
  return p;
}

/**
 * Render one region [x0,y0,x1,y1] (page fractions) to a new canvas.
 * The canvas CSS width is proportional to the region width so text appears
 * at the same size for every question.
 */
export async function renderRegion(sha, pageNo, box, { baseWidth = 1180 } = {}) {
  const pageCanvas = await getPage(sha, pageNo);
  const [x0, y0, x1, y1] = box;
  const sx = Math.max(0, Math.floor(x0 * pageCanvas.width));
  const sy = Math.max(0, Math.floor(y0 * pageCanvas.height));
  const sw = Math.min(pageCanvas.width - sx, Math.ceil((x1 - x0) * pageCanvas.width));
  const sh = Math.min(pageCanvas.height - sy, Math.ceil((y1 - y0) * pageCanvas.height));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  c.getContext("2d", { alpha: false }).drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  c.className = "scan";
  c.style.width = `${Math.round((x1 - x0) * baseWidth)}px`;
  c.setAttribute("role", "img");
  return c;
}

/** Render a full page with optional highlight boxes. */
export async function renderPage(sha, pageNo, highlights = []) {
  const pageCanvas = await getPage(sha, pageNo);
  const c = document.createElement("canvas");
  c.width = pageCanvas.width;
  c.height = pageCanvas.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(pageCanvas, 0, 0);
  ctx.lineWidth = 5;
  for (const [x0, y0, x1, y1] of highlights) {
    ctx.strokeStyle = "rgba(23,126,137,.9)";
    ctx.fillStyle = "rgba(23,126,137,.08)";
    const r = [x0 * c.width - 6, y0 * c.height - 6, (x1 - x0) * c.width + 12, (y1 - y0) * c.height + 12];
    ctx.fillRect(...r);
    ctx.strokeRect(...r);
  }
  c.className = "scan scan-page";
  return c;
}

/** Warm the page cache for upcoming questions (fire and forget). */
export function prefetch(sha, pageNos) {
  if (!hasBooklet(sha)) return;
  for (const p of pageNos) getPage(sha, p).catch(() => {});
}
