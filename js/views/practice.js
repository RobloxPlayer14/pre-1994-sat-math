// Practice: quick starts, topic cards and a full set builder.
import { getBank } from "../data.js";
import * as store from "../store.js";
import { computeStats, accuracy, weaknesses } from "../analytics.js";
import { filterPool, selectQuestions } from "../select.js";
import { createPractice } from "../session.js";
import { esc, $, pct, plural, isAvailable, toast } from "../ui.js";

const DEFAULT = {
  origins: ["authentic", "original"], topics: [], formats: [], difficulty: [1, 5],
  status: "all", count: 10, order: "random", feedback: "immediate", timer: "off",
};
let cfg = null;

export function render(app, params = {}) {
  const bank = getBank();
  const st = store.getState();
  const stats = computeStats(st.attempts, bank.index);
  const pool = bank.questions.filter(isAvailable);
  const authAvail = pool.filter((q) => q.origin === "authentic").length;
  const authTotal = bank.questions.filter((q) => q.origin === "authentic").length;
  if (!cfg) cfg = { ...DEFAULT, ...(safeLoad() || {}) };
  if (params.topic) cfg = { ...cfg, topics: [params.topic], status: "all" };

  const weak = weaknesses(stats, bank.topicNames, { min: 3, limit: 1 })[0];
  const missedAvail = stats.missed.filter((id) => isAvailable(bank.index.get(id))).length;
  const unseenAvail = pool.filter((q) => !stats.seen.has(q.id)).length;

  app.innerHTML = `
    <div class="page-heading"><p class="eyebrow">Practice</p><h1>Build your SAT mathematics.</h1>
      <p>Practise authentic questions from released pre-1994 SATs, by topic, difficulty or format — with an explanation after every answer.</p></div>
    ${authAvail === 0 ? `<div class="notice warn" style="margin-bottom:28px"><div><p><strong>No booklets loaded yet.</strong> The ${authTotal} authentic SAT questions appear once you load your copy of the test booklets — until then you can practise the ${bank.questions.length - authTotal} original questions written for this site.</p><div class="row"><a class="btn small primary" href="#/booklets">Load booklets</a></div></div></div>` : ""}
    <div class="card-grid grid-4">
      ${quick("quick", "Quick set", "10 random questions from everything available.", `${pool.length} available`)}
      ${quick("unseen", "Something new", "10 questions you have never answered.", `${unseenAvail} unseen`, !unseenAvail)}
      ${quick("missed", "Mistake review", "Retry the questions you got wrong last time.", `${missedAvail} to retry`, !missedAvail)}
      ${quick("weak", "Weakest topic", weak ? `Drill ${esc(weak.name)} (${pct(weak.acc)} so far).` : "Answer a few questions first — this targets your lowest-scoring topic.", weak ? esc(weak.name) : "Not enough data", !weak)}
    </div>

    <h2 class="section-title">Topics</h2>
    <p class="section-sub">Every question is tagged by topic. Pick one to start a focused set.</p>
    ${bank.topics.areas.map((area) => topicArea(area, pool, stats)).join("")}

    <h2 class="section-title" id="builder">Custom set</h2>
    <p class="section-sub">Combine filters to build exactly the set you want.</p>
    <div class="builder">
      <div class="panel" id="builder-form"></div>
      <div class="panel summary-box" id="builder-summary"></div>
    </div>`;

  drawBuilder(app, pool, stats);
  if (params.topic) $("#builder", app)?.scrollIntoView({ block: "start" });

  app.onclick = (e) => {
    const q = e.target.closest("[data-quick]");
    if (q && !q.disabled) return startQuick(q.dataset.quick, pool, stats, weak);
    const t = e.target.closest("[data-topic-start]");
    if (t && !t.disabled) {
      const list = selectQuestions(pool, { ...DEFAULT, topics: [t.dataset.topicStart], count: 10 }, stats);
      return start(`${bank.topicNames[t.dataset.topicStart]}`, list, { feedback: "immediate" }, { topic: t.dataset.topicStart });
    }
    handleBuilderClick(e, app, pool, stats);
  };
  app.oninput = (e) => handleBuilderInput(e, app, pool, stats);
}

function quick(id, title, desc, meta, disabled = false) {
  return `<button class="card" type="button" data-quick="${id}" ${disabled ? "disabled" : ""}><span class="kicker">Quick start</span><strong>${title}</strong><span class="desc">${desc}</span><span class="meta">${meta}</span><span class="arrow" aria-hidden="true">→</span></button>`;
}

function topicArea(area, pool, stats) {
  const bank = getBank();
  return `<div class="area"><div class="area-head"><h2>${esc(area.name)}</h2><span class="muted small sans">${esc(area.description)}</span></div>
    <div class="card-grid grid-3">${area.topics.map((t) => {
      const all = bank.questions.filter((q) => q.topics?.includes(t.id));
      const avail = pool.filter((q) => q.topics?.includes(t.id));
      const auth = all.filter((q) => q.origin === "authentic").length;
      const b = stats.byTopic[t.id];
      const acc = accuracy(b);
      return `<button class="card topic-card" type="button" data-topic-start="${t.id}" ${avail.length ? "" : "disabled"}>
        <strong>${esc(t.name)}</strong><span class="desc">${esc(t.description)}</span>
        <span class="meta"><span>${auth} authentic</span><span>${all.length - auth} original</span>${b ? `<span>${pct(acc)} of ${b.answered}</span>` : ""}</span>
        <span class="meter ${acc == null ? "" : acc < 0.5 ? "weak" : acc >= 0.8 ? "good" : ""}"><span style="width:${acc == null ? 0 : acc * 100}%"></span></span>
      </button>`;
    }).join("")}</div></div>`;
}

function startQuick(kind, pool, stats, weak) {
  const base = { ...DEFAULT, count: 10 };
  let list, title;
  if (kind === "quick") { list = selectQuestions(pool, base, stats); title = "Quick set"; }
  if (kind === "unseen") { list = selectQuestions(pool, { ...base, status: "unseen" }, stats); title = "New questions"; }
  if (kind === "missed") { list = selectQuestions(pool, { ...base, status: "missed", count: "all" }, stats); title = "Mistake review"; }
  if (kind === "weak" && weak) { list = selectQuestions(pool, { ...base, topics: [weak.id] }, stats); title = `Weakest topic: ${weak.name}`; }
  start(title, list, { feedback: "immediate" }, { quick: kind });
}

function start(title, list, { feedback, limitSec = null }, meta = {}) {
  if (!list?.length) return toast("No questions match. Try loosening the filters.");
  const s = createPractice({ title, questions: list, feedback, limitSec, meta });
  store.startSession(s);
  location.hash = "#/session";
}

/* ---------------- builder ---------------- */
function drawBuilder(app, pool, stats) {
  const bank = getBank();
  const form = $("#builder-form", app);
  const chip = (group, value, label, n) => `<button type="button" class="chip" data-chip="${group}" data-value="${value}" aria-pressed="${cfg[group].includes(value)}">${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ""}</button>`;
  const seg = (key, options) => `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-seg="${key}" data-value="${v}" aria-pressed="${String(cfg[key]) === String(v)}">${l}</button>`).join("")}</div>`;
  const cnt = (pred) => pool.filter(pred).length;
  form.innerHTML = `
    <div class="field"><span class="label">Source</span><div class="chips">
      ${chip("origins", "authentic", "Authentic SAT", cnt((q) => q.origin === "authentic"))}
      ${chip("origins", "original", "Original practice", cnt((q) => q.origin === "original"))}</div></div>
    <div class="field"><span class="label">Topics <button type="button" class="link-btn" data-clear="topics" style="margin-left:8px;text-transform:none;letter-spacing:0">${cfg.topics.length ? "clear" : "all topics"}</button></span>
      ${bank.topics.areas.map((a) => `<div class="chip-group"><p class="group-name">${esc(a.name)}</p><div class="chips">${a.topics.map((t) => chip("topics", t.id, t.name, cnt((q) => q.topics?.includes(t.id)))).join("")}</div></div>`).join("")}</div>
    <div class="field"><span class="label">Format</span><div class="chips">
      ${chip("formats", "mc5", "Regular multiple choice", cnt((q) => q.type === "mc5"))}
      ${chip("formats", "qc4", "Quantitative comparison", cnt((q) => q.type === "qc4"))}</div></div>
    <div class="field"><span class="label">Difficulty</span><div class="row sans small">
      <label>From <select data-diff="0">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${cfg.difficulty[0] === d ? "selected" : ""}>${d} · ${bank.topics.difficultyNames[d]}</option>`).join("")}</select></label>
      <label>to <select data-diff="1">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${cfg.difficulty[1] === d ? "selected" : ""}>${d} · ${bank.topics.difficultyNames[d]}</option>`).join("")}</select></label></div>
      <p class="hint" style="margin-top:6px">Authentic difficulty is estimated from question position: ETS arranged each group of questions from easiest to hardest.</p></div>
    <div class="field"><span class="label">Questions</span>${seg("status", [["all", "All"], ["unseen", "Unseen"], ["missed", "Missed last time"], ["seen", "Seen before"]])}</div>
    <div class="field"><span class="label">How many</span>${seg("count", [[5, "5"], [10, "10"], [20, "20"], [30, "30"], ["all", "All"]])}</div>
    <div class="field"><span class="label">Order</span>${seg("order", [["random", "Random"], ["test", "Booklet order"]])}</div>
    <div class="field"><span class="label">Feedback</span>${seg("feedback", [["immediate", "After each question"], ["end", "At the end"]])}</div>
    <div class="field" style="margin-bottom:0"><span class="label">Timer</span>${seg("timer", [["off", "Off"], ["pace", "SAT pace"], ["strict", "SAT pace, strict"]])}
      <p class="hint" style="margin-top:6px">SAT pace ≈ 72 seconds per regular question and 51 seconds per comparison — the average pace of the real sections. Strict ends the set when time runs out.</p></div>`;
  drawSummary(app, pool, stats);
}

function drawSummary(app, pool, stats) {
  const bank = getBank();
  const matches = filterPool(pool, cfg, stats);
  const n = cfg.count === "all" ? matches.length : Math.min(matches.length, Number(cfg.count));
  const secs = estimateSeconds(matches.slice(0, n));
  $("#builder-summary", app).innerHTML = `
    <p class="eyebrow">Your set</p>
    <p class="count" style="margin:10px 0 4px">${n}</p><p class="muted sans small" style="margin:0">${plural(matches.length, "question")} match these filters</p>
    <ul>
      <li><span>Topics</span><b>${cfg.topics.length ? cfg.topics.map((t) => esc(bank.topicNames[t])).join(", ") : "All"}</b></li>
      <li><span>Source</span><b>${cfg.origins.length === 2 ? "Authentic + original" : cfg.origins[0] === "authentic" ? "Authentic only" : cfg.origins[0] === "original" ? "Original only" : "None"}</b></li>
      <li><span>Difficulty</span><b>${cfg.difficulty[0]}–${cfg.difficulty[1]}</b></li>
      <li><span>Timer</span><b>${cfg.timer === "off" ? "Off" : `${Math.round(secs / 60)} min`}</b></li>
    </ul>
    <button class="btn primary" style="width:100%" data-act="start" ${n ? "" : "disabled"}>Start set</button>`;
}

function estimateSeconds(list) {
  return list.reduce((a, q) => a + (q.type === "qc4" ? 51 : 72), 0);
}

function handleBuilderClick(e, app, pool, stats) {
  const c = e.target.closest("[data-chip]");
  if (c) {
    const g = c.dataset.chip, v = c.dataset.value;
    cfg[g] = cfg[g].includes(v) ? cfg[g].filter((x) => x !== v) : [...cfg[g], v];
    c.setAttribute("aria-pressed", String(cfg[g].includes(v)));
    save();
    return drawSummary(app, pool, stats);
  }
  const s = e.target.closest("[data-seg]");
  if (s) {
    const k = s.dataset.seg;
    cfg[k] = k === "count" && s.dataset.value !== "all" ? Number(s.dataset.value) : s.dataset.value;
    for (const b of s.parentElement.children) b.setAttribute("aria-pressed", String(b === s));
    save();
    return drawSummary(app, pool, stats);
  }
  if (e.target.closest("[data-clear]")) {
    cfg.topics = [];
    save();
    return drawBuilder(app, pool, stats);
  }
  if (e.target.closest("[data-act='start']")) {
    const list = selectQuestions(pool, cfg, stats);
    const limitSec = cfg.timer === "off" ? null : estimateSeconds(list);
    const s2 = createPractice({ title: buildTitle(), questions: list, feedback: cfg.feedback, limitSec, meta: { strict: cfg.timer === "strict", config: cfg } });
    if (cfg.timer === "pace") s2.parts[0].soft = true;
    if (!list.length) return toast("No questions match. Try loosening the filters.");
    store.startSession(s2);
    location.hash = "#/session";
  }
}

function handleBuilderInput(e, app, pool, stats) {
  const d = e.target.closest("[data-diff]");
  if (!d) return;
  const i = Number(d.dataset.diff);
  cfg.difficulty = [...cfg.difficulty];
  cfg.difficulty[i] = Number(d.value);
  if (cfg.difficulty[0] > cfg.difficulty[1]) cfg.difficulty = i === 0 ? [cfg.difficulty[0], cfg.difficulty[0]] : [cfg.difficulty[1], cfg.difficulty[1]];
  save();
  drawBuilder(app, pool, stats);
}

function buildTitle() {
  const bank = getBank();
  if (cfg.topics.length === 1) return `${bank.topicNames[cfg.topics[0]]} practice`;
  if (cfg.formats.length === 1) return `${bank.topics.formats[cfg.formats[0]].name} practice`;
  return "Custom practice set";
}

function save() {
  try { localStorage.setItem("sat94.builder", JSON.stringify(cfg)); } catch {}
}
function safeLoad() {
  try { return JSON.parse(localStorage.getItem("sat94.builder") || "null"); } catch { return null; }
}
