// Browse the whole bank and open any single question.
import { getBank } from "../data.js";
import * as store from "../store.js";
import { computeStats } from "../analytics.js";
import { filterPool } from "../select.js";
import { createPractice } from "../session.js";
import {
  esc, $, dots, originBadge, topicBadges, formatName, renderQuestionBody, answerControls, explanationBlock,
  isAvailable, showPageModal, plural,
} from "../ui.js";

let filters = { origin: "", test: "", topic: "", format: "", status: "", q: "" };

export function render(app, params = {}) {
  const bank = getBank();
  const stats = computeStats(store.getState().attempts, bank.index);
  if (params.status) filters = { ...filters, status: params.status };

  app.innerHTML = `
    <div class="page-heading"><p class="eyebrow">Question bank</p><h1>Every question, one place.</h1>
      <p>Browse all ${bank.questions.length} questions — ${bank.questions.filter((q) => q.origin === "authentic").length} authentic SAT questions and ${bank.questions.filter((q) => q.origin === "original").length} original practice questions. Open one to answer it on its own.</p></div>
    <div class="panel" style="margin-bottom:16px">
      <div class="row">
        <select data-f="origin" aria-label="Source"><option value="">All sources</option><option value="authentic">Authentic SAT</option><option value="original">Original practice</option></select>
        <select data-f="test" aria-label="Test form"><option value="">All forms</option>${bank.tests.map((t) => `<option value="${t.id}">Form ${esc(t.formCode)}</option>`).join("")}</select>
        <select data-f="topic" aria-label="Topic"><option value="">All topics</option>${bank.topics.areas.map((a) => `<optgroup label="${esc(a.name)}">${a.topics.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</optgroup>`).join("")}</select>
        <select data-f="format" aria-label="Format"><option value="">All formats</option><option value="mc5">Regular multiple choice</option><option value="qc4">Quantitative comparison</option></select>
        <select data-f="status" aria-label="Status"><option value="">Any status</option><option value="unseen">Unseen</option><option value="missed">Missed last time</option><option value="seen">Answered before</option></select>
        <span class="spacer"></span><button class="btn small primary" data-act="practise">Practise these</button>
      </div>
    </div>
    <p id="qcount" class="muted small sans"></p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Question</th><th>Topic</th><th>Format</th><th>Difficulty</th><th class="num">Status</th></tr></thead><tbody id="qrows"></tbody></table></div>`;

  for (const sel of app.querySelectorAll("[data-f]")) sel.value = filters[sel.dataset.f];
  const draw = () => {
    const list = current(bank, stats);
    $("#qcount", app).textContent = `${plural(list.length, "question")}${list.some((q) => !isAvailable(q)) ? " · locked rows need their booklet loaded" : ""}`;
    $("#qrows", app).innerHTML = list.map((q) => {
      const last = stats.last.get(q.id);
      const status = !last ? `<span class="muted">—</span>` : last.ok ? `<span class="badge ok">Right</span>` : `<span class="badge bad">Wrong</span>`;
      return `<tr class="clickable" data-q="${q.id}"><td><b style="color:var(--navy)">${esc(q.shortLabel)}</b> ${q.origin === "original" ? `<span class="badge original">Original</span>` : ""}${isAvailable(q) ? "" : ` <span class="muted small">🔒</span>`}</td>
        <td>${esc(bank.topicNames[q.topics?.[0]] || "")}</td><td>${esc(formatName(q.type))}</td><td>${dots(q.difficulty)}</td><td class="num">${status}</td></tr>`;
    }).join("");
  };
  draw();
  app.oninput = (e) => {
    const f = e.target.closest("[data-f]");
    if (!f) return;
    filters[f.dataset.f] = f.value;
    draw();
  };
  app.onclick = (e) => {
    const row = e.target.closest("[data-q]");
    if (row) { location.hash = `#/q/${row.dataset.q}`; return; }
    if (e.target.closest("[data-act='practise']")) {
      const list = current(bank, stats).filter(isAvailable);
      if (!list.length) return;
      store.startSession(createPractice({ title: "Question bank selection", questions: list.slice(0, 60), feedback: "immediate" }));
      location.hash = "#/session";
    }
  };
}

function current(bank, stats) {
  return filterPool(bank.questions, {
    origins: filters.origin ? [filters.origin] : ["authentic", "original"],
    topics: filters.topic ? [filters.topic] : [],
    formats: filters.format ? [filters.format] : [],
    tests: filters.test ? [filters.test] : [],
    status: filters.status || "all",
  }, stats).sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "authentic" ? -1 : 1) || (a.testId || "").localeCompare(b.testId || "") || (a.sectionNumber || 0) - (b.sectionNumber || 0) || (a.n || 0) - (b.n || 0) || a.id.localeCompare(b.id));
}

/* ---------------- single question ---------------- */
export function renderSingle(app, id) {
  const bank = getBank();
  const q = bank.index.get(id);
  if (!q) { app.innerHTML = `<div class="empty"><strong>Question not found.</strong><a href="#/questions">Back to the question bank</a></div>`; return; }
  const list = current(bank, computeStats(store.getState().attempts, bank.index));
  const i = list.findIndex((x) => x.id === id);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  let chosen = null;
  let revealed = false;
  let t0 = performance.now();

  const draw = () => {
    app.innerHTML = `
      <div class="session-bar"><a class="link-btn" href="#/questions">← Question bank</a><span class="spacer"></span>
        ${prev ? `<a class="btn small ghost" href="#/q/${prev.id}">Previous</a>` : ""}${next ? `<a class="btn small ghost" href="#/q/${next.id}">Next</a>` : ""}</div>
      <div class="qpanel" style="max-width:860px">
        <div class="qhead"><span class="qnum">${esc(q.label)}</span><span class="tags">${originBadge(q)}${topicBadges(q)}<span class="badge">${esc(formatName(q.type))}</span><span class="badge">${dots(q.difficulty)}</span></span></div>
        <div id="qbody" class="qbody"></div>
        ${isAvailable(q) ? answerControls(q, { selected: chosen, reveal: revealed }) : ""}
        ${revealed ? explanationBlock(q, { chosen }) : ""}
        <div class="qactions">
          ${isAvailable(q) && !revealed ? `<button class="btn primary" data-act="check" ${chosen ? "" : "disabled"}>Check answer</button><button class="btn ghost" data-act="show">Show answer</button>` : ""}
          ${revealed && next ? `<a class="btn primary" href="#/q/${next.id}">Next question</a>` : ""}
          ${q.origin === "authentic" && isAvailable(q) ? `<button class="btn ghost" data-act="page">View full page</button>` : ""}
        </div>
      </div>`;
    renderQuestionBody(q, $("#qbody", app));
  };
  draw();
  app.onclick = (e) => {
    const c = e.target.closest("[data-choice]");
    if (c && !c.disabled && !revealed) { chosen = c.dataset.choice; return draw(); }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "check" && chosen) {
      revealed = true;
      store.recordAttempt({ q: q.id, c: chosen, ok: chosen === q.answer, t: Math.round(performance.now() - t0), at: Date.now(), s: "single", m: "single" });
      draw();
    } else if (act === "show") { revealed = true; draw(); }
    else if (act === "page") showPageModal(q);
  };
}
