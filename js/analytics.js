// Pure aggregation over attempt records. No DOM, testable in Node.
// attempt: { q: questionId, c: choice|null, ok: true|false|null(omitted), t: ms, at: epoch, s: sessionId, m: mode }

const bucket = () => ({ answered: 0, correct: 0, omitted: 0, time: 0, timed: 0 });

function add(b, a) {
  if (a.ok === null || a.ok === undefined) {
    b.omitted += 1;
    return;
  }
  b.answered += 1;
  if (a.ok) b.correct += 1;
  if (a.t > 0 && a.t < 30 * 60 * 1000) {
    b.time += a.t;
    b.timed += 1;
  }
}

export const accuracy = (b) => (b && b.answered ? b.correct / b.answered : null);
/** Laplace-smoothed accuracy, used for ranking weaknesses with small samples. */
export const smoothed = (b, prior = 0.6, strength = 2) =>
  b && b.answered + strength > 0 ? (b.correct + prior * strength) / (b.answered + strength) : prior;
export const avgTime = (b) => (b && b.timed ? b.time / b.timed : null);

/**
 * @param attempts attempt records (chronological)
 * @param index Map questionId -> question ({ origin, topics, area, difficulty, type })
 */
export function computeStats(attempts, index) {
  const overall = bucket();
  const byTopic = {};
  const byArea = {};
  const byDifficulty = {};
  const byFormat = {};
  const byOrigin = {};
  const last = new Map(); // qid -> last attempt
  const counts = new Map(); // qid -> { tries, wrong }
  const authentic = bucket();
  const authenticByDifficulty = {};
  const authenticByFormat = {};

  for (const a of attempts) {
    const q = index.get(a.q);
    if (!q) continue;
    add(overall, a);
    for (const t of q.topics || []) add(byTopic[t] || (byTopic[t] = bucket()), a);
    if (q.area) add(byArea[q.area] || (byArea[q.area] = bucket()), a);
    add(byDifficulty[q.difficulty] || (byDifficulty[q.difficulty] = bucket()), a);
    add(byFormat[q.type] || (byFormat[q.type] = bucket()), a);
    add(byOrigin[q.origin] || (byOrigin[q.origin] = bucket()), a);
    if (q.origin === "authentic") {
      add(authentic, a);
      add(authenticByDifficulty[q.difficulty] || (authenticByDifficulty[q.difficulty] = bucket()), a);
      add(authenticByFormat[q.type] || (authenticByFormat[q.type] = bucket()), a);
    }
    if (a.ok !== null && a.ok !== undefined) {
      last.set(a.q, a);
      const c = counts.get(a.q) || { tries: 0, wrong: 0 };
      c.tries += 1;
      if (!a.ok) c.wrong += 1;
      counts.set(a.q, c);
    }
  }

  const missed = [...last.values()].filter((a) => !a.ok).map((a) => a.q);
  const mastered = [...last.values()].filter((a) => a.ok).map((a) => a.q);

  return {
    overall, byTopic, byArea, byDifficulty, byFormat, byOrigin, last, counts, missed, mastered,
    authentic: { ...authentic, byDifficulty: authenticByDifficulty, byFormat: authenticByFormat },
    seen: new Set(last.keys()),
  };
}

/** Topics ranked weakest-first. Needs at least `min` answered to be ranked. */
export function weaknesses(stats, topicNames, { min = 3, limit = 5 } = {}) {
  const overallAcc = accuracy(stats.overall) ?? 0.6;
  return Object.entries(stats.byTopic)
    .filter(([, b]) => b.answered >= min)
    .map(([id, b]) => ({ id, name: topicNames[id] || id, ...b, acc: accuracy(b), score: smoothed(b, overallAcc) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

/** Per-session accuracy trend for finished sessions (oldest first). */
export function sessionTrend(sessions) {
  return Object.values(sessions)
    .filter((s) => s.finishedAt && s.result && s.result.answered > 0)
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((s) => ({
      id: s.id,
      at: s.finishedAt,
      kind: s.kind,
      title: s.title,
      acc: s.result.correct / s.result.answered,
      answered: s.result.answered,
      scaled: s.result.scaled ?? null,
    }));
}

/** Daily activity for the last `days` days: [{ day: 'YYYY-MM-DD', answered }] */
export function dailyActivity(attempts, days = 28, now = Date.now()) {
  const map = new Map();
  for (const a of attempts) {
    if (a.ok === null || a.ok === undefined) continue;
    const d = new Date(a.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ day: key, answered: map.get(key) || 0 });
  }
  return out;
}

/** Consecutive days (ending today or yesterday) with at least one answer. */
export function streak(activity) {
  let n = 0;
  let i = activity.length - 1;
  if (i >= 0 && activity[i].answered === 0) i--; // today not started yet is fine
  for (; i >= 0 && activity[i].answered > 0; i--) n++;
  return n;
}
