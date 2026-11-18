// Load / manage the student's own booklet scans.
import { getBank } from "../data.js";
import { addBookletFile, listBooklets, removeBooklet, hasBooklet } from "../booklets.js";
import { esc, $, plural, toast, confirmDialog } from "../ui.js";

export function render(app) {
  const bank = getBank();
  const draw = () => {
    const loaded = listBooklets();
    app.innerHTML = `
      <div class="page-heading"><p class="eyebrow">Booklets</p><h1>Load your test booklets.</h1>
        <p>The authentic questions are shown from your own scanned copy of each released SAT booklet. Load a PDF once: it is stored only in this browser (IndexedDB) and is never uploaded anywhere. The site then crops each question straight from the scan, so you see it exactly as it was printed — diagrams, notation and all.</p></div>
      <label class="dropzone" id="drop">
        <strong>Drop booklet PDFs here</strong>
        <span>or click to choose files · ${loaded.length}/${bank.tests.length} loaded</span>
        <input type="file" id="file" accept="application/pdf,.pdf" multiple class="sr-only">
      </label>
      <div id="results" style="margin-top:14px"></div>
      <h2 class="section-title">Supported booklets</h2>
      <p class="section-sub">Files are recognised by their SHA-256 fingerprint, so the file name does not matter.</p>
      <div class="form-list">${bank.tests.map((t) => {
        const ok = hasBooklet(t.pdf.sha256);
        const meta = loaded.find((b) => b.sha256 === t.pdf.sha256);
        return `<div class="form-item ${ok ? "loaded" : ""}"><div class="form-code">${esc(t.formCode)}</div>
          <div><h3>SAT Form ${esc(t.formCode)} ${ok ? `<span class="badge ok">Loaded</span>` : `<span class="badge">Not loaded</span>`}</h3>
            <p class="muted small sans" style="margin:0 0 4px">${esc(t.title)} · ${t.pdf.pageCount}-page scan · ${t.questions.length} math questions${meta ? ` · from “${esc(meta.name)}”` : ""}</p>
            <p class="fingerprint">SHA-256 ${t.pdf.sha256}</p></div>
          <div class="actions">${ok ? `<button class="btn small danger" data-remove="${t.pdf.sha256}">Remove</button>` : ""}</div></div>`;
      }).join("")}</div>
      <div class="notice" style="margin-top:24px"><div><p><strong>Why do I need my own copy?</strong> The released tests are copyrighted by the College Board and ETS. This free site publishes only what it can legitimately publish — answer keys, topic tags, original explanations, score-conversion data and a map of where each question sits on each page — and leaves the printed pages in your hands.</p></div></div>`;
    bindDrop();
  };

  const handle = async (files) => {
    const out = [];
    for (const f of files) out.push(await addBookletFile(f, bank.catalog));
    const added = out.filter((r) => r.status === "added");
    draw();
    $("#results", app).innerHTML = out.map((r) => {
      if (r.status === "added") return `<div class="notice" style="margin-top:8px"><p><strong>${esc(r.name)}</strong> — loaded as Form ${esc(r.test.formCode)}.</p></div>`;
      if (r.status === "duplicate") return `<div class="notice" style="margin-top:8px"><p><strong>${esc(r.name)}</strong> — Form ${esc(r.test.formCode)} was already loaded.</p></div>`;
      if (r.status === "unknown") return `<div class="notice warn" style="margin-top:8px"><p><strong>${esc(r.name)}</strong> — not a recognised booklet scan. Its fingerprint (${r.sha256.slice(0, 16)}…) does not match any supported form.</p></div>`;
      return `<div class="notice bad" style="margin-top:8px"><p><strong>${esc(r.name)}</strong> — could not be stored: ${esc(r.error)}</p></div>`;
    }).join("");
    if (added.length) toast(`${plural(added.length, "booklet")} loaded · ${added.reduce((a, r) => a + r.test.questions, 0)} questions unlocked`);
  };

  function bindDrop() {
    const drop = $("#drop", app);
    const input = $("#file", app);
    input.onchange = () => handle([...input.files]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
    drop.ondragleave = () => drop.classList.remove("drag");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("drag"); handle([...e.dataTransfer.files].filter((f) => /pdf$/i.test(f.name) || f.type === "application/pdf")); };
  }

  draw();
  app.onclick = async (e) => {
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    const ok = await confirmDialog("Remove this booklet?", "The PDF will be deleted from this browser. Your progress is kept; load it again any time.", "Remove");
    if (!ok) return;
    await removeBooklet(rm.dataset.remove);
    draw();
  };
}
