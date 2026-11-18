// The question runner: practice sets (immediate or end-of-set feedback) and timed exam sections.
import { getBank } from "../data.js";
import * as store from "../store.js";
import { computeResult, allItems } from "../session.js";
import { prefetch, renderRegion, hasBooklet } from "../booklets.js";
import {
  esc, $, $$, fmtClock, originBadge, topicBadges, formatName, dots, renderQuestionBody,
  answerControls, explanationBlock, showPageModal, confirmDialog, isAvailable,
} from "../ui.js";

let timer = null;
let lastTick = 0;
let shownAt = 0;
let keyHandler = null;

export function teardown() {
  if (timer) clearInterval(timer);
  timer = null;
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  commitTime();
}

export function render(app) {
  const s = store.activeSession();
  if (!s) {
    app.innerHTML = `<div class="empty"><strong>No session in progress.</strong>Start a practice set or an exam simulation.
      <div class="row" style="justify-content:center;margin-top:16px"><a class="btn primary" href="#/practice">Practice</a><a class="btn" href="#/exams">Exams</a></div></div>`;
    return;
  }
  const part = s.parts[s.partIndex];
  if (!part.started) return renderDirections(app, s, part);
  draw(app, s);
}

/* ---------------- directions / section start ---------------- */
function renderDirections(app, s, part) {
  const bank = getBank();
  const test = bank.testById.get(part.testId);
  const sec = test.sections.find((x) => x.id === part.sectionId);
  const qs = part.items.map((id) => bank.index.get(id));
  const nQC = qs.filter((q) => q.type === "qc4").length;
  const prevPart = s.partIndex > 0 ? s.parts[s.partIndex - 1] : null;
  app.innerHTML = `
    <div class="page-heading compact">
      <p class="eyebrow">${esc(s.title)}</p>
      <h1>${prevPart ? `${esc(prevPart.title)} submitted. ` : ""}${esc(part.title)}</h1>
      <p>${part.limitSec ? `${Math.round(part.limitSec / 60)} minutes` : "Untimed"} · ${qs.length} questions${nQC ? ` (${qs.length - nQC} regular multiple choice, ${nQC} quantitative comparison)` : ""}.</p>
    </div>
    <div class="session-layout">
      <div class="qpanel">
        <p class="eyebrow" style="margin-bottom:12px">Directions as printed in the booklet</p>
        <div id="directions" class="directions-scan"></div>
        <div class="notice">
          <div><p><strong>How this section is scored (as in the 1980s):</strong> one point for each correct answer, minus ¼ point for each wrong five-choice answer and ⅓ point for each wrong quantitative-comparison answer. Omitted questions score zero — so a random guess does not help on average, but eliminating even one choice makes guessing worthwhile.</p>
          ${part.limitSec ? `<p>The clock starts when you press <strong>Begin</strong>. When time runs out the section is submitted automatically. You can move freely between questions within this section and flag questions to revisit.</p>` : ""}</div>
        </div>
        <div class="qactions"><button class="btn primary" data-act="begin">Begin ${esc(part.title)}</button>
        <button class="btn ghost" data-act="exit">Save and exit</button></div>
      </div>
      <aside class="side"><div class="panel"><p class="eyebrow">Exam plan</p>
        <ol class="sans small" style="padding-left:18px;margin:10px 0 0">${s.parts.map((p, i) => `<li style="margin:6px 0;${i === s.partIndex ? "font-weight:700;color:var(--navy)" : p.submitted ? "color:var(--faint);text-decoration:line-through" : ""}">${esc(p.title)} — ${p.limitSec ? `${Math.round(p.limitSec / 60)} min` : "untimed"}</li>`).join("")}</ol></div></aside>
    </div>`;
  const dir = $("#directions", app);
  if (hasBooklet(test.pdf.sha256) && sec.directions?.length) {
    Promise.all(sec.directions.map((r) => renderRegion(test.pdf.sha256, r.page, r.box))).then((cs) => {
      const wrap = document.createElement("div");
      wrap.className = "scan-wrap";
      wrap.append(...cs);
      dir.replaceChildren(wrap);
    }).catch(() => (dir.innerHTML = ""));
    prefetch(test.pdf.sha256, sec.pages || []);
  } else {
    dir.innerHTML = `<p class="muted sans small">Load this booklet to see the original directions and reference formulas.</p>`;
  }
  app.onclick = (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "begin") {
      store.updateSession(s.id, (x) => { x.parts[x.partIndex].started = true; x.index = 0; });
      draw(app, store.activeSession());
    } else if (act === "exit") location.hash = "#/";
  };
}

/* ---------------- main runner ---------------- */
function draw(app, s) {
  teardownTimerOnly();
  const bank = getBank();
  const part = s.parts[s.partIndex];
  const ids = part.items;
  const qid = ids[s.index];
  const q = bank.index.get(qid);
  const r = s.responses[qid] || {};
  const immediate = s.feedback === "immediate";
  const revealed = immediate && r.checked;
  const isExam = s.kind === "exam";
  const total = ids.length;
  const answeredCount = ids.filter((id) => s.responses[id]?.c).length;

  app.innerHTML = `
    <div class="session-bar">
      <span class="title">${esc(s.title)}</span>
      <span class="muted">${s.parts.length > 1 ? `${esc(part.title)} · ` : ""}Question ${s.index + 1} of ${total}</span>
      <span class="spacer"></span>
      <span id="timer" class="timer" title="${part.limitSec ? "Time remaining" : "Time elapsed"}">--:--</span>
      <button class="btn small ghost" data-act="exit">Save &amp; exit</button>
    </div>
    <div class="session-layout">
      <div>
        <div class="qpanel">
          <div class="progress-track"><div class="progress-value" style="width:${((s.index + 1) / total) * 100}%"></div></div>
          <div class="qhead">
            <span class="qnum">${isExam ? `${q.n}.` : `Question ${s.index + 1}`} <span class="muted small sans" style="font-weight:400">${esc(q.label)}</span></span>
            <span class="tags">${originBadge(q)}${isExam ? "" : topicBadges(q)}<span class="badge">${esc(formatName(q.type))}</span>${isExam ? "" : `<span class="badge">${dots(q.difficulty)}</span>`}</span>
          </div>
          <div id="qbody" class="qbody"></div>
          <div id="answers">${isAvailable(q) ? answerControls(q, { selected: r.c || null, reveal: revealed }) : ""}</div>
          <div id="feedback">${revealed ? explanationBlock(q, { chosen: r.c }) : ""}</div>
          <div class="qactions">${actionButtons(s, q, r, immediate, revealed, isExam)}</div>
          <p class="hint" style="margin-top:14px">Keyboard: <span class="kbd">A</span>–<span class="kbd">${q.type === "qc4" ? "D" : "E"}</span> choose · <span class="kbd">Enter</span> ${immediate ? "check / next" : "next"} · <span class="kbd">←</span><span class="kbd">→</span> move · <span class="kbd">F</span> flag</p>
        </div>
      </div>
      <aside class="side">
        <div class="panel">
          <div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="eyebrow">Questions</span><span class="small sans muted">${answeredCount}/${total} answered</span></div>
          <div class="navgrid">${ids.map((id, i) => navCell(s, id, i, immediate)).join("")}</div>
          <div class="legend" style="margin-top:12px"><span><i style="background:var(--tint);border-color:var(--navy)"></i>answered</span><span><i style="background:var(--amber-line);border-radius:50%"></i>flagged</span>${immediate ? `<span><i style="background:var(--green)"></i>right</span><span><i style="background:var(--red)"></i>wrong</span>` : ""}</div>
          <div class="row" style="margin-top:16px">
            <button class="btn small ghost" data-act="flag">${r.f ? "Unflag" : "Flag"} <span class="kbd">F</span></button>
            ${q.origin === "authentic" && isAvailable(q) ? `<button class="btn small ghost" data-act="page">Full page</button>` : ""}
          </div>
        </div>
        <div class="panel">
          <button class="btn ${immediate ? "ghost" : "primary"}" style="width:100%" data-act="submit">${isExam ? `Submit ${esc(part.title)}` : "Finish set"}</button>
          <p class="hint" style="margin:10px 0 0">${isExam ? "Unanswered questions are omitted (no penalty)." : "Unanswered questions are left out of your results."}</p>
          ${s.kind === "practice" ? `<button class="link-btn" style="margin-top:12px" data-act="discard">Discard this set</button>` : `<button class="link-btn" style="margin-top:12px" data-act="discard">Abandon exam</button>`}
        </div>
      </aside>
    </div>`;

  renderQuestionBody(q, $("#qbody", app));
  if (q.origin === "authentic") {
    const next = ids.slice(s.index + 1, s.index + 3).map((id) => bank.index.get(id)).filter(Boolean);
    prefetch(q.sha256, [...new Set(next.flatMap((n) => n.regions.map((x) => x.page)))]);
  }
  shownAt = performance.now();
  startTimer(s, app);
  bind(app, s);
}

function actionButtons(s, q, r, immediate, revealed, isExam) {
  const last = s.index === s.parts[s.partIndex].items.length - 1;
  const btns = [];
  if (s.index > 0) btns.push(`<button class="btn ghost" data-act="prev">Previous</button>`);
  if (immediate) {
    if (!revealed) {
      btns.push(`<button class="btn primary" data-act="check" ${r.c ? "" : "disabled"}>Check answer</button>`);
      btns.push(`<button class="btn ghost" data-act="next">${last ? "Skip" : "Skip"}</button>`);
    } else {
      btns.push(last ? `<button class="btn primary" data-act="submit">See results</button>` : `<button class="btn primary" data-act="next">Next question</button>`);
    }
  } else {
    btns.push(last ? `<button class="btn primary" data-act="submit">${isExam ? "Review &amp; submit" : "Finish set"}</button>` : `<button class="btn primary" data-act="next">Next</button>`);
    if (r.c) btns.push(`<button class="btn ghost" data-act="clear">Clear answer</button>`);
  }
  return btns.join("");
}

function navCell(s, id, i, immediate) {
  const r = s.responses[id] || {};
  const q = getBank().index.get(id);
  const cls = [];
  if (r.c) cls.push("answered");
  if (immediate && r.checked) cls.push(r.c === q.answer ? "right" : "wrong");
  if (r.f) cls.push("flagged");
  if (i === s.index) cls.push("current");
  return `<button type="button" class="${cls.join(" ")}" data-goto="${i}" aria-label="Question ${i + 1}">${s.kind === "exam" ? q.n : i + 1}</button>`;
}

/* ---------------- interaction ---------------- */
function bind(app, s) {
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  app.onclick = async (e) => {
    const choice = e.target.closest("[data-choice]");
    if (choice && !choice.disabled) return choose(app, choice.dataset.choice);
    const go = e.target.closest("[data-goto]");
    if (go) return move(app, Number(go.dataset.goto));
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const cur = store.activeSession();
    if (act === "next") return move(app, cur.index + 1);
    if (act === "prev") return move(app, cur.index - 1);
    if (act === "check") return check(app);
    if (act === "clear") { mutate((x) => { const r = x.responses[curId(x)]; if (r) r.c = null; }); return draw(app, store.activeSession()); }
    if (act === "flag") return toggleFlag(app);
    if (act === "page") return showPageModal(getBank().index.get(curId(cur)));
    if (act === "exit") { commitTime(); location.hash = "#/"; return; }
    if (act === "discard") {
      const ok = await confirmDialog(cur.kind === "exam" ? "Abandon this exam?" : "Discard this set?", "Nothing from it will be added to your progress.", cur.kind === "exam" ? "Abandon" : "Discard");
      if (ok) { teardown(); store.discardSession(cur.id); location.hash = cur.kind === "exam" ? "#/exams" : "#/practice"; }
      return;
    }
    if (act === "submit") return submitPart(app);
  };
  keyHandler = (e) => {
    if ((e.target instanceof Element && e.target.matches("input, textarea, select")) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector(".modal")) return;
    const cur = store.activeSession();
    if (!cur) return;
    const q = getBank().index.get(curId(cur));
    const letters = getBank().topics.formats[q.type].choices;
    const k = e.key.toUpperCase();
    if (letters.includes(k)) {
      const btn = document.querySelector(`[data-choice="${k}"]`);
      if (btn && !btn.disabled) { e.preventDefault(); choose(app, k); }
    } else if (e.key === "Enter") {
      const primary = document.querySelector(".qactions .btn.primary:not(:disabled)");
      if (primary) { e.preventDefault(); primary.click(); }
    } else if (e.key === "ArrowRight") { if (cur.index < cur.parts[cur.partIndex].items.length - 1) move(app, cur.index + 1); }
    else if (e.key === "ArrowLeft") { if (cur.index > 0) move(app, cur.index - 1); }
    else if (k === "F") toggleFlag(app);
  };
  document.addEventListener("keydown", keyHandler);
}

const curId = (s) => s.parts[s.partIndex].items[s.index];

function mutate(fn) {
  const s = store.activeSession();
  return store.updateSession(s.id, fn);
}

function commitTime() {
  const s = store.activeSession();
  if (!s || !shownAt) return;
  const dt = performance.now() - shownAt;
  shownAt = performance.now();
  const id = curId(s);
  if (!id) return;
  const r = s.responses[id] || (s.responses[id] = {});
  if (!r.checked) r.t = (r.t || 0) + dt;
  store.saveQuietly();
}

function choose(app, letter) {
  const s = store.activeSession();
  const id = curId(s);
  const r = s.responses[id];
  if (s.feedback === "immediate" && r?.checked) return;
  mutate((x) => { const rr = x.responses[id] || (x.responses[id] = {}); rr.c = letter; });
  // update just the controls for snappy feel
  const q = getBank().index.get(id);
  $("#answers", app).innerHTML = answerControls(q, { selected: letter });
  $(".qactions", app).innerHTML = actionButtons(store.activeSession(), q, store.activeSession().responses[id], s.feedback === "immediate", false, s.kind === "exam");
  const cell = app.querySelector(`[data-goto="${s.index}"]`);
  if (cell) cell.classList.add("answered");
}

function check(app) {
  commitTime();
  const s = store.activeSession();
  const id = curId(s);
  const q = getBank().index.get(id);
  const r = s.responses[id];
  if (!r?.c) return;
  mutate((x) => { const rr = x.responses[id]; rr.checked = true; rr.recorded = true; });
  store.recordAttempt({ q: id, c: r.c, ok: r.c === q.answer, t: Math.round(r.t || 0), at: Date.now(), s: s.id, m: s.kind });
  draw(app, store.activeSession());
}

function move(app, i) {
  const s = store.activeSession();
  const n = s.parts[s.partIndex].items.length;
  if (i < 0) return;
  if (i >= n) return submitPart(app);
  commitTime();
  mutate((x) => { x.index = i; });
  draw(app, store.activeSession());
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function toggleFlag(app) {
  const s = store.activeSession();
  const id = curId(s);
  mutate((x) => { const r = x.responses[id] || (x.responses[id] = {}); r.f = !r.f; });
  draw(app, store.activeSession());
}

async function submitPart(app, { auto = false } = {}) {
  commitTime();
  const s = store.activeSession();
  const part = s.parts[s.partIndex];
  if (!auto) {
    const unanswered = part.items.filter((id) => !s.responses[id]?.c).length;
    const flagged = part.items.filter((id) => s.responses[id]?.f).length;
    if (s.kind === "exam" || s.feedback === "end") {
      const parts = [];
      if (unanswered) parts.push(`${unanswered} unanswered (they will be omitted)`);
      if (flagged) parts.push(`${flagged} flagged`);
      const remaining = part.limitSec ? ` You still have ${fmtClock(part.limitSec - part.elapsed)} left.` : "";
      const ok = await confirmDialog(`Submit ${s.kind === "exam" ? part.title : "this set"}?`, `${parts.length ? `You have ${parts.join(" and ")}.` : "All questions answered."}${remaining} You cannot return to this ${s.kind === "exam" ? "section" : "set"} afterwards.`, "Submit");
      if (!ok) return;
    } else if (unanswered && unanswered === part.items.length) {
      const ok = await confirmDialog("Finish without answering?", "You have not answered any questions in this set.", "Finish");
      if (!ok) return;
    }
  }
  store.updateSession(s.id, (x) => { x.parts[x.partIndex].submitted = true; });
  if (s.partIndex < s.parts.length - 1) {
    store.updateSession(s.id, (x) => { x.partIndex += 1; x.index = 0; });
    teardownTimerOnly();
    render(app);
    window.scrollTo(0, 0);
    return;
  }
  finish(s.id);
}

function finish(id) {
  teardown();
  const s = store.getState().sessions[id];
  const { result, attempts } = computeResult(s, getBank());
  store.finishSession(id, result, attempts);
  location.hash = `#/results/${id}`;
}

/* ---------------- timer ---------------- */
function teardownTimerOnly() {
  if (timer) clearInterval(timer);
  timer = null;
}

function startTimer(s, app) {
  const el = $("#timer", app);
  const update = () => {
    const cur = store.activeSession();
    if (!cur) return teardownTimerOnly();
    const part = cur.parts[cur.partIndex];
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt > 0 && dt < 5) part.elapsed = (part.elapsed || 0) + dt;
    if (part.limitSec && part.soft) {
      const left = part.limitSec - part.elapsed;
      el.textContent = left >= 0 ? fmtClock(left) : `+${fmtClock(-left)}`;
      el.title = left >= 0 ? "Time remaining at SAT pace" : "Over SAT pace";
      el.classList.toggle("low", left <= 60);
    } else if (part.limitSec) {
      const left = part.limitSec - part.elapsed;
      el.textContent = fmtClock(left);
      el.classList.toggle("low", left <= 300);
      if (left <= 0) {
        teardownTimerOnly();
        store.saveQuietly();
        alertTimeUp(app, cur);
        return;
      }
    } else {
      el.textContent = fmtClock(part.elapsed);
    }
    if (Math.floor(part.elapsed) % 5 === 0) store.saveQuietly();
  };
  lastTick = performance.now();
  update();
  timer = setInterval(update, 1000);
}

function alertTimeUp(app, s) {
  const part = s.parts[s.partIndex];
  submitPart(app, { auto: true }).then(() => {
    const host = document.createElement("div");
    host.className = "toast-host";
    host.innerHTML = `<div class="toast"><strong>Time.</strong> ${esc(part.title)} was submitted automatically.</div>`;
    document.body.appendChild(host);
    setTimeout(() => host.remove(), 5000);
  });
}

export function resumeLabel() {
  const s = store.activeSession();
  if (!s) return null;
  const done = allItems(s).filter((id) => s.responses[id]?.c).length;
  return { title: s.title, done, total: allItems(s).length };
}
