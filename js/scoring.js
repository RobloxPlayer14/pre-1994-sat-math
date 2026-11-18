// Historical SAT formula scoring (pre-1994).
// Five-choice questions: right − wrong/4.  Four-choice (quantitative comparison): right − wrong/3.
// Omitted questions score 0. The unrounded total is rounded to the nearest whole number
// (.5 rounds up) and converted to the 200–800 scale with the test form's own table.

export const PENALTY = { mc5: 1 / 4, qc4: 1 / 3 };

/** Round half up, the way the College Board worksheet instructs (44.50 → 45). */
export function roundRaw(x) {
  return Math.floor(x + 0.5 + 1e-9);
}

/**
 * Score a list of { type, response, answer } items.
 * response is a letter or null/undefined for omitted.
 */
export function formulaScore(items) {
  const byType = {};
  let unrounded = 0;
  for (const it of items) {
    const t = byType[it.type] || (byType[it.type] = { right: 0, wrong: 0, omitted: 0, total: 0 });
    t.total += 1;
    if (!it.response) t.omitted += 1;
    else if (it.response === it.answer) t.right += 1;
    else t.wrong += 1;
  }
  for (const [type, t] of Object.entries(byType)) {
    t.points = t.right - t.wrong * (PENALTY[type] ?? 0.25);
    unrounded += t.points;
  }
  const right = sum(Object.values(byType), "right");
  const wrong = sum(Object.values(byType), "wrong");
  const omitted = sum(Object.values(byType), "omitted");
  return { byType, unrounded, raw: roundRaw(unrounded), right, wrong, omitted, total: items.length };
}

/** Look up a scaled score. table: { "<raw>": scaled }. Out-of-range raw clamps to the ends. */
export function scaleScore(raw, table) {
  if (!table) return null;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  if (raw <= keys[0]) return table[String(keys[0])];
  if (raw >= keys[keys.length - 1]) return table[String(keys[keys.length - 1])];
  if (table[String(raw)] != null) return table[String(raw)];
  // Should not happen with complete tables; fall back to the nearest lower entry.
  let best = keys[0];
  for (const k of keys) if (k <= raw) best = k;
  return table[String(best)];
}

/**
 * Project a full-test SAT-M score from practice history.
 * stats: { byDifficulty: {1:{answered,correct}..5}, byFormat: {mc5:{..}, qc4:{..}}, answered, correct }
 * blueprint: [{ type, difficulty }] for one full math test (60 items).
 * tables: array of conversion tables to average over.
 * Returns null when there is not enough data.
 */
export function projectScore(stats, blueprint, tables, { minAnswered = 30 } = {}) {
  if (!stats || stats.answered < minAnswered || !blueprint?.length || !tables?.length) return null;
  const pAll = (stats.correct + 1) / (stats.answered + 2);
  const prior = 3;
  const pFor = (type, d) => {
    const dd = stats.byDifficulty?.[d] || { answered: 0, correct: 0 };
    const pd = (dd.correct + prior * pAll) / (dd.answered + prior);
    const ff = stats.byFormat?.[type] || { answered: 0, correct: 0 };
    const pf = (ff.correct + prior * pAll) / (ff.answered + prior);
    // combine difficulty and format effects multiplicatively around the overall rate
    const p = pAll > 0 ? (pd * pf) / pAll : 0;
    return Math.min(0.995, Math.max(0.005, p));
  };
  const expectedRaw = (shift) =>
    blueprint.reduce((acc, q) => {
      const p = Math.min(0.995, Math.max(0.005, pFor(q.type, q.difficulty) + shift));
      return acc + p - (1 - p) * (PENALTY[q.type] ?? 0.25);
    }, 0);
  const se = Math.sqrt((pAll * (1 - pAll)) / stats.answered);
  const mid = expectedRaw(0);
  const lo = expectedRaw(-se);
  const hi = expectedRaw(se);
  const avgScale = (raw) => {
    const r = roundRaw(raw);
    const vals = tables.map((t) => scaleScore(r, t)).filter((v) => v != null);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length / 10) * 10;
  };
  return { raw: mid, scaled: avgScale(mid), low: avgScale(lo), high: avgScale(hi), basedOn: stats.answered };
}

function sum(arr, key) {
  return arr.reduce((a, b) => a + (b[key] || 0), 0);
}
