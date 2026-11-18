// Session model shared by practice sets and exam simulations.
import { newId } from "./store.js";
import { formulaScore, scaleScore, roundRaw } from "./scoring.js";

/**
 * @param {object} o { title, questions: [q], feedback: 'immediate'|'end', limitSec: number|null, origin: 'practice'|'retry'|'topic'|... }
 */
export function createPractice({ title, questions, feedback = "immediate", limitSec = null, meta = {} }) {
  return {
    id: newId("p"),
    kind: "practice",
    title,
    meta,
    feedback,
    createdAt: Date.now(),
    startedAt: Date.now(),
    parts: [{ title, items: questions.map((q) => q.id), limitSec, elapsed: 0, started: true, submitted: false }],
    partIndex: 0,
    index: 0,
    responses: {},
  };
}

/** Exam simulation of one or more math sections of a test form, in booklet order. */
export function createExam(test, sectionIds, { timed = true } = {}) {
  const parts = sectionIds.map((sid) => {
    const sec = test.sections.find((s) => s.id === sid);
    const items = test.questions.filter((q) => q.section === sid).sort((a, b) => a.n - b.n).map((q) => q.id);
    return { title: `Section ${sec.number}`, sectionId: sid, testId: test.id, items, limitSec: timed ? sec.minutes * 60 : null, elapsed: 0, started: false, submitted: false };
  });
  const full = sectionIds.length === test.sections.length;
  return {
    id: newId("e"),
    kind: "exam",
    testId: test.id,
    full,
    timed,
    title: `SAT Form ${test.formCode} — ${full ? "Mathematics (both sections)" : parts.map((p) => p.title).join(" + ")}`,
    feedback: "end",
    createdAt: Date.now(),
    startedAt: Date.now(),
    parts,
    partIndex: 0,
    index: 0,
    responses: {},
  };
}

export const allItems = (s) => s.parts.flatMap((p) => p.items);

/** Build the result summary and the attempt records for a finished session. */
export function computeResult(session, bank) {
  const ids = allItems(session);
  const items = ids.map((id) => {
    const q = bank.index.get(id);
    const r = session.responses[id] || {};
    return { id, q, type: q.type, answer: q.answer, response: r.c || null, time: r.t || 0 };
  });
  const fs = formulaScore(items);
  const answered = fs.right + fs.wrong;
  const totalTime = session.parts.reduce((a, p) => a + (p.elapsed || 0), 0) * 1000 || items.reduce((a, i) => a + i.time, 0);

  const byTopic = {};
  for (const it of items) {
    for (const t of it.q.topics || []) {
      const b = byTopic[t] || (byTopic[t] = { answered: 0, correct: 0, omitted: 0 });
      if (!it.response) b.omitted++;
      else { b.answered++; if (it.response === it.answer) b.correct++; }
    }
  }

  const result = {
    total: items.length,
    answered,
    correct: fs.right,
    wrong: fs.wrong,
    omitted: fs.omitted,
    unrounded: fs.unrounded,
    raw: fs.raw,
    byType: fs.byType,
    byTopic,
    totalTime,
  };

  if (session.kind === "exam") {
    const test = bank.testById.get(session.testId);
    const table = test?.scoring?.rawToScaled;
    result.parts = session.parts.map((p) => {
      const sub = formulaScore(items.filter((i) => p.items.includes(i.id)));
      return { title: p.title, sectionId: p.sectionId, raw: sub.raw, unrounded: sub.unrounded, right: sub.right, wrong: sub.wrong, omitted: sub.omitted, total: sub.total, elapsed: p.elapsed, limitSec: p.limitSec };
    });
    if (table) {
      if (session.full) {
        result.scaled = scaleScore(fs.raw, table);
        result.scaledEstimate = false;
      } else {
        // one section only: project to a full 60-question test (clearly labelled estimate)
        const fullCount = test.questions.length;
        result.projectedRaw = roundRaw((fs.unrounded * fullCount) / items.length);
        result.scaled = scaleScore(result.projectedRaw, table);
        result.scaledEstimate = true;
      }
    }
  }

  const now = Date.now();
  const attempts = items
    .filter((it) => it.response || session.kind === "exam")
    .filter((it) => !(session.responses[it.id]?.recorded))
    .map((it) => ({
      q: it.id,
      c: it.response,
      ok: it.response ? it.response === it.answer : null,
      t: Math.round(it.time),
      at: now,
      s: session.id,
      m: session.kind,
    }));
  return { result, attempts };
}
