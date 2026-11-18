import { getBank } from "../data.js";
import * as store from "../store.js";
import { createExam } from "../session.js";
import { hasBooklet } from "../booklets.js";
import { esc, fmtDate, confirmDialog } from "../ui.js";

export function render(app) {
  const bank = getBank();
  const st = store.getState();
  const history = Object.values(st.sessions).filter((s) => s.kind === "exam" && s.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt);

  app.innerHTML = `
    <div class="page-heading"><p class="eyebrow">Exams</p><h1>Sit a real SAT mathematics test.</h1>
      <p>Each simulation uses one released test form exactly as printed: Section 3 (25 questions) and Section 5 (35 questions, including 20 quantitative comparisons), 30 minutes each, with the original directions. Your score is computed with the 1980s formula — right minus a fraction of wrong — and converted to 200–800 with that form's official table.</p></div>
    <div class="form-list">${bank.tests.map((t) => formCard(t, history)).join("")}</div>
    <label class="row sans small" style="margin-top:16px"><input type="checkbox" id="untimed"> Untimed (practise the format without the clock)</label>

    <h2 class="section-title">Exam history</h2>
    ${history.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Exam</th><th class="num">Right</th><th class="num">Wrong</th><th class="num">Omit</th><th class="num">Raw</th><th class="num">SAT-M</th></tr></thead><tbody>
      ${history.map((s) => `<tr class="clickable" data-href="#/results/${s.id}"><td>${fmtDate(s.finishedAt)}</td><td>${esc(s.title)}</td><td class="num">${s.result.correct}</td><td class="num">${s.result.wrong}</td><td class="num">${s.result.omitted}</td><td class="num">${s.result.raw}</td><td class="num"><b>${s.result.scaled ?? "—"}</b>${s.result.scaledEstimate ? " <span class='muted'>(est.)</span>" : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><strong>No exams yet.</strong>Your simulations and scores will be listed here.</div>`}`;

  app.onclick = async (e) => {
    const row = e.target.closest("[data-href]");
    if (row) { location.hash = row.dataset.href; return; }
    const b = e.target.closest("[data-exam]");
    if (!b || b.disabled) return;
    const test = bank.testById.get(b.dataset.exam);
    const sections = b.dataset.sections.split(",");
    if (store.activeSession()) {
      const ok = await confirmDialog("Replace the session in progress?", "You have an unfinished session. Starting this exam will discard it.", "Start exam");
      if (!ok) return;
    }
    const s = createExam(test, sections, { timed: !document.getElementById("untimed").checked });
    store.startSession(s);
    location.hash = "#/session";
  };
}

function formCard(t, history) {
  const loaded = hasBooklet(t.pdf.sha256);
  const mine = history.filter((s) => s.testId === t.id && s.result?.scaled != null && !s.result.scaledEstimate);
  const best = mine.length ? Math.max(...mine.map((s) => s.result.scaled)) : null;
  const sec = (id) => t.sections.find((s) => s.id === id);
  const dis = loaded ? "" : "disabled";
  return `<div class="form-item ${loaded ? "loaded" : ""}">
    <div class="form-code">${esc(t.formCode)}</div>
    <div><h3>SAT Form ${esc(t.formCode)}${t.bookLabel ? ` <span class="muted small sans" style="font-weight:400">· ${esc(t.bookLabel)}</span>` : ""}</h3>
      <p class="muted small sans" style="margin:0">${esc(t.title)} · ${t.questions.length} math questions · ${esc(t.copyrightYears || "")}${best != null ? ` · best score <b style="color:var(--navy)">${best}</b>` : ""}</p>
      ${loaded ? "" : `<p class="small sans" style="margin:6px 0 0"><a href="#/booklets">Load this booklet</a> to take this test.</p>`}</div>
    <div class="actions row">
      <button class="btn primary small" data-exam="${t.id}" data-sections="${t.sections.map((s) => s.id).join(",")}" ${dis}>Full math · 60 min</button>
      ${t.sections.map((s) => `<button class="btn small ghost" data-exam="${t.id}" data-sections="${s.id}" ${dis}>Section ${s.number} · ${s.minutes} min</button>`).join("")}
    </div></div>`;
}
