import { getBank } from "../data.js";
import * as store from "../store.js";
import { computeStats, accuracy, weaknesses, dailyActivity, streak } from "../analytics.js";
import { projectScore } from "../scoring.js";
import { listBooklets } from "../booklets.js";
import { esc, pct, plural, isAvailable } from "../ui.js";
import { resumeLabel } from "./session.js";

export function render(app) {
  const bank = getBank();
  const st = store.getState();
  const stats = computeStats(st.attempts, bank.index);
  const auth = bank.questions.filter((q) => q.origin === "authentic");
  const loaded = listBooklets().length;
  const avail = bank.questions.filter(isAvailable).length;
  const resume = resumeLabel();
  const weak = weaknesses(stats, bank.topicNames, { min: 3, limit: 3 });
  const act = dailyActivity(st.attempts, 28);
  const proj = projectScore(stats.authentic, bank.blueprint, bank.tests.map((t) => t.scoring?.rawToScaled).filter(Boolean));
  const exams = Object.values(st.sessions).filter((s) => s.kind === "exam" && s.finishedAt && s.result?.scaled != null && !s.result.scaledEstimate);
  const best = exams.length ? Math.max(...exams.map((s) => s.result.scaled)) : null;

  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">Pre-1994 SAT Mathematics</p>
        <h1>Practise the real SAT of the 1980s.</h1>
        <p class="lede">Authentic questions from released Scholastic Aptitude Tests, timed section simulations scored with the original formula and conversion tables, explanations for every question, and analytics that show you exactly where to improve.</p>
        <div class="row">
          ${resume ? `<a class="btn primary" href="#/session">Resume: ${esc(resume.title)} (${resume.done}/${resume.total})</a>` : `<a class="btn primary" href="#/practice">Start practising</a>`}
          <a class="btn" href="#/exams">Take a timed exam</a>
        </div>
      </div>
      <div class="sheet-art" aria-hidden="true">
        <div class="sheet-title"><span>Section 3 — Mathematics</span><span>25 questions · 30 min</span></div>
        ${["C", "A", "E", "B", "D", "B"].map((L, i) => `<div class="sheet-row"><b>${i + 1}</b>${"ABCDE".split("").map((x) => `<span class="o ${x === L ? "f" : ""}">${x}</span>`).join("")}</div>`).join("")}
        <div class="sheet-row" style="margin-top:8px;color:var(--teal);font-weight:700">Raw = R − W/4 · Scaled 200–800</div>
      </div>
    </section>

    ${loaded === 0 ? `<div class="notice warn" style="margin-bottom:28px"><div>
      <p><strong>Load your test booklets to unlock the authentic questions.</strong> This site carries the answer keys, topic tags, explanations, score tables and page maps for ${plural(bank.tests.length, "released test form")} (${auth.length} math questions), but not the College Board's printed pages. Load your scanned PDF of each booklet once; it stays in this browser and is never uploaded.</p>
      <div class="row"><a class="btn small primary" href="#/booklets">Load booklets</a><a class="btn small ghost" href="#/about">Why?</a></div></div></div>` : ""}

    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat accent"><span>Questions answered</span><strong>${stats.overall.answered}</strong><em>${plural(stats.seen.size, "different question")}</em></div>
      <div class="stat accent"><span>Accuracy</span><strong>${pct(accuracy(stats.overall))}</strong><em>${stats.authentic.answered} on authentic questions</em></div>
      <div class="stat accent"><span>${best != null ? "Best exam score" : "Projected SAT-M"}</span><strong>${best != null ? best : proj ? proj.scaled : "—"}</strong><em>${best != null ? `from ${plural(exams.length, "full simulation")}` : proj ? `range ${proj.low}–${proj.high}` : "after 30 authentic answers"}</em></div>
      <div class="stat accent"><span>Practice streak</span><strong>${streak(act)}</strong><em>${streak(act) === 1 ? "day" : "days"} in a row</em></div>
    </div>

    <h2 class="section-title">Choose how to work</h2>
    <div class="card-grid grid-3">
      <a class="card big" href="#/practice"><span class="kicker">Practice</span><strong>Topic & custom sets</strong><span class="desc">Focused sets by topic, difficulty or format, with an explanation after each answer.</span><span class="meta">${avail} questions available</span><span class="arrow">→</span></a>
      <a class="card big" href="#/exams"><span class="kicker">Exams</span><strong>Timed simulations</strong><span class="desc">Both 30-minute math sections of a real test form, scored to 200–800 with its own table.</span><span class="meta">${plural(bank.tests.length, "test form")}</span><span class="arrow">→</span></a>
      <a class="card big" href="#/progress"><span class="kicker">Progress</span><strong>Analytics</strong><span class="desc">Accuracy by topic, difficulty and format, pacing, trends and your weakest areas.</span><span class="meta">${plural(Object.values(st.sessions).filter((s) => s.finishedAt).length, "session")} completed</span><span class="arrow">→</span></a>
    </div>

    ${weak.length ? `<h2 class="section-title">Focus areas</h2><p class="section-sub">Your lowest-scoring topics so far (at least 3 answers each).</p>
      <div class="card-grid grid-3">${weak.map((w) => `<a class="card topic-card" href="#/practice/${w.id}"><span class="kicker">${pct(w.acc)} · ${w.correct}/${w.answered}</span><strong>${esc(w.name)}</strong><span class="desc">Practise ten more ${esc(w.name.toLowerCase())} questions.</span><span class="meter weak"><span style="width:${w.acc * 100}%"></span></span><span class="arrow">→</span></a>`).join("")}</div>` : ""}

    <h2 class="section-title">The question bank</h2>
    <div class="card-grid grid-4">
      ${bank.tests.map((t) => `<a class="card" href="#/exams"><span class="kicker">${listBooklets().some((b) => b.sha256 === t.pdf.sha256) ? "Booklet loaded" : "Booklet not loaded"}</span><strong>Form ${esc(t.formCode)}</strong><span class="desc">${esc(t.title)}</span><span class="meta"><span>${t.questions.length} math questions</span><span>${esc(t.copyrightYears || "")}</span></span></a>`).join("")}
    </div>`;
}
