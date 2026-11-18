import { escapeHtml, renderRich, renderInline } from "./format.js";
import { hasBooklet, renderRegion, renderPage } from "./booklets.js";
import { getBank } from "./data.js";

export const esc = escapeHtml;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function pct(x, digits = 0) {
  return x == null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(digits)}%`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
export function fmtDuration(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}
export function fmtDate(t) {
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
export function dots(n, max = 5) {
  return `<span class="dots" title="Difficulty ${n} of ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
}

export function originBadge(q) {
  return q.origin === "authentic"
    ? `<span class="badge authentic" title="From a released pre-1994 SAT">Authentic SAT</span>`
    : `<span class="badge original" title="Written for this site in the pre-1994 style. Not an SAT question.">Original practice</span>`;
}

export function topicBadges(q) {
  const bank = getBank();
  return (q.topics || []).map((t) => `<span class="badge">${esc(bank.topicNames[t] || t)}</span>`).join("");
}

export function formatName(type) {
  return getBank().topics.formats[type]?.short || type;
}

/** Can this question be shown right now? */
export function isAvailable(q) {
  return q.origin !== "authentic" || hasBooklet(q.sha256);
}

/**
 * Render the body of a question into `el`.
 * Authentic: crops of the student's booklet scan. Original: text + figure.
 */
export async function renderQuestionBody(q, el, { showChoicesText = true } = {}) {
  if (q.origin === "authentic") {
    if (!hasBooklet(q.sha256)) {
      const test = getBank().testById.get(q.testId);
      el.innerHTML = `<div class="locked"><strong>Booklet needed for this question</strong>
        This is question ${q.n} of Section ${q.sectionNumber} on SAT Form ${esc(test.formCode)} (booklet page ${q.regions[0].page}).
        The site does not publish the College Board's test pages; load your own copy of this booklet once and every question from it will appear here.
        <div class="row"><a class="btn primary small" href="#/booklets">Load a booklet</a></div></div>`;
      return;
    }
    el.innerHTML = `<div class="scan-wrap" aria-label="${esc(q.label)}"><div class="scan-placeholder">Loading scan…</div></div>`;
    const wrap = el.firstElementChild;
    try {
      const parts = [];
      if (q.group) {
        const g = getBank().groups.get(q.group);
        if (g) {
          for (const r of g.regions) parts.push(await renderRegion(q.sha256, r.page, r.box));
          parts.push(document.createElement("hr"));
        }
      }
      for (const r of q.regions) parts.push(await renderRegion(q.sha256, r.page, r.box));
      wrap.replaceChildren(...parts);
      for (const c of wrap.querySelectorAll("canvas")) c.setAttribute("aria-label", `Scanned question: ${q.label}`);
    } catch (err) {
      console.error(err);
      wrap.innerHTML = `<div class="scan-placeholder">Could not render this page (${esc(err.message || err)}).</div>`;
    }
    return;
  }
  // original
  if (q.qc) {
    el.innerHTML = `<div class="qc-box">
      ${q.qc.info ? `<div class="qc-info">${renderInline(q.qc.info)}</div>` : ""}
      <div class="qc-cols"><div><span class="qc-head">Column A</span><div class="qc-q">${renderInline(q.qc.a)}</div></div>
      <div><span class="qc-head">Column B</span><div class="qc-q">${renderInline(q.qc.b)}</div></div></div></div>`;
    return;
  }
  el.innerHTML = `${q.figure ? `<div class="figure">${q.figure}</div>` : ""}<div class="stem">${renderRich(q.stem)}</div>`;
}

/** Answer controls. Returns HTML; buttons carry data-choice. */
export function answerControls(q, { selected = null, reveal = false, disabled = false } = {}) {
  const bank = getBank();
  const letters = bank.topics.formats[q.type].choices;
  const cls = (L) => {
    const c = [];
    if (selected === L) c.push("selected");
    if (reveal && L === q.answer) c.push("correct");
    if (reveal && selected === L && L !== q.answer) c.push("incorrect");
    return c.join(" ");
  };
  const dis = disabled || reveal ? "disabled" : "";
  if (q.origin === "original" && q.type === "mc5") {
    return `<div class="choices" role="group" aria-label="Answer choices">${letters
      .map((L, i) => `<button type="button" class="choice ${cls(L)}" data-choice="${L}" ${dis}><span class="bubble">${L}</span><span class="ctext">${renderInline(q.choices[i])}</span></button>`)
      .join("")}</div>`;
  }
  if (q.type === "qc4") {
    return `<div class="answer-sheet"><div class="sheet-label"><span>Quantitative comparison</span><span>Answer sheet</span></div>
      <div class="sheet-qc" role="group" aria-label="Answer choices">${letters
        .map((L) => `<button type="button" class="sheet-btn ${cls(L)}" data-choice="${L}" ${dis}><span class="bubble">${L}</span>${esc(bank.topics.qcMeanings[L])}</button>`)
        .join("")}</div></div>`;
  }
  return `<div class="answer-sheet"><div class="sheet-label"><span>Mark your answer</span><span>Answer sheet</span></div>
    <div class="sheet-row" role="group" aria-label="Answer choices">${letters
      .map((L) => `<button type="button" class="sheet-btn ${cls(L)}" data-choice="${L}" ${dis} aria-label="Choice ${L}"><span class="bubble">${L}</span></button>`)
      .join("")}</div></div>`;
}

export function explanationBlock(q, { chosen = null } = {}) {
  const ok = chosen ? chosen === q.answer : null;
  const verdict = chosen == null ? `Answer: ${q.answer}` : ok ? "Correct." : `Not quite — the answer is ${q.answer}.`;
  const prov = q.origin === "authentic"
    ? `Answer from the official College Board answer key printed with Form ${esc(getBank().testById.get(q.testId).formCode)}${q.flags?.includes("answer-check") ? " · <strong>flagged for verification</strong>" : ""}. Explanation written for this site.`
    : `Original question written for this site in the style of the pre-1994 SAT — not an actual SAT question.`;
  return `<div class="feedback ${ok === null ? "" : ok ? "is-correct" : "is-incorrect"}">
    <p class="verdict">${esc(verdict)}</p>
    <div class="explanation">${q.explanation ? renderRich(q.explanation) : `<p class="muted">An explanation for this question has not been written yet.</p>`}</div>
    <div class="provenance">${prov}</div></div>`;
}

/* ---------- charts (SVG strings) ---------- */
export function barRows(rows) {
  if (!rows.length) return `<p class="muted small sans">No data yet.</p>`;
  return `<div class="bars">${rows
    .map((r) => {
      const v = r.value == null ? 0 : Math.max(0, Math.min(1, r.value));
      const cls = r.value == null ? "" : r.value < 0.5 ? "weak" : r.value >= 0.8 ? "good" : "";
      return `<div class="bar-row"><span class="name" title="${esc(r.name)}">${r.href ? `<a href="${r.href}">${esc(r.name)}</a>` : esc(r.name)}</span>
        <span class="track"><span class="fill ${cls}" style="width:${(v * 100).toFixed(1)}%"></span></span>
        <span class="val">${r.label ?? pct(r.value)}</span></div>`;
    })
    .join("")}</div>`;
}

export function lineChart(points, { height = 180, yMin = 0, yMax = 1, yFmt = (v) => pct(v), second = null } = {}) {
  if (points.length < 2) return `<p class="muted small sans">Complete at least two sessions to see a trend.</p>`;
  const W = 640, H = height, L = 40, R = 10, T = 10, B = 24;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  let p2 = "";
  if (second) {
    const s = points.map((p, i) => (p.v2 == null ? null : `${x(i).toFixed(1)},${y(p.v2).toFixed(1)}`)).filter(Boolean);
    if (s.length > 1) p2 = `<path class="line2" d="M${s.join(" L")}"/>`;
  }
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    ${ticks.map((t) => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`).join("")}
    ${p2}<path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.v)}" r="3.5"><title>${esc(p.title || "")}</title></circle>`).join("")}
    <text x="${L}" y="${H - 4}">${esc(points[0].label || "")}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${esc(points[points.length - 1].label || "")}</text>
  </svg></div>`;
}

/* ---------- modal & toast ---------- */
export function modal(title, bodyHtml, { narrow = false } = {}) {
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="modal-box ${narrow ? "narrow" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`;
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(el);
  return { el, body: el.querySelector(".modal-body"), close };
}

export async function showPageModal(q) {
  const regions = [...q.regions];
  const page = regions[0].page;
  const m = modal(`${q.label} — booklet page ${page}`, `<div class="scan-placeholder">Rendering page…</div>`);
  try {
    const canvas = await renderPage(q.sha256, page, regions.filter((r) => r.page === page).map((r) => r.box));
    m.body.replaceChildren(canvas);
  } catch (err) {
    m.body.innerHTML = `<p>${esc(err.message || err)}</p>`;
  }
}

export function toast(msg, ms = 3200) {
  let host = $(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function confirmDialog(title, text, okLabel = "Confirm") {
  return new Promise((resolve) => {
    const m = modal(title, `<p class="sans">${text}</p><div class="row" style="margin-top:18px"><button class="btn primary" data-ok>${esc(okLabel)}</button><button class="btn ghost" data-close>Cancel</button></div>`, { narrow: true });
    m.el.addEventListener("click", (e) => {
      if (e.target.closest("[data-ok]")) { m.close(); resolve(true); }
      else if (e.target.closest("[data-close]") || e.target === m.el) resolve(false);
    });
  });
}

export function download(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
