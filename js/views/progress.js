import { getBank } from "../data.js";
import * as store from "../store.js";
import { computeStats, accuracy, avgTime, weaknesses, sessionTrend, dailyActivity, streak } from "../analytics.js";
import { projectScore } from "../scoring.js";
import { createPractice } from "../session.js";
import { esc, pct, fmtDuration, fmtDate, plural, barRows, lineChart, isAvailable, toast } from "../ui.js";

export function render(app) {
  const bank = getBank();
  const st = store.getState();
  const stats = computeStats(st.attempts, bank.index);
  const o = stats.overall;

  if (!o.answered && !o.omitted) {
    app.innerHTML = `<div class="page-heading"><p class="eyebrow">Progress</p><h1>Your progress.</h1><p>Your record is stored in this browser. Export it from Settings to move it to another device.</p></div>
      <div class="empty"><strong>No answers yet.</strong>Complete a practice set or an exam and your analytics will appear here.
      <div class="row" style="justify-content:center;margin-top:16px"><a class="btn primary" href="#/practice">Start practising</a></div></div>`;
    return;
  }

  const tables = bank.tests.map((t) => t.scoring?.rawToScaled).filter(Boolean);
  const proj = projectScore(stats.authentic, bank.blueprint, tables);
  const trend = sessionTrend(st.sessions).slice(-30);
  const act = dailyActivity(st.attempts, 28);
  const maxAct = Math.max(1, ...act.map((a) => a.answered));
  const weak = weaknesses(stats, bank.topicNames, { min: 3, limit: 5 });
  const topicRows = bank.topics.areas.flatMap((a) => a.topics).map((t) => {
    const b = stats.byTopic[t.id];
    return { name: t.name, value: accuracy(b), label: b ? `${pct(accuracy(b))} · ${b.correct}/${b.answered}` : "—", href: `#/practice/${t.id}`, n: b?.answered || 0 };
  }).sort((a, b) => (a.value ?? 2) - (b.value ?? 2));
  const diffRows = [1, 2, 3, 4, 5].map((d) => {
    const b = stats.byDifficulty[d];
    return { name: `${d} · ${bank.topics.difficultyNames[d]}`, value: accuracy(b), label: b ? `${pct(accuracy(b))} · ${b.answered}` : "—" };
  });
  const fmtRows = Object.entries(bank.topics.formats).map(([k, f]) => {
    const b = stats.byFormat[k];
    return { name: f.name, value: accuracy(b), label: b ? `${pct(accuracy(b))} · ${b.answered}` : "—" };
  });
  const areaRows = bank.topics.areas.map((a) => {
    const b = stats.byArea[a.id];
    return { name: a.name, value: accuracy(b), label: b ? `${pct(accuracy(b))} · ${b.answered}` : "—" };
  });
  const timeRows = bank.topics.areas.flatMap((a) => a.topics).map((t) => ({ t, b: stats.byTopic[t.id] })).filter((x) => x.b?.timed >= 2)
    .map(({ t, b }) => ({ name: t.name, value: Math.min(1, avgTime(b) / 150000), label: fmtDuration(avgTime(b)), sec: avgTime(b) }))
    .sort((a, b) => b.sec - a.sec).slice(0, 8);
  const exams = trend.filter((p) => p.kind === "exam" && p.scaled != null);
  const missedAvail = stats.missed.filter((id) => isAvailable(bank.index.get(id)));

  app.innerHTML = `
    <div class="page-heading"><p class="eyebrow">Progress</p><h1>Your progress.</h1><p>Everything is calculated from your answers in this browser. Export it from <a href="#/settings">Settings</a> to keep a backup.</p></div>
    <div class="stats-grid">
      <div class="stat accent"><span>Answered</span><strong>${o.answered}</strong><em>${plural(stats.seen.size, "different question")}${o.omitted ? ` · ${o.omitted} omitted in exams` : ""}</em></div>
      <div class="stat accent"><span>Accuracy</span><strong>${pct(accuracy(o))}</strong><em>authentic ${pct(accuracy(stats.authentic))} · original ${pct(accuracy(stats.byOrigin.original))}</em></div>
      <div class="stat accent"><span>Average time</span><strong>${fmtDuration(avgTime(o))}</strong><em>per answered question (SAT pace ≈ 72s)</em></div>
      <div class="stat accent"><span>Projected SAT-M</span><strong>${proj ? proj.scaled : "—"}</strong><em>${proj ? `likely range ${proj.low}–${proj.high}` : `needs ${Math.max(0, 30 - stats.authentic.answered)} more authentic answers`}</em></div>
    </div>
    <p class="hint" style="margin:8px 0 0">The projection models your accuracy by difficulty and format on authentic questions, applies formula scoring to a full 60-question test, and averages the official conversion tables. It is an estimate; a timed full simulation is the real measure.</p>

    <div class="two-col" style="margin-top:22px">
      <div class="panel"><p class="eyebrow" style="margin-bottom:14px">Focus areas</p>
        ${weak.length ? `<div class="bars">${weak.map((w) => `<div class="bar-row"><span class="name"><a href="#/practice/${w.id}">${esc(w.name)}</a></span><span class="track"><span class="fill ${w.acc < 0.5 ? "weak" : ""}" style="width:${w.acc * 100}%"></span></span><span class="val">${pct(w.acc)} · ${w.correct}/${w.answered}</span></div>`).join("")}</div>
          <p class="hint" style="margin-top:12px">Ranked by accuracy, adjusted for how many questions you have answered in each topic.</p>` : `<p class="muted small sans">Answer at least 3 questions in a topic to rank it.</p>`}
      </div>
      <div class="panel"><p class="eyebrow" style="margin-bottom:14px">Mistake notebook</p>
        <p class="sans" style="margin:0 0 12px"><strong style="font-size:2rem;color:var(--navy);font-family:var(--serif)">${stats.missed.length}</strong> <span class="muted">questions whose last attempt was wrong.</span></p>
        <div class="row"><button class="btn primary small" data-act="retry" ${missedAvail.length ? "" : "disabled"}>Retry ${missedAvail.length} now</button><a class="btn small ghost" href="#/questions?status=missed">Browse them</a></div>
        <p class="hint" style="margin-top:12px">A question leaves the notebook once you answer it correctly.</p>
      </div>
    </div>

    <h2 class="section-title">Accuracy by topic</h2>
    <div class="panel">${barRows(topicRows.filter((r) => r.n > 0))}${topicRows.some((r) => !r.n) ? `<p class="hint" style="margin-top:14px">Not yet practised: ${topicRows.filter((r) => !r.n).map((r) => `<a href="${r.href}">${esc(r.name)}</a>`).join(", ")}.</p>` : ""}</div>

    <div class="two-col" style="margin-top:16px">
      <div class="panel"><p class="eyebrow" style="margin-bottom:14px">By difficulty</p>${barRows(diffRows)}</div>
      <div class="panel"><p class="eyebrow" style="margin-bottom:14px">By area and format</p>${barRows([...areaRows, ...fmtRows])}</div>
    </div>

    <h2 class="section-title">Trends</h2>
    <div class="two-col">
      <div class="panel"><p class="eyebrow" style="margin-bottom:10px">Accuracy per session</p>${lineChart(trend.map((p) => ({ v: p.acc, title: `${p.title}: ${pct(p.acc)} (${p.answered})`, label: fmtDate(p.at) })))}</div>
      <div class="panel"><p class="eyebrow" style="margin-bottom:10px">Exam scores (SAT-M)</p>${exams.length ? lineChart(exams.map((p) => ({ v: p.scaled, title: `${p.title}: ${p.scaled}`, label: fmtDate(p.at) })), { yMin: 200, yMax: 800, yFmt: (v) => Math.round(v) }) : `<p class="muted small sans">Take a full exam simulation to chart your scaled score.</p>`}</div>
    </div>
    <div class="two-col" style="margin-top:16px">
      <div class="panel"><p class="eyebrow" style="margin-bottom:12px">Last 28 days · ${streak(act)}-day streak</p>
        <div class="heat">${act.map((a) => `<i class="${a.answered === 0 ? "" : a.answered / maxAct > 0.66 ? "l3" : a.answered / maxAct > 0.33 ? "l2" : "l1"}" title="${a.day}: ${a.answered} answered"></i>`).join("")}</div>
        <p class="hint" style="margin-top:10px">${act.reduce((x, a) => x + a.answered, 0)} questions answered in the last four weeks.</p></div>
      <div class="panel"><p class="eyebrow" style="margin-bottom:14px">Slowest topics (average time)</p>${timeRows.length ? barRows(timeRows) : `<p class="muted small sans">Timing appears after a few answers per topic.</p>`}</div>
    </div>

    <h2 class="section-title">Recent sessions</h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Session</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead><tbody>
      ${trend.slice().reverse().slice(0, 15).map((p) => `<tr class="clickable" data-href="#/results/${p.id}"><td>${fmtDate(p.at)}</td><td>${esc(p.title)}</td><td class="num">${p.scaled != null ? `<b>${p.scaled}</b>` : `${Math.round(p.acc * p.answered)}/${p.answered}`}</td><td class="num">${pct(p.acc)}</td></tr>`).join("")}
    </tbody></table></div>`;

  app.onclick = (e) => {
    const row = e.target.closest("[data-href]");
    if (row) { location.hash = row.dataset.href; return; }
    if (e.target.closest("[data-act='retry']")) {
      const list = missedAvail.map((id) => bank.index.get(id));
      if (!list.length) return toast("Nothing to retry.");
      store.startSession(createPractice({ title: "Mistake review", questions: list, feedback: "immediate" }));
      location.hash = "#/session";
    }
  };
}
