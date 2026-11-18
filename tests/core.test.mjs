// Run with:  node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { formulaScore, roundRaw, scaleScore, projectScore } from "../js/scoring.js";
import { math, renderInline, renderRich } from "../js/format.js";
import { filterPool, selectQuestions, rng, shuffle } from "../js/select.js";
import { computeStats, weaknesses, dailyActivity, streak, sessionTrend } from "../js/analytics.js";
import { computeResult, createExam, createPractice } from "../js/session.js";

test("roundRaw rounds half up like the College Board worksheet", () => {
  assert.equal(roundRaw(44.5), 45);
  assert.equal(roundRaw(44.49), 44);
  assert.equal(roundRaw(-0.25), 0);
  assert.equal(roundRaw(-0.5), 0);
  assert.equal(roundRaw(-0.75), -1);
  assert.equal(roundRaw(36.666), 37);
});

test("formulaScore applies 1/4 and 1/3 penalties and ignores omits", () => {
  const items = [
    ...Array(10).fill({ type: "mc5", answer: "A", response: "A" }),
    ...Array(4).fill({ type: "mc5", answer: "A", response: "B" }),
    ...Array(2).fill({ type: "mc5", answer: "A", response: null }),
    ...Array(6).fill({ type: "qc4", answer: "C", response: "C" }),
    ...Array(3).fill({ type: "qc4", answer: "C", response: "D" }),
  ];
  const s = formulaScore(items);
  assert.equal(s.right, 16);
  assert.equal(s.wrong, 7);
  assert.equal(s.omitted, 2);
  assert.equal(s.byType.mc5.points, 10 - 1);
  assert.equal(s.byType.qc4.points, 6 - 1);
  assert.equal(s.unrounded, 14);
  assert.equal(s.raw, 14);
});

test("scaleScore clamps to the table ends", () => {
  const t = { "-3": 200, "0": 220, "1": 230, "59": 790, "60": 800 };
  assert.equal(scaleScore(60, t), 800);
  assert.equal(scaleScore(75, t), 800);
  assert.equal(scaleScore(-9, t), 200);
  assert.equal(scaleScore(1, t), 230);
  assert.equal(scaleScore(30, t), 230); // missing key falls back to nearest lower
});

test("projectScore needs data and returns a bounded range", () => {
  const blueprint = [...Array(40).fill({ type: "mc5", difficulty: 3 }), ...Array(20).fill({ type: "qc4", difficulty: 3 })];
  const table = Object.fromEntries(Array.from({ length: 71 }, (_, i) => [String(i - 10), Math.min(800, Math.max(200, 200 + (i - 10) * 10))]));
  assert.equal(projectScore({ answered: 5, correct: 5 }, blueprint, [table]), null);
  const p = projectScore({ answered: 100, correct: 80, byDifficulty: { 3: { answered: 100, correct: 80 } }, byFormat: {} }, blueprint, [table]);
  assert.ok(p.scaled > 500 && p.scaled < 800, `scaled ${p.scaled}`);
  assert.ok(p.low <= p.scaled && p.scaled <= p.high);
});

test("math mini-markup renders fractions, powers, roots and italics", () => {
  assert.match(math("x^2"), /<i>x<\/i><sup>2<\/sup>/);
  assert.match(math("\\frac{a}{b}"), /class="frac".*<i>a<\/i>.*<i>b<\/i>/);
  assert.match(math("\\sqrt{25}"), /class="sqrt".*25/);
  assert.equal(math("3-2"), "3−2");
  assert.match(math("a < b"), /&lt;/);
  assert.match(renderInline("cost \\$80 and $x$"), /cost \$80 and <span class="m"><i>x<\/i><\/span>/);
  assert.equal(renderRich("a\n\nb"), "<p>a</p><p>b</p>");
  assert.doesNotMatch(renderInline("<script>"), /<script>/);
});

const pool = [
  { id: "a1", origin: "authentic", testId: "T", sectionNumber: 3, n: 1, type: "mc5", topics: ["equations"], difficulty: 1 },
  { id: "a2", origin: "authentic", testId: "T", sectionNumber: 3, n: 2, type: "mc5", topics: ["circles"], difficulty: 2, group: "g" },
  { id: "a3", origin: "authentic", testId: "T", sectionNumber: 3, n: 3, type: "mc5", topics: ["circles"], difficulty: 3, group: "g" },
  { id: "a4", origin: "authentic", testId: "T", sectionNumber: 5, n: 8, type: "qc4", topics: ["percents"], difficulty: 4 },
  { id: "o1", origin: "original", type: "mc5", topics: ["equations"], difficulty: 5 },
];

test("filterPool honours every filter", () => {
  assert.deepEqual(filterPool(pool, { topics: ["circles"] }).map((q) => q.id), ["a2", "a3"]);
  assert.deepEqual(filterPool(pool, { formats: ["qc4"] }).map((q) => q.id), ["a4"]);
  assert.deepEqual(filterPool(pool, { origins: ["original"] }).map((q) => q.id), ["o1"]);
  assert.deepEqual(filterPool(pool, { difficulty: [4, 5] }).map((q) => q.id), ["a4", "o1"]);
  const stats = { missed: ["a1"], seen: new Set(["a1", "a4"]) };
  assert.deepEqual(filterPool(pool, { status: "missed" }, stats).map((q) => q.id), ["a1"]);
  assert.deepEqual(filterPool(pool, { status: "unseen" }, stats).map((q) => q.id), ["a2", "a3", "o1"]);
});

test("selectQuestions is reproducible, sized, and keeps shared-stem groups together", () => {
  const a = selectQuestions(pool, { count: "all" }, null, rng(7)).map((q) => q.id);
  const b = selectQuestions(pool, { count: "all" }, null, rng(7)).map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  const i = a.indexOf("a2");
  const j = a.indexOf("a3");
  assert.equal(Math.abs(i - j), 1, `group split: ${a}`);
  assert.equal(selectQuestions(pool, { count: 2 }, null, rng(1)).length, 2);
  assert.deepEqual(selectQuestions(pool, { count: "all", order: "test" }).map((q) => q.id), ["a1", "a2", "a3", "a4", "o1"]);
  assert.equal(shuffle([1, 2, 3], rng(3)).length, 3);
});

test("computeStats aggregates by topic, difficulty and format; missed tracks last attempt", () => {
  const index = new Map(pool.map((q) => [q.id, { ...q, area: "x" }]));
  const attempts = [
    { q: "a1", c: "B", ok: false, t: 5000, at: 1 },
    { q: "a1", c: "A", ok: true, t: 4000, at: 2 },
    { q: "a2", c: "C", ok: false, t: 3000, at: 3 },
    { q: "a4", c: null, ok: null, t: 0, at: 4 },
    { q: "o1", c: "D", ok: true, t: 9000, at: 5 },
  ];
  const s = computeStats(attempts, index);
  assert.equal(s.overall.answered, 4);
  assert.equal(s.overall.correct, 2);
  assert.equal(s.overall.omitted, 1);
  assert.equal(s.byTopic.equations.answered, 3);
  assert.deepEqual(s.missed, ["a2"]);
  assert.equal(s.authentic.answered, 3);
  assert.equal(s.byFormat.qc4.omitted, 1);
  const w = weaknesses(s, { equations: "Equations", circles: "Circles" }, { min: 1 });
  assert.equal(w[0].id, "circles");
});

test("dailyActivity and streak", () => {
  const now = new Date(2026, 10, 18, 12).getTime();
  const day = 86400000;
  const attempts = [now, now - day, now - 2 * day, now - 4 * day].map((at) => ({ q: "x", ok: true, at }));
  const act = dailyActivity(attempts, 7, now);
  assert.equal(act.length, 7);
  assert.equal(act[6].answered, 1);
  assert.equal(streak(act), 3);
});

test("sessionTrend orders finished sessions", () => {
  const t = sessionTrend({ a: { id: "a", finishedAt: 2, result: { answered: 4, correct: 2 } }, b: { id: "b", finishedAt: 1, result: { answered: 2, correct: 2 } }, c: { id: "c" } });
  assert.deepEqual(t.map((x) => x.id), ["b", "a"]);
  assert.equal(t[1].acc, 0.5);
});

test("exam sessions score with the form's conversion table", () => {
  const questions = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `T-S3-${i + 1}`, section: "S3", n: i + 1, type: "mc5", answer: "A", topics: ["equations"], difficulty: 1 })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `T-S5-${i + 1}`, section: "S5", n: i + 1, type: "qc4", answer: "B", topics: ["percents"], difficulty: 2 })),
  ];
  const testForm = {
    id: "T", formCode: "T",
    sections: [{ id: "S3", number: 3, minutes: 30 }, { id: "S5", number: 5, minutes: 30 }],
    questions,
    scoring: { rawToScaled: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i - 4), 200 + i * 50])) },
  };
  const bank = { index: new Map(questions.map((q) => [q.id, q])), testById: new Map([["T", testForm]]) };
  const s = createExam(testForm, ["S3", "S5"]);
  assert.equal(s.parts.length, 2);
  assert.equal(s.parts[0].limitSec, 1800);
  s.responses = { "T-S3-1": { c: "A" }, "T-S3-2": { c: "A" }, "T-S3-3": { c: "C" }, "T-S5-1": { c: "B" }, "T-S5-2": { c: "A" } };
  const { result, attempts } = computeResult(s, bank);
  // right 3, wrong 1 mc5 (−.25) + 1 qc4 (−.333) → 2.4167 → 2
  assert.equal(result.correct, 3);
  assert.equal(result.wrong, 2);
  assert.equal(result.omitted, 2);
  assert.equal(result.raw, 2);
  assert.equal(result.scaled, 200 + (2 + 4) * 50);
  assert.equal(result.scaledEstimate, false);
  assert.equal(attempts.length, 7); // omitted questions are recorded in exams
  assert.equal(attempts.filter((a) => a.ok === null).length, 2);

  const single = createExam(testForm, ["S3"]);
  single.responses = { "T-S3-1": { c: "A" }, "T-S3-2": { c: "A" } };
  const r2 = computeResult(single, bank).result;
  assert.equal(r2.scaledEstimate, true);
  assert.equal(r2.projectedRaw, Math.round((2 * 7) / 4));
});

test("practice sessions skip attempts already recorded during immediate feedback", () => {
  const q = { id: "o1", type: "mc5", answer: "D", topics: ["equations"], difficulty: 1 };
  const bank = { index: new Map([["o1", q]]), testById: new Map() };
  const s = createPractice({ title: "x", questions: [q] });
  s.responses = { o1: { c: "D", recorded: true, checked: true } };
  const { result, attempts } = computeResult(s, bank);
  assert.equal(result.correct, 1);
  assert.equal(attempts.length, 0);
});
