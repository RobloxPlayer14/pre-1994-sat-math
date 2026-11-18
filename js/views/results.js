import { getBank } from "../data.js";
import * as store from "../store.js";
import { createPractice, allItems } from "../session.js";
import {
  esc, $, pct, fmtDuration, fmtDate, plural, originBadge, formatName, renderQuestionBody, answerControls,
  explanationBlock, barRows, isAvailable, showPageModal,
} from "../ui.js";

export function render(app, id) {
  const bank = getBank();
  const s = store.getState().sessions[id];
  if (!s || !s.result) {
    app.innerHTML = `<div class="empty"><strong>Result not found.</strong>It may have been removed. <a href="#/progress">See your progress</a>.</div>`;
    return;
  }
  const r = s.result;
  const isExam = s.kind === "exam";
  const acc = r.answered ? r.correct / r.answered : null;
  const ids = allItems(s);
  const missed = ids.filter((qid) => {
    const resp = s.responses[qid];
    return resp?.c && resp.c !== bank.index.get(qid).answer;
  });
  const omitted = ids.filter((qid) => !s.responses[qid]?.c);

  const dial = isExam && r.scaled != null
    ? `<div class="score-dial"><div><strong>${r.scaled}</strong><span>${r.scaledEstimate ? "Est. SAT-M" : "SAT-M"}</span></div></div>`
    : `<div class="score-dial"><div><strong>${acc == null ? "—" : Math.round(acc * 100)}<small style="font-size:1.2rem">%</small></strong><span>Accuracy</span></div></div>`;

  const typeRows = Object.entries(r.byType || {}).map(([t, b]) => `<tr><td>${esc(formatName(t))}</td><td class="num">${b.right}</td><td class="num">${b.wrong}</td><td class="num">${b.omitted}</td><td class="num">${t === "qc4" ? "−⅓" : "−¼"} each</td><td class="num">${b.points.toFixed(2)}</td></tr>`).join("");

  const topicRows = Object.entries(r.byTopic || {})
    .map(([t, b]) => ({ name: bank.topicNames[t] || t, value: b.answered ? b.correct / b.answered : null, label: `${b.correct}/${b.answered + b.omitted}` }))
    .sort((a, b) => (a.value ?? 2) - (b.value ?? 2));

  app.innerHTML = `
    <div class="page-heading" style="margin-bottom:22px"><p class="eyebrow">${isExam ? "Exam simulation" : "Practice set"} · ${fmtDate(s.finishedAt)}</p></div>
    <div class="score-hero">
      ${dial}
      <div>
        <h1>${esc(s.title)}</h1>
        <p class="lede">${r.correct} correct, ${r.wrong} wrong, ${r.omitted} omitted out of ${r.total} · ${fmtDuration(r.totalTime)}${r.answered ? ` · ${fmtDuration(r.totalTime / Math.max(1, r.total))} per question` : ""}</p>
        ${isExam ? `<p class="formula">Raw score = right − ¼ × wrong (5-choice) − ⅓ × wrong (4-choice) = ${r.unrounded.toFixed(2)} → ${r.raw}${r.scaledEstimate ? ` · projected to 60 questions: ${r.projectedRaw}` : ""}</p>
          ${r.scaled != null ? `<p class="small sans muted" style="margin:8px 0 0">${r.scaledEstimate ? "Single-section estimate: your section score was scaled up to a full 60-question test and converted with this form's official table." : "Converted with the official raw-to-scaled table printed for this test form."}</p>` : `<p class="small sans muted">No conversion table available for this form.</p>`}` : ""}
        <div class="row" style="margin-top:18px">
          ${missed.length ? `<button class="btn primary" data-act="retry">Retry ${plural(missed.length, "missed question")}</button>` : ""}
          ${omitted.length && !isExam ? `<button class="btn" data-act="retry-omit">Try the ${omitted.length} skipped</button>` : ""}
          <a class="btn ghost" href="#/${isExam ? "exams" : "practice"}">${isExam ? "Back to exams" : "New practice set"}</a>
          <a class="btn ghost" href="#/progress">Progress</a>
        </div>
      </div>
    </div>
    ${isExam ? `
      <div class="two-col" style="margin-bottom:18px">
        <div class="panel"><p class="eyebrow" style="margin-bottom:12px">Formula scoring</p>
          <div class="table-wrap"><table class="data"><thead><tr><th>Format</th><th class="num">Right</th><th class="num">Wrong</th><th class="num">Omit</th><th class="num">Penalty</th><th class="num">Points</th></tr></thead><tbody>${typeRows}</tbody></table></div></div>
        <div class="panel"><p class="eyebrow" style="margin-bottom:12px">By section</p>
          <div class="table-wrap"><table class="data"><thead><tr><th>Section</th><th class="num">Right</th><th class="num">Wrong</th><th class="num">Omit</th><th class="num">Raw</th><th class="num">Time</th></tr></thead><tbody>
          ${(r.parts || []).map((p) => `<tr><td>${esc(p.title)}</td><td class="num">${p.right}</td><td class="num">${p.wrong}</td><td class="num">${p.omitted}</td><td class="num">${p.raw}</td><td class="num">${fmtDuration(p.elapsed * 1000)}</td></tr>`).join("")}
          </tbody></table></div></div>
      </div>` : ""}
    <div class="panel"><p class="eyebrow" style="margin-bottom:14px">By topic</p>${barRows(topicRows)}</div>
    <h2 class="section-title">Question review</h2>
    <p class="section-sub">Open a question to see it again with the answer and explanation.</p>
    <div class="row" style="margin-bottom:12px">
      <div class="seg" role="group" aria-label="Filter review">
        <button aria-pressed="true" data-filter="all">All (${ids.length})</button>
        <button aria-pressed="false" data-filter="bad">Wrong (${missed.length})</button>
        <button aria-pressed="false" data-filter="omit">Omitted (${omitted.length})</button>
      </div>
    </div>
    <div class="review-list" id="review">${ids.map((qid, i) => reviewItem(s, qid, i)).join("")}</div>`;

  app.onclick = (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "retry" || act === "retry-omit") {
      const list = (act === "retry" ? missed : omitted).map((x) => bank.index.get(x)).filter(isAvailable);
      const ses = createPractice({ title: act === "retry" ? "Retry: missed questions" : "Skipped questions", questions: list, feedback: "immediate", meta: { from: s.id } });
      store.startSession(ses);
      location.hash = "#/session";
      return;
    }
    const f = e.target.closest("[data-filter]");
    if (f) {
      for (const b of app.querySelectorAll("[data-filter]")) b.setAttribute("aria-pressed", String(b === f));
      for (const it of app.querySelectorAll(".review-item")) {
        it.classList.toggle("hidden", f.dataset.filter !== "all" && !it.classList.contains(f.dataset.filter === "bad" ? "r-bad" : "r-omit"));
      }
      return;
    }
    const page = e.target.closest("[data-page]");
    if (page) showPageModal(bank.index.get(page.dataset.page));
  };
  app.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.tagName !== "DETAILS" || !d.open || d.dataset.loaded) return;
    d.dataset.loaded = "1";
    const q = bank.index.get(d.dataset.q);
    renderQuestionBody(q, d.querySelector(".qslot"));
  }, true);
}

function reviewItem(s, qid, i) {
  const bank = getBank();
  const q = bank.index.get(qid);
  const r = s.responses[qid] || {};
  const status = !r.c ? "r-omit" : r.c === q.answer ? "r-ok" : "r-bad";
  const badge = !r.c ? `<span class="badge warn">Omitted</span>` : r.c === q.answer ? `<span class="badge ok">Correct</span>` : `<span class="badge bad">Wrong</span>`;
  return `<details class="review-item ${status}" data-q="${qid}">
    <summary><span class="qn">${s.kind === "exam" ? `${esc(s.parts.find((p) => p.items.includes(qid)).title)} · Q${q.n}` : `Question ${i + 1}`}</span>
      ${badge}<span class="muted">${esc(bank.topicNames[q.topics?.[0]] || "")}</span>
      <span class="spacer"></span><span class="muted">You: <b>${r.c || "—"}</b> · Answer: <b>${q.answer}</b> · ${fmtDuration(r.t)}</span></summary>
    <div class="detail">
      <div class="row" style="margin-bottom:10px">${originBadge(q)}<span class="muted small sans">${esc(q.label)}</span>${q.origin === "authentic" && isAvailable(q) ? `<button class="link-btn" data-page="${qid}">View full page</button>` : ""}</div>
      <div class="qslot qbody"></div>
      ${isAvailable(q) ? answerControls(q, { selected: r.c || null, reveal: true }) : ""}
      ${explanationBlock(q, { chosen: r.c || null })}
    </div></details>`;
}
